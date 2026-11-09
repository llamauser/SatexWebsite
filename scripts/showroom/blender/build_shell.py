"""Builds the building of the 3D showroom (floors, walls, mezzanine, stairs, columns, windows, trusses, lamps, floor markings).

    blender --background --python scripts/showroom/blender/build_shell.py -- --out .tmp/showroom/shell.glb [--preview .tmp/showroom/shell.png]

Two top-level groups are exported: `ground` (always shown) and `mezzanine` (hidden when only the ground floor is shown).
Ambient occlusion is baked into a vertex color (COLOR_0). Nothing in here depends on the departments: those are placed by the site.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *  # noqa: E402,F401,F403

W, D, WALL_H = SPEC["floorW"], SPEC["floorD"], SPEC["wallHeight"]
MZ0, MZTOP, MZT = SPEC["mezzanine"]["z0"], SPEC["mezzanine"]["slabTop"], SPEC["mezzanine"]["thickness"]
ST = SPEC["stairs"]
BLUE = "#1F6FEB"

reset()
a = args()

# ---------------------------------------------------------------- materials
concrete = tex_mat("floor_concrete", "painted_plaster_wall", tint="#C9CED6", rough=0.55, normal=0.5)
concrete_edge = tex_mat("concrete_edge", "concrete_floor_worn_001", tint="#FFFFFF", normal=0.6)
plaster = tex_mat("wall_plaster", "painted_plaster_wall", tint="#FFFFFF", normal=0.5)
plaster2 = tex_mat("wall_plaster_b", "painted_plaster_wall", tint="#F4F6FA", normal=0.5)
parquet = tex_mat("mezz_parquet", "laminate_floor_02", tint="#FFFFFF", rough=0.55, normal=0.6)
steel = flat_mat("steel_blue", "#9FB0C3", rough=0.45, metal=0.85)
steel_dark = flat_mat("steel_dark", "#4A5563", rough=0.5, metal=0.85)
steel_white = flat_mat("steel_white", "#E7EBF0", rough=0.5, metal=0.6)
chrome = flat_mat("handrail", "#C9CED4", rough=0.25, metal=1.0)
glass = flat_mat("glass", "#DCEBF5", rough=0.05, metal=0.0, alpha=0.18)
sky = flat_mat("window_sky", "#CFE3F7", rough=1.0, emission="#BFD9F2", emission_strength=1.4)
brand = flat_mat("brand_blue", BLUE, rough=0.4, metal=0.0)
paint_blue = flat_mat("paint_blue", "#2A6AA8", rough=0.6)
paint_yellow = flat_mat("paint_yellow", "#E8B83A", rough=0.6)
lamp_shade = flat_mat("lamp_shade", "#2F3945", rough=0.45, metal=0.6)
lamp_glow = flat_mat("lamp_glow", "#FFF4DC", rough=1.0, emission="#FFE9C0", emission_strength=6.0)
stair_tread = tex_mat("stair_tread", "concrete_floor_worn_001", tint="#C9CCD0", normal=0.6)

ground = empty("ground")
mezz = empty("mezzanine")
baked = []  # objects that get a baked occlusion


def add(o, bake=True):
    if bake:
        baked.append(o)
    return o


# ---------------------------------------------------------------- ground slab with a visible edge (a plinth, like a model)
add(grid("floor", -0.5, W + 0.5, -0.5, D + 0.5, 0.0, concrete, ground, step=0.5, tile=5.0))
add(box("plinth", (W / 2, -0.27, D / 2), (W + 1.0, 0.5, D + 1.0), concrete_edge, ground, tile=3.0), bake=False)

# ---------------------------------------------------------------- the two far walls (the near sides are open: a cut-away)
add(wall("wall_left", -0.4, 0.0, 0.0, WALL_H, -0.5, D + 0.4, plaster, ground, step=0.5))
add(wall("wall_back", -0.4, W + 0.5, 0.0, WALL_H, D, D + 0.4, plaster2, ground, step=0.5))
# dado band and skirting
add(box("dado_left", (0.02, 0.55, D / 2 - 0.05), (0.06, 1.1, D - 0.1), steel_dark, ground, step=0.5, tile=2.0))
add(box("dado_back", (W / 2, 0.55, D - 0.03), (W - 0.1, 1.1, 0.06), steel_dark, ground, step=0.5, tile=2.0))

# steel pilasters along the far walls
for i, x in enumerate([2.5, 10.6, 29.4, 37.5]):
    add(box(f"pilaster_back_{i}", (x, WALL_H / 2, D - 0.2), (0.45, WALL_H, 0.4), steel_white, ground, step=0.5, tile=2.0))
for i, z in enumerate([2.5, 8.5, 14.8, 19.5]):
    add(box(f"pilaster_left_{i}", (0.2, WALL_H / 2, z), (0.4, WALL_H, 0.45), steel_white, ground, step=0.5, tile=2.0))


def window(parent, nm, center, width, height, axis):
    """A tall steel-framed window; axis 'z' = on the back wall (faces -z), 'x' = on the left wall (faces +x)."""
    cx, cy, cz = center
    fr = 0.12
    deep = 0.14
    if axis == "z":
        add(box(f"{nm}_glass", (cx, cy, cz - 0.01), (width, height, 0.03), sky, parent, tile=0), bake=False)
        for k, (c, s) in enumerate([((cx, cy + height / 2, cz - deep / 2), (width + fr, fr, deep)), ((cx, cy - height / 2, cz - deep / 2), (width + fr, fr, deep)),
                                    ((cx - width / 2, cy, cz - deep / 2), (fr, height, deep)), ((cx + width / 2, cy, cz - deep / 2), (fr, height, deep)),
                                    ((cx, cy, cz - deep / 2), (0.06, height, 0.08)), ((cx, cy + height / 6, cz - deep / 2), (width, 0.06, 0.08))]):
            add(box(f"{nm}_f{k}", c, s, steel_dark, parent, tile=0), bake=False)
    else:
        add(box(f"{nm}_glass", (cx + 0.01, cy, cz), (0.03, height, width), sky, parent, tile=0), bake=False)
        for k, (c, s) in enumerate([((cx + deep / 2, cy + height / 2, cz), (deep, fr, width + fr)), ((cx + deep / 2, cy - height / 2, cz), (deep, fr, width + fr)),
                                    ((cx + deep / 2, cy, cz - width / 2), (deep, height, fr)), ((cx + deep / 2, cy, cz + width / 2), (deep, height, fr)),
                                    ((cx + deep / 2, cy, cz), (0.08, height, 0.06)), ((cx + deep / 2, cy + height / 6, cz), (0.08, 0.06, width))]):
            add(box(f"{nm}_f{k}", c, s, steel_dark, parent, tile=0), bake=False)


# clerestory windows above the mezzanine level
for i, x in enumerate([6.25, 15, 25, 33.75]):
    window(ground, f"win_back_{i}", (x, 6.3, D), 5.0, 2.4, "z")
for i, z in enumerate([5.5, 11.5, 17.2, 22.0]):
    window(ground, f"win_left_{i}", (0.0, 6.3, z), 4.2 if i < 3 else 3.0, 2.4, "x")
# tall windows on the ground floor of the left wall
for i, z in enumerate([5.5, 11.5]):
    window(ground, f"win_left_low_{i}", (0.0, 2.6, z), 4.2, 3.0, "x")

# the SATEX sign on the back wall, between the windows
add(text3d("sign_satex", "SATEX", (20, 6.3, D - 0.06), 1.25, 0.2, brand, ground), bake=False)

# ---------------------------------------------------------------- steel beams along the tops of the far walls (no roof: the visitor looks in from above)
add(box("beam_top_back", (W / 2, WALL_H - 0.25, D - 0.3), (W, 0.5, 0.3), steel_white, ground, step=0.5, tile=0))
add(box("beam_top_left", (0.3, WALL_H - 0.25, D / 2), (0.3, 0.5, D), steel_white, ground, step=0.5, tile=0))

# ---------------------------------------------------------------- floor markings (aisles)
for nm, c, s, m in [
    ("aisle_a", (16, 0.012, 9.0), (30, 0.02, 0.22), paint_blue),
    ("aisle_b", (31, 0.012, 10.0), (0.22, 0.02, 20), paint_blue),
    ("aisle_c", (1.1, 0.012, 11.4), (0.22, 0.02, 7.2), paint_blue),
    ("safety_1", (16, 0.012, 8.55), (30, 0.02, 0.08), paint_yellow),
    ("safety_2", (16, 0.012, 9.45), (30, 0.02, 0.08), paint_yellow),
]:
    add(box(nm, c, s, m, ground, tile=0), bake=False)

# ---------------------------------------------------------------- mezzanine (first floor over the back of the building)
mz_len = D - MZ0
add(grid("mezz_floor", 0.0, W, MZ0, D, MZTOP, parquet, mezz, step=0.5, tile=3.0), bake=True)
add(box("mezz_slab", (W / 2, MZTOP - MZT / 2 - 0.05, (MZ0 + D) / 2), (W, MZT - 0.1, mz_len), concrete_edge, mezz, step=1.0, tile=3.0))
# beams under the slab and columns
for i, z in enumerate([MZ0 + 0.5, (MZ0 + D) / 2, D - 0.6]):
    add(box(f"mezz_beam_{i}", (W / 2, MZTOP - MZT - 0.2, z), (W, 0.4, 0.22), steel, mezz, step=0.5, tile=0))
for i, (x, z) in enumerate([(1, 15.5), (13, 15.5), (27, 15.5), (39, 15.5), (1, 23), (13, 23), (27, 23), (39, 23), (20, 15.5), (20, 23)]):
    add(box(f"column_{i}", (x, MZTOP / 2 - 0.1, z), (0.35, MZTOP - 0.1, 0.35), steel_white, mezz, step=0.5, tile=0))

# glass balustrade along the two open edges of the mezzanine; the front one stops short of the stairs, which land at x < 2.1
rail_y = MZTOP
RX0 = ST["x1"] + 0.3  # first railing post, beyond the landing
for i, x in enumerate([RX0 + k * 2.0 for k in range(0, int((W - RX0) / 2) + 1)] + [W]):
    add(box(f"rail_post_f{i}", (x, rail_y + 0.55, MZ0 + 0.05), (0.05, 1.1, 0.05), chrome, mezz, tile=0), bake=False)
add(box("rail_hand_f", ((RX0 + W) / 2, rail_y + 1.1, MZ0 + 0.05), (W - RX0, 0.05, 0.07), chrome, mezz, tile=0), bake=False)
add(box("rail_glass_f", ((RX0 + W) / 2, rail_y + 0.58, MZ0 + 0.05), (W - RX0, 0.95, 0.02), glass, mezz, tile=0), bake=False)
for i, z in enumerate([MZ0 + k * 1.84 for k in range(0, 6)] + [D]):
    add(box(f"rail_post_s{i}", (W - 0.05, rail_y + 0.55, z), (0.05, 1.1, 0.05), chrome, mezz, tile=0), bake=False)
add(box("rail_hand_s", (W - 0.05, rail_y + 1.1, (MZ0 + D) / 2), (0.07, 0.05, mz_len), chrome, mezz, tile=0), bake=False)
add(box("rail_glass_s", (W - 0.05, rail_y + 0.58, (MZ0 + D) / 2), (0.02, 0.95, mz_len), glass, mezz, tile=0), bake=False)

# ---------------------------------------------------------------- stairs from the ground floor up to the mezzanine
x0, x1, zb, zt = ST["x0"], ST["x1"], ST["zBottom"], ST["zTop"]
n = 22
rise, run = MZTOP / n, (zt - zb) / n
for k in range(n):
    top = rise * (k + 1)
    add(box(f"step_{k}", ((x0 + x1) / 2, top / 2, zb + run * (k + 0.5)), (x1 - x0, top, run), stair_tread, mezz, step=0.4, tile=1.5))
for side, xx in (("l", x0 + 0.03), ("r", x1 - 0.03)):
    # stringer plus handrail on the open (right) side
    pass
add(box("stair_rail_post_0", (x1 - 0.04, 0.55, zb + run * 0.5), (0.05, 1.1, 0.05), chrome, mezz, tile=0), bake=False)
for k in range(0, n, 3):
    add(box(f"stair_rail_post_{k + 1}", (x1 - 0.04, rise * (k + 1) + 0.55, zb + run * (k + 0.5)), (0.05, 1.1, 0.05), chrome, mezz, tile=0), bake=False)
# the handrail follows the slope: one rotated box
import math as _m  # noqa: E402
slope = _m.atan2(MZTOP, zt - zb)
length = _m.hypot(MZTOP, zt - zb)
hr = box("stair_hand", (x1 - 0.04, MZTOP / 2 + 1.1, (zb + zt) / 2), (0.07, 0.05, length), chrome, mezz, tile=0)
hr.rotation_euler = (slope, 0, 0)  # Blender rotates about X: positive tilts towards the back
hr.location = P(x1 - 0.04, MZTOP / 2 + 1.1, (zb + zt) / 2)

# ---------------------------------------------------------------- bake occlusion and export
objs = [o for o in bpy.data.objects if o.type == "MESH" and o in baked]
bake_vertex_ao(objs, distance=2.6, samples=int(a.get("samples", 48)))
lift_ao(objs, floor=0.42)
# ---------------------------------------------------------------- one mesh per material in each group (fewer draw calls)
for o in [o for o in bpy.data.objects if o.type == "MESH"]:
    if o.data.color_attributes.get("AO") is None:  # objects that were not baked are fully lit
        ca = o.data.color_attributes.new(name="AO", type="FLOAT_COLOR", domain="POINT")
        for d in ca.data:
            d.color = (1, 1, 1, 1)
for grp in (ground, mezz):
    by_mat = {}
    for o in [c for c in grp.children if c.type == "MESH"]:
        by_mat.setdefault(o.data.materials[0].name if o.data.materials else "none", []).append(o)
    for key, objs in by_mat.items():
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        bpy.context.view_layer.objects.active.name = f"{grp.name}_{key}"

if a.get("preview"):
    preview(a["preview"])
if a.get("out"):
    export_glb(a["out"], export_vertex_color="ACTIVE")
    print("EXPORTED", a["out"], os.path.getsize(a["out"]))
