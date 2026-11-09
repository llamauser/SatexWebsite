"""Helpers shared by the Blender scripts that build the 3D showroom (run with `blender --background --python <script> -- <args>`).

Coordinates: every position in these scripts is written the way the website's scene uses them (three.js: x to the right, y up, z towards the
back of the building, in metres, origin = front-left corner of the floor). `P()` converts to Blender's axes; the glTF exporter converts back.
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
SRC = os.path.join(REPO, "assets", "showroom-src", "polyhaven")
TMP = os.path.join(REPO, ".tmp", "showroom")
SPEC = json.load(open(os.path.join(REPO, "src", "lib", "showroom", "spec.json"), encoding="utf-8"))


def args():
    """Arguments after the `--` of the Blender command line, as {name: value}."""
    raw = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {}
    for i, a in enumerate(raw):
        if a.startswith("--"):
            out[a[2:]] = raw[i + 1] if i + 1 < len(raw) and not raw[i + 1].startswith("--") else True
    return out


def P(x, y, z):
    """three.js (x, y up, z depth) -> Blender (X, Y, Z up)."""
    return Vector((x, -z, y))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def hex_rgba(h, a=1.0):
    h = h.lstrip("#")
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (*lin, a)


# ------------------------------------------------------------------ materials
def _principled(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return nt, bsdf


def _image(nt, path, colorspace):
    node = nt.nodes.new("ShaderNodeTexImage")
    node.image = bpy.data.images.load(path, check_existing=True)
    node.image.colorspace_settings.name = colorspace
    return node


def flat_mat(name, color, rough=0.6, metal=0.0, emission=None, emission_strength=1.0, alpha=1.0, coat=0.0):
    """A plain painted / metal / glass material."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    nt, b = _principled(m)
    b.inputs["Base Color"].default_value = hex_rgba(color) if isinstance(color, str) else color
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emission:
        b.inputs["Emission Color"].default_value = hex_rgba(emission)
        b.inputs["Emission Strength"].default_value = emission_strength
    if alpha < 1.0:
        b.inputs["Alpha"].default_value = alpha
        m.blend_method = "BLEND"
    if coat:
        b.inputs["Coat Weight"].default_value = coat
    return m


def tex_mat(name, folder, tint="#FFFFFF", rough=None, normal=1.0, metal=0.0):
    """A material from a Poly Haven texture set (Diffuse / Rough / normal) in assets/showroom-src/polyhaven/textures/<folder>."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    nt, b = _principled(m)
    base = os.path.join(SRC, "textures", folder, folder)
    if os.path.exists(base + "_Diffuse.jpg"):
        d = _image(nt, base + "_Diffuse.jpg", "sRGB")
        if tint.upper() != "#FFFFFF":
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs["Factor"].default_value = 1.0
            mix.inputs["B"].default_value = hex_rgba(tint)
            nt.links.new(d.outputs["Color"], mix.inputs["A"])
            nt.links.new(mix.outputs["Result"], b.inputs["Base Color"])
        else:
            nt.links.new(d.outputs["Color"], b.inputs["Base Color"])
    else:  # a texture set without color (weave only): a plain tint
        b.inputs["Base Color"].default_value = hex_rgba(tint)
    if rough is None and os.path.exists(base + "_Rough.jpg"):
        r = _image(nt, base + "_Rough.jpg", "Non-Color")
        nt.links.new(r.outputs["Color"], b.inputs["Roughness"])
    else:
        b.inputs["Roughness"].default_value = 0.7 if rough is None else rough
    if os.path.exists(base + "_nor_gl.jpg"):
        n = _image(nt, base + "_nor_gl.jpg", "Non-Color")
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = normal
        nt.links.new(n.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    b.inputs["Metallic"].default_value = metal
    return m


# ------------------------------------------------------------------ geometry
def uv_box(obj, tile=4.0):
    """World-scale box projection: one texture repeat per `tile` metres on every face."""
    me = obj.data
    uv = me.uv_layers.get("UVMap") or me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            u, w = (v.y, v.z) if ax == 0 else (v.x, v.z) if ax == 1 else (v.x, v.y)
            uv.data[li].uv = (u / tile, w / tile)


SMOOTH_ANGLE = math.radians(50)


def _finish(name, bm, mat, parent, tile, closed=True):
    if closed:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)  # the axis swap of P() mirrors the mesh: make the faces point outwards again
    for e in bm.edges:  # hard edges where faces meet at a corner (boxes), smooth shading elsewhere (cylinders, bevels)
        e.smooth = len(e.link_faces) != 2 or e.calc_face_angle(0.0) < SMOOTH_ANGLE
    for f in bm.faces:
        f.smooth = True
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    if mat:
        me.materials.append(mat)
    if parent:
        obj.parent = parent
    if tile:
        uv_box(obj, tile)
    return obj


def box(name, c, s, mat, parent=None, step=0.0, tile=4.0, bevel=0.0):
    """A box centred on `c` (three.js axes) of size `s`; `step` > 0 subdivides it so a baked vertex color has some resolution."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    sx, sy, sz = s
    if step > 0:
        # one subdivision call per axis, on the edges that run along it
        for axis, dim in ((0, sx), (1, sz), (2, sy)):
            cuts = int(dim / step) - 1
            if cuts > 0:
                edges = [e for e in bm.edges if max(range(3), key=lambda i: abs(e.verts[0].co[i] - e.verts[1].co[i])) == axis]
                bmesh.ops.subdivide_edges(bm, edges=edges, cuts=cuts, use_grid_fill=True)
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sz, v.co.z * sy))
    if bevel > 0 and step <= 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, min(s) / 2.2), offset_type="OFFSET", segments=2, profile=0.6, affect="EDGES")
    bmesh.ops.translate(bm, vec=P(*c), verts=bm.verts)
    return _finish(name, bm, mat, parent, tile)


def grid(name, x0, x1, z0, z1, y, mat, parent=None, step=0.25, tile=4.0, up=True):
    """A horizontal quad grid at height `y` covering [x0,x1] x [z0,z1] (three.js axes)."""
    nx, nz = max(1, round((x1 - x0) / step)), max(1, round((z1 - z0) / step))
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=nx, y_segments=nz, size=0.5)
    for v in bm.verts:
        px = x0 + (v.co.x + 0.5) * (x1 - x0)
        pz = z0 + (v.co.y + 0.5) * (z1 - z0)
        v.co = P(px, y, pz)
    bm.faces.ensure_lookup_table()
    bm.normal_update()
    if (bm.faces[0].normal.z > 0) != up:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    return _finish(name, bm, mat, parent, tile, closed=False)


def cyl(name, c, r, length, axis, mat, parent=None, seg=28, tile=0, r2=None):
    """A cylinder (or cone when r2 is given) centred on `c`, running along the three.js axis `axis` ('x', 'y' = up, 'z')."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=length)
    if axis == "x":
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "Y"))
    elif axis == "z":
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "X"))
    bmesh.ops.translate(bm, vec=P(*c), verts=bm.verts)
    return _finish(name, bm, mat, parent, tile)


def sphere(name, c, r, mat, parent=None, scale=(1, 1, 1), seg=24):
    """An ellipsoid centred on `c`; `scale` = (x, y up, z) factors."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(8, seg // 2), radius=r)
    for v in bm.verts:
        v.co = Vector((v.co.x * scale[0], v.co.y * scale[2], v.co.z * scale[1]))
    bmesh.ops.translate(bm, vec=P(*c), verts=bm.verts)
    return _finish(name, bm, mat, parent, 0)


def wall(name, x0, x1, y0, y1, z0, z1, mat, parent=None, step=0.25, tile=4.0):
    """A thick wall as a box whose big faces are finely subdivided (for baked ambient occlusion)."""
    return box(name, ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (x1 - x0, y1 - y0, z1 - z0), mat, parent, step=step, tile=tile)


def empty(name, parent=None):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    if parent:
        e.parent = parent
    return e


def text3d(name, body, c, size, depth, mat, parent=None, rot_y=0.0):
    """Extruded letters standing on the back wall; `c` = centre (three.js axes), facing -z by default (towards the visitor)."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = body
    cu.size = size
    cu.extrude = depth / 2
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    obj = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = P(*c)
    obj.rotation_euler = (math.pi / 2, 0, math.pi + rot_y)  # stand up, face the visitor (who is at smaller z)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.view_layer.objects.active
    obj.data.materials.append(mat)
    if parent:
        obj.parent = parent
    return obj


# ------------------------------------------------------------------ baking and export
def bake_vertex_ao(objects, distance=3.0, samples=48):
    """Ambient occlusion into a vertex color on every object (read by the site as COLOR_0, which multiplies the base color)."""
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = samples
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type != "CPU"
        sc.cycles.device = "GPU"
    except Exception:
        sc.cycles.device = "CPU"
    if sc.world is None:
        sc.world = bpy.data.worlds.new("World")
    sc.world.use_nodes = True
    sc.world.light_settings.distance = distance
    sc.render.bake.target = "VERTEX_COLORS"
    bpy.ops.object.select_all(action="DESELECT")
    todo = []
    for o in objects:
        if o.type != "MESH" or len(o.data.vertices) == 0:
            continue
        ca = o.data.color_attributes.new(name="AO", type="FLOAT_COLOR", domain="POINT")
        o.data.color_attributes.active_color = ca
        o.select_set(True)
        todo.append(o)
    bpy.context.view_layer.objects.active = todo[0]
    bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")
    return todo


def lift_ao(objects, floor=0.38):
    """Occlusion never goes fully black: remap the baked value v to floor + (1 - floor) * v."""
    for o in objects:
        ca = o.data.color_attributes.get("AO")
        if not ca:
            continue
        for d in ca.data:
            r = d.color[0]
            v = floor + (1 - floor) * min(1.0, max(0.0, r))
            d.color = (v, v, v, 1.0)


def export_glb(path, **kw):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    opts = dict(filepath=path, export_format="GLB", export_apply=True, export_yup=True, export_cameras=False, export_lights=False, export_image_format="AUTO")
    opts.update(kw)
    bpy.ops.export_scene.gltf(**opts)


def preview(path, size=(1600, 900), samples=24, target=(20, 1.5, 12), cam=(54.8, 35.9, -22.8), scale=60.0):
    """Quick isometric render of the current scene (the same camera angle as the site)."""
    sc = bpy.context.scene
    cd = bpy.data.cameras.new("cam")
    cd.type = "ORTHO"
    cd.ortho_scale = scale
    co = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(co)
    co.location = P(*cam)
    direction = P(*target) - co.location
    co.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    sc.camera = co
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 3.0
    so = bpy.data.objects.new("sun", sun)
    sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(55), 0, math.radians(35))
    if sc.world is None:
        sc.world = bpy.data.worlds.new("World")
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.82, 0.86, 0.9, 1)
    bg.inputs["Strength"].default_value = 1.0
    sc.render.engine = "CYCLES"
    sc.cycles.samples = samples
    sc.render.resolution_x, sc.render.resolution_y = size
    sc.render.filepath = path
    sc.view_settings.view_transform = "AgX"
    bpy.ops.render.render(write_still=True)
