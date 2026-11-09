"""Builds the library of objects the 3D showroom places inside its departments (racks, fabric rolls, tables, a forklift, furniture, plants...).

    blender --background --python scripts/showroom/blender/build_props.py -- --out .tmp/showroom/props.raw.glb [--sheet .tmp/showroom/props.png]

Every prop is an empty `prop_<name>` standing at the origin (floor level, centred) with one mesh per material below it, front facing +z.
The site finds them by name and instances them; some materials are tinted per instance (fabric rolls take the colors of the fabrics in stock).
Parts modelled here use the dimensions in src/lib/showroom/spec.json; the rest comes from Poly Haven (CC0), decimated for the web.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *  # noqa: E402,F401,F403

RACK = SPEC["rack"]
ROLL = RACK["roll"]

reset()
a = args()

# ---------------------------------------------------------------- materials
blue = flat_mat("rack_blue", "#1F5FBF", rough=0.45, metal=0.3)
orange = flat_mat("rack_orange", "#E8781E", rough=0.45, metal=0.3)
deck = flat_mat("rack_deck", "#8A949F", rough=0.6, metal=0.7)
steel = flat_mat("p_steel", "#9AA6B2", rough=0.4, metal=0.9)
steel_dark = flat_mat("p_steel_dark", "#3C4651", rough=0.5, metal=0.8)
rubber = flat_mat("rubber", "#1B1E22", rough=0.9)
laminate = flat_mat("laminate_white", "#ECEFF2", rough=0.35)
wood = flat_mat("wood_light", "#C8A573", rough=0.7)
wood_pallet = flat_mat("pallet_wood", "#B98F5C", rough=0.9)
cardboard = flat_mat("cardboard", "#C69663", rough=0.85)
tape = flat_mat("tape", "#E4D2B0", rough=0.5)
wrap = flat_mat("stretch_wrap", "#F4F8FF", rough=0.15, alpha=0.16)
yellow = flat_mat("forklift_yellow", "#F2B21E", rough=0.4, metal=0.2)
amber = flat_mat("beacon", "#FFB000", rough=0.3, emission="#FF9A00", emission_strength=2.5)
seat = flat_mat("seat", "#23272D", rough=0.8)
screen = flat_mat("monitor_screen", "#16222F", rough=0.3, emission="#24476E", emission_strength=0.9)
linen = flat_mat("mannequin_linen", "#D9CBB4", rough=0.85)
ruler = flat_mat("ruler_yellow", "#E6B422", rough=0.5)
core_mat = flat_mat("roll_core", "#B98F5C", rough=0.9)
tag = flat_mat("roll_tag", "#F2F2EF", rough=0.7)
fabric = tex_mat("roll_fabric", "fabric_pattern_05", tint="#FFFFFF", rough=0.92, normal=1.0)
fabric.node_tree.nodes["Principled BSDF"].inputs["Sheen Weight"].default_value = 0.5
fabric.node_tree.nodes["Principled BSDF"].inputs["Sheen Roughness"].default_value = 0.5

props = {}  # name -> empty


def new_prop(name):
    e = empty(f"prop_{name}")
    props[name] = e
    return e


# ---------------------------------------------------------------- rack bay: blue uprights, orange beams, steel decks
def build_rack():
    e = new_prop("rack_bay")
    w, d, h = RACK["bayW"], RACK["bayD"], RACK["height"]
    for sx in (-1, 1):
        for sz in (-1, 1):
            box(f"upright_{sx}_{sz}", (sx * (w / 2 - 0.05), h / 2, sz * (d / 2 - 0.04)), (0.1, h, 0.08), blue, e, bevel=0.01)
        # side bracing between the two uprights of a frame
        for k in range(3):
            y0, y1 = 0.3 + k * 0.95, 1.2 + k * 0.95
            if y1 < h:
                box(f"brace_{sx}_{k}", (sx * (w / 2 - 0.05), (y0 + y1) / 2, 0), (0.04, 0.04, d - 0.1), blue, e)
    for i, y in enumerate(RACK["levels"]):
        for sz in (-1, 1):
            box(f"beam_{i}_{sz}", (0, y + RACK["beamH"] / 2, sz * (d / 2 - 0.04)), (w - 0.1, RACK["beamH"], 0.06), orange, e, bevel=0.008)
        box(f"deck_{i}", (0, y + 0.01, 0), (w - 0.14, 0.02, d - 0.14), deck, e)
    box("foot_l", (-(w / 2 - 0.05), 0.02, 0), (0.12, 0.04, d + 0.04), blue, e)
    box("foot_r", ((w / 2 - 0.05), 0.02, 0), (0.12, 0.04, d + 0.04), blue, e)


# ---------------------------------------------------------------- a roll of fabric (tinted per instance by the site)
def build_roll():
    e = new_prop("fabric_roll")
    cyl("fabric", (0, ROLL["radius"], 0), ROLL["radius"], ROLL["length"], "x", fabric, e, seg=28)
    cyl("core", (0, ROLL["radius"], 0), 0.045, ROLL["length"] + 0.1, "x", core_mat, e, seg=14)
    cyl("tag", (0.1, ROLL["radius"], 0), ROLL["radius"] + 0.004, 0.09, "x", tag, e, seg=28)


# ---------------------------------------------------------------- cutting table with fabric spread on it and a roll on a stand
def build_cutting_table():
    e = new_prop("cutting_table")
    L, Wd, H = 4.0, 1.6, 0.92
    box("top", (0, H - 0.03, 0), (L, 0.06, Wd), laminate, e, bevel=0.012)
    box("edge", (0, H - 0.07, 0), (L - 0.04, 0.04, Wd - 0.04), steel, e)
    for sx in (-1, 1):
        for sz in (-1, 1):
            box(f"leg_{sx}_{sz}", (sx * (L / 2 - 0.15), (H - 0.08) / 2, sz * (Wd / 2 - 0.12)), (0.07, H - 0.08, 0.07), steel_dark, e, bevel=0.01)
    box("rail_front", (0, 0.2, -(Wd / 2 - 0.12)), (L - 0.3, 0.04, 0.04), steel_dark, e)
    box("rail_back", (0, 0.2, (Wd / 2 - 0.12)), (L - 0.3, 0.04, 0.04), steel_dark, e)
    box("ruler_front", (0, H + 0.001, -(Wd / 2 - 0.05)), (L - 0.1, 0.004, 0.06), ruler, e)
    # layers of fabric being cut
    for k, (ox, oz, c) in enumerate([(-0.5, 0.0, "#9DB8D6"), (-0.5, 0.0, "#A9C3DD"), (-0.5, 0.0, "#9DB8D6")]):
        box(f"layer_{k}", (ox, H + 0.01 + k * 0.012, oz), (2.3, 0.012, 1.2), flat_mat(f"layer_{c}_{k}", c, rough=0.9), e)
    # the roll on a cradle at one end
    cyl("spread_roll", (1.55, H + 0.2, 0), 0.17, 1.2, "z", flat_mat("spread_roll", "#9DB8D6", rough=0.9), e, seg=24)
    box("cradle_a", (1.55, H + 0.03, -0.45), (0.3, 0.06, 0.05), steel_dark, e)
    box("cradle_b", (1.55, H + 0.03, 0.45), (0.3, 0.06, 0.05), steel_dark, e)


# ---------------------------------------------------------------- a pallet with boxes under stretch film
def build_pallet_load():
    e = new_prop("pallet_load")
    for z in (-0.33, 0, 0.33):
        box(f"stringer_{z}", (0, 0.06, z), (1.2, 0.09, 0.09), wood_pallet, e, bevel=0.006)
    for i in range(5):
        box(f"top_{i}", (0, 0.125, -0.36 + i * 0.18), (1.2, 0.025, 0.12), wood_pallet, e)
    for i in range(3):
        box(f"bottom_{i}", (-0.55 + i * 0.55, 0.012, 0), (0.12, 0.025, 0.8), wood_pallet, e)
    for layer in range(3):
        for ix in range(2):
            for iz in range(2):
                box(f"box_{layer}_{ix}_{iz}", (-0.29 + ix * 0.58, 0.14 + 0.15 + layer * 0.3, -0.19 + iz * 0.38), (0.56, 0.29, 0.36), cardboard, e, bevel=0.01)
                box(f"tape_{layer}_{ix}_{iz}", (-0.29 + ix * 0.58, 0.14 + 0.15 + layer * 0.3 + 0.147, -0.19 + iz * 0.38), (0.08, 0.004, 0.36), tape, e)
    box("film", (0, 0.14 + 0.45, 0), (1.18, 0.9, 0.78), wrap, e, bevel=0.03)


# ---------------------------------------------------------------- forklift (forks point to +z)
def build_forklift():
    e = new_prop("forklift")
    box("chassis", (0, 0.5, 0.1), (1.05, 0.5, 1.6), yellow, e, bevel=0.04)
    box("counterweight", (0, 0.72, -0.78), (1.1, 0.76, 0.5), yellow, e, bevel=0.06)
    box("floor_plate", (0, 0.78, 0.35), (0.9, 0.04, 0.8), steel_dark, e)
    for sx in (-1, 1):
        for z in (-0.45, 0.4):
            box(f"post_{sx}_{z}", (sx * 0.46, 1.4, z), (0.05, 1.3, 0.05), steel_dark, e)
    box("roof", (0, 2.07, -0.02), (1.05, 0.05, 1.0), steel_dark, e, bevel=0.012)
    box("seat", (0, 1.0, -0.38), (0.42, 0.12, 0.42), seat, e, bevel=0.02)
    box("seat_back", (0, 1.25, -0.6), (0.42, 0.42, 0.08), seat, e, bevel=0.02)
    cyl("steering", (0, 1.28, 0.12), 0.15, 0.03, "y", seat, e, seg=24)
    box("column", (0, 1.05, 0.2), (0.05, 0.4, 0.05), steel_dark, e)
    cyl("beacon", (0.3, 2.14, -0.2), 0.06, 0.1, "y", amber, e, seg=14)
    for sx in (-1, 1):
        box(f"mast_{sx}", (sx * 0.32, 1.0, 0.92), (0.08, 2.0, 0.08), steel_dark, e)
        box(f"fork_{sx}", (sx * 0.3, 0.06, 1.55), (0.12, 0.05, 1.1), steel, e, bevel=0.008)
        box(f"fork_up_{sx}", (sx * 0.3, 0.45, 1.03), (0.12, 0.8, 0.05), steel, e, bevel=0.008)
    box("mast_top", (0, 1.95, 0.92), (0.72, 0.07, 0.07), steel_dark, e)
    box("mast_mid", (0, 1.1, 0.92), (0.72, 0.06, 0.06), steel_dark, e)
    box("carriage", (0, 0.4, 1.0), (0.84, 0.5, 0.04), steel_dark, e)
    for sx in (-1, 1):
        cyl(f"wheel_f_{sx}", (sx * 0.52, 0.33, 0.62), 0.33, 0.22, "x", rubber, e, seg=24)
        cyl(f"wheel_b_{sx}", (sx * 0.46, 0.26, -0.7), 0.26, 0.18, "x", rubber, e, seg=24)


# ---------------------------------------------------------------- office desk with a monitor
def build_desk():
    e = new_prop("desk")
    box("top", (0, 0.74, 0), (1.6, 0.04, 0.8), laminate, e, bevel=0.01)
    box("panel_l", (-0.75, 0.37, 0), (0.04, 0.72, 0.74), steel, e)
    box("drawers", (0.55, 0.36, 0), (0.45, 0.7, 0.72), laminate, e, bevel=0.01)
    for k in range(3):
        box(f"handle_{k}", (0.55, 0.12 + k * 0.22, -0.375), (0.18, 0.015, 0.015), steel, e)
    box("monitor_stand", (0, 0.78, 0.18), (0.05, 0.1, 0.04), steel_dark, e)
    box("monitor_base", (0, 0.765, 0.18), (0.22, 0.012, 0.14), steel_dark, e)
    box("monitor", (0, 1.05, 0.2), (0.62, 0.36, 0.025), seat, e, bevel=0.006)
    box("monitor_screen", (0, 1.05, 0.186), (0.58, 0.32, 0.004), screen, e)
    box("keyboard", (0, 0.768, -0.12), (0.42, 0.015, 0.14), steel_dark, e, bevel=0.004)
    box("mouse", (0.3, 0.768, -0.12), (0.06, 0.02, 0.1), steel_dark, e, bevel=0.006)


# ---------------------------------------------------------------- meeting table, and a dress form for the studio
def build_meeting_table():
    e = new_prop("meeting_table")
    box("top", (0, 0.74, 0), (2.6, 0.05, 1.2), wood, e, bevel=0.015)
    for sx in (-1, 1):
        box(f"leg_{sx}", (sx * 1.1, 0.36, 0), (0.07, 0.72, 0.9), steel_dark, e)
    box("stretcher", (0, 0.2, 0), (2.2, 0.04, 0.05), steel_dark, e)


def build_mannequin():
    e = new_prop("mannequin")
    cyl("base", (0, 0.015, 0), 0.26, 0.03, "y", steel_dark, e)
    cyl("pole", (0, 0.55, 0), 0.018, 1.05, "y", steel, e, seg=12)
    sphere("torso", (0, 1.25, 0), 0.16, linen, e, scale=(1.0, 1.9, 0.72))
    sphere("hips", (0, 1.0, 0), 0.17, linen, e, scale=(1.05, 1.0, 0.8))
    cyl("neck", (0, 1.58, 0), 0.04, 0.1, "y", linen, e, seg=12)
    sphere("shoulders", (0, 1.5, 0), 0.19, linen, e, scale=(1.0, 0.35, 0.5))
    cyl("cap", (0, 1.64, 0), 0.025, 0.03, "y", steel, e, seg=12)


# ---------------------------------------------------------------- Poly Haven models, cleaned up for the web
PH = {  # name -> (target triangles, rename)
    "sofa_02": (2600, "sofa"), "modern_arm_chair_01": (3200, "armchair"), "modern_coffee_table_01": (1800, "coffee_table"),
    "modern_wooden_cabinet": (4000, "cabinet"), "potted_plant_01": (7000, "plant_tall"), "potted_plant_02": (6000, "plant_wide"),
    "potted_plant_04": (2500, "plant_small"), "dining_chair_02": (3000, "chair"), "hand_truck": (3000, "hand_truck"),
    "plastic_crate_01": (1800, "crate"), "cardboard_box_01": (1500, "box"), "desk_lamp_arm_01": (3000, "desk_lamp"),
    "projector_screen": (3000, "screen"), "throw_pillows_01": (2500, "pillows"),
}


def import_ph(src, tris, name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, "models", src, src + ".gltf"))
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    for o in new:
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # one mesh per material, then decimate to the triangle budget
    groups = {}
    for o in meshes:
        groups.setdefault(o.data.materials[0].name if o.data.materials else "none", []).append(o)
    merged = []
    for _, objs in groups.items():
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        merged.append(bpy.context.view_layer.objects.active)
    total = sum(len(o.data.polygons) for o in merged)
    for o in merged:
        share = tris * len(o.data.polygons) / max(1, total)
        ratio = min(1.0, share / max(1, len(o.data.polygons)))
        if ratio < 0.98:
            m = o.modifiers.new("dec", "DECIMATE")
            m.ratio = max(0.003, ratio)
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier="dec")
    # stand it on the floor, centred
    mn = Vector((1e9,) * 3)
    mx = Vector((-1e9,) * 3)
    for o in merged:
        for c in o.bound_box:
            mn = Vector(map(min, mn, c))
            mx = Vector(map(max, mx, c))
    off = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
    e = new_prop(name)
    for o in merged:
        o.location -= off
        o.parent = e
        o.name = f"{name}_{o.data.materials[0].name if o.data.materials else 'part'}"
    bpy.ops.object.select_all(action="DESELECT")
    for o in merged:
        o.select_set(True)
    bpy.context.view_layer.objects.active = merged[0]
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    for o in merged:
        for p in o.data.polygons:
            p.use_smooth = True
    return e


build_rack()
build_roll()
build_cutting_table()
build_pallet_load()
build_forklift()
build_desk()
build_meeting_table()
build_mannequin()
only = a.get("only")
for src, (tris, name) in PH.items():
    if only and name not in str(only).split(","):
        continue
    import_ph(src, tris, name)
    print("IMPORTED", name)

# ---------------------------------------------------------------- one mesh per material (fewer draw calls)
def merge_by_material(e):
    groups = {}
    for o in e.children:
        if o.type == "MESH":
            groups.setdefault(o.data.materials[0].name if o.data.materials else "none", []).append(o)
    for key, objs in groups.items():
        if len(objs) > 1:
            bpy.ops.object.select_all(action="DESELECT")
            for o in objs:
                o.select_set(True)
            bpy.context.view_layer.objects.active = objs[0]
            bpy.ops.object.join()
            bpy.context.view_layer.objects.active.name = f"{e.name[5:]}_{key}"


for e in props.values():
    merge_by_material(e)

# ---------------------------------------------------------------- report, preview sheet, export
for name, e in props.items():
    kids = [o for o in e.children if o.type == "MESH"]
    print("PROP %-14s meshes=%-3d tris=%d" % (name, len(kids), sum(len(o.data.polygons) for o in kids)))

if a.get("sheet"):
    # lay the props out in rows on a floor for a picture; the export below happens from the same positions reset to the origin
    names = list(props)
    cols = 6
    for i, n in enumerate(names):
        props[n].location = P((i % cols) * 4.2, 0, (i // cols) * 4.2)
    box("sheet_floor", (cols * 2.1, -0.05, 4.2 * (len(names) // cols + 1) / 2 - 1), (cols * 4.4, 0.1, 4.2 * (len(names) // cols + 1) + 2), flat_mat("sheet_floor", "#D8DDE3", rough=0.9), None)
    preview(a["sheet"], size=(1800, 1000), samples=20, target=(cols * 2.1 - 2, 0.6, 4.0), cam=(cols * 2.1 + 22, 18, -16), scale=26.0)
    for n in names:
        props[n].location = (0, 0, 0)
    bpy.data.objects["sheet_floor"].hide_viewport = True
    bpy.data.objects["sheet_floor"].hide_render = True
    bpy.data.objects.remove(bpy.data.objects["sheet_floor"], do_unlink=True)
    for o in list(bpy.data.objects):
        if o.type in ("CAMERA", "LIGHT"):
            bpy.data.objects.remove(o, do_unlink=True)
if a.get("out"):
    export_glb(a["out"])
    print("EXPORTED", a["out"], os.path.getsize(a["out"]))
