"""The figures of the showroom: people, a tailor's dress form and a forklift. Each function builds into the empty `e` (floor level, facing +z)."""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *  # noqa: E402,F401,F403


# ---------------------------------------------------------------- people
def person(e, pose, m):
    """A stylised person, 1.72 m tall, with the clothes, skin and hair as separate (tintable) materials. pose: standing | walking | holding | seated."""
    seated = pose == "seated"
    H = 0.47 if seated else 0.92  # height of the hips
    back = -0.05 if seated else 0.0  # the hips sit a little behind the middle when seated
    for name, rings, mat in (
        ("pelvis", [(H - 0.07, 0.15, 0.10, 0, back), (H, 0.165, 0.105, 0, back), (H + 0.13, 0.15, 0.095, 0, back)], m["bottom"]),
        ("torso", [(H + 0.10, 0.145, 0.095, 0, back), (H + 0.20, 0.14, 0.09, 0, back), (H + 0.38, 0.175, 0.10, 0, back), (H + 0.53, 0.20, 0.09, 0, back), (H + 0.60, 0.09, 0.07, 0, back)], m["top"]),
    ):
        loft(name, rings, mat, e, seg=18)
    segment("neck", (0, H + 0.58, back), (0, H + 0.67, back + 0.01), 0.05, 0.045, m["skin"], e, seg=10)
    sphere("head", (0, H + 0.775, back + 0.012), 0.105, m["skin"], e, scale=(0.9, 1.12, 1.0), seg=16)
    sphere("hair", (0, H + 0.80, back - 0.012), 0.112, m["hair"], e, scale=(0.94, 1.02, 1.04), seg=14)

    legs = {
        "standing": {1: ((0.09, 0.5, 0.02), (0.09, 0.08, 0.0)), -1: ((-0.09, 0.5, 0.02), (-0.09, 0.08, 0.0))},
        "holding": {1: ((0.09, 0.5, 0.02), (0.09, 0.08, 0.0)), -1: ((-0.09, 0.5, 0.0), (-0.1, 0.08, -0.04))},
        "walking": {1: ((0.09, 0.5, 0.17), (0.09, 0.1, 0.38)), -1: ((-0.09, 0.48, -0.12), (-0.09, 0.12, -0.32))},
        "seated": {1: ((0.09, 0.5, 0.40), (0.09, 0.08, 0.42)), -1: ((-0.09, 0.5, 0.40), (-0.09, 0.08, 0.42))},
    }[pose]
    for s, (knee, ankle) in legs.items():
        hip = (s * 0.085, H, back)
        segment(f"thigh_{s}", hip, knee, 0.088, 0.063, m["bottom"], e, seg=12)
        sphere(f"knee_{s}", knee, 0.063, m["bottom"], e, seg=10)
        segment(f"shin_{s}", knee, ankle, 0.058, 0.042, m["bottom"], e, seg=12)
        toe = (ankle[0], 0.04, ankle[2] + 0.14)
        segment(f"shoe_{s}", (ankle[0], 0.06, ankle[2] - 0.02), toe, 0.052, 0.042, m["shoe"], e, seg=10)

    arms = {
        "standing": {1: ((0.235, H + 0.24, 0.01), (0.245, H - 0.03, 0.03)), -1: ((-0.235, H + 0.24, 0.01), (-0.245, H - 0.03, 0.03))},
        "holding": {1: ((0.22, H + 0.27, 0.1), (0.12, H + 0.42, 0.27)), -1: ((-0.235, H + 0.24, 0.01), (-0.245, H - 0.03, 0.03))},
        "walking": {1: ((0.23, H + 0.25, -0.1), (0.24, H + 0.0, -0.2)), -1: ((-0.23, H + 0.25, 0.12), (-0.24, H + 0.03, 0.26))},
        "seated": {1: ((0.24, H + 0.26, back + 0.08), (0.12, H + 0.12, back + 0.3)), -1: ((-0.24, H + 0.26, back + 0.08), (-0.12, H + 0.12, back + 0.3))},
    }[pose]
    for s, (elbow, wrist) in arms.items():
        shoulder = (s * 0.2, H + 0.52, back)
        segment(f"arm_{s}", shoulder, elbow, 0.056, 0.047, m["top"], e, seg=10)
        sphere(f"shoulder_{s}", shoulder, 0.058, m["top"], e, seg=10)
        segment(f"forearm_{s}", elbow, wrist, 0.043, 0.032, m["skin"], e, seg=10)
        sphere(f"hand_{s}", wrist, 0.04, m["skin"], e, seg=10)
    if pose == "holding":  # a clipboard
        box("clipboard", (0.13, H + 0.43, 0.29), (0.24, 0.32, 0.015), m["board"], e, bevel=0.004)


# ---------------------------------------------------------------- a tailor's dress form on its stand
def dress_form(e, m):
    rings = [(0.80, 0.150, 0.095), (0.88, 0.165, 0.105), (1.00, 0.140, 0.092), (1.12, 0.145, 0.098), (1.24, 0.160, 0.112), (1.34, 0.165, 0.098),
             (1.42, 0.150, 0.085), (1.48, 0.085, 0.062), (1.52, 0.048, 0.046)]
    loft("torso", rings, m["linen"], e, seg=32)
    for s in (-1, 1):
        sphere(f"shoulder_{s}", (s * 0.165, 1.395, 0), 0.05, m["linen"], e, scale=(1.0, 0.8, 0.9), seg=14)
    cyl("neck_cap", (0, 1.545, 0), 0.034, 0.05, "y", m["steel"], e, seg=16)
    sphere("knob", (0, 1.585, 0), 0.022, m["steel"], e, seg=12)
    cyl("pole", (0, 0.41, 0), 0.017, 0.82, "y", m["steel"], e, seg=12)
    cyl("collar", (0, 0.78, 0), 0.03, 0.04, "y", m["steel_dark"], e, seg=14)
    for k in range(3):  # a tripod foot
        a = math.radians(90 + k * 120)
        segment(f"leg_{k}", (0, 0.08, 0), (0.26 * math.cos(a), 0.018, 0.26 * math.sin(a)), 0.014, 0.012, m["steel_dark"], e, seg=8)
        sphere(f"foot_{k}", (0.26 * math.cos(a), 0.016, 0.26 * math.sin(a)), 0.02, m["rubber"], e, seg=8)
    cyl("hub", (0, 0.07, 0), 0.04, 0.1, "y", m["steel_dark"], e, seg=14)


# ---------------------------------------------------------------- forklift (forks point to +z)
def forklift(e, m):
    y, dark, steel, rubber, seat, amber, lamp, red = m["yellow"], m["steel_dark"], m["steel"], m["rubber"], m["seat"], m["amber"], m["lamp"], m["red"]
    box("chassis", (0, 0.40, 0.12), (1.0, 0.36, 1.55), y, e, bevel=0.05)
    box("counterweight", (0, 0.66, -0.80), (1.06, 0.80, 0.52), y, e, bevel=0.09)
    box("hood", (0, 0.89, -0.40), (0.86, 0.22, 0.62), y, e, bevel=0.06)
    box("footplate", (0, 0.60, 0.40), (0.86, 0.05, 0.7), dark, e)
    for s in (-1, 1):
        box(f"step_{s}", (s * 0.52, 0.30, 0.18), (0.14, 0.04, 0.36), dark, e)
        box(f"fender_{s}", (s * 0.47, 0.64, 0.60), (0.12, 0.06, 0.55), y, e, bevel=0.02)
    # seat, dashboard, steering
    box("seat", (0, 0.98, -0.30), (0.42, 0.10, 0.40), seat, e, bevel=0.03)
    box("backrest", (0, 1.28, -0.50), (0.42, 0.50, 0.08), seat, e, bevel=0.03)
    box("headrest", (0, 1.60, -0.52), (0.26, 0.14, 0.07), seat, e, bevel=0.03)
    box("dashboard", (0, 1.00, 0.42), (0.52, 0.38, 0.20), dark, e, bevel=0.03)
    segment("column", (0, 1.05, 0.40), (0, 1.32, 0.20), 0.025, 0.025, dark, e, seg=10)
    cyl("steering", (0, 1.34, 0.2), 0.15, 0.028, "y", seat, e, seg=24)
    # overhead guard
    for sx in (-1, 1):
        for z in (-0.52, 0.52):
            box(f"post_{sx}_{z}", (sx * 0.46, 1.48, z), (0.05, 1.05, 0.05), dark, e)
    box("roof_frame", (0, 2.04, 0), (1.02, 0.05, 1.18), dark, e, bevel=0.01)
    for k in range(6):
        box(f"roof_bar_{k}", (0, 2.065, -0.5 + k * 0.2), (0.96, 0.02, 0.03), dark, e)
    cyl("beacon", (0.34, 2.14, -0.44), 0.06, 0.12, "y", amber, e, seg=14)
    # mast: two channels, cross members, chains, carriage, backrest, forks
    for sx in (-1, 1):
        box(f"mast_out_{sx}", (sx * 0.34, 1.0, 0.98), (0.09, 2.0, 0.1), dark, e)
        box(f"mast_in_{sx}", (sx * 0.34, 0.9, 1.06), (0.07, 1.7, 0.05), steel, e)
        cyl(f"cylinder_{sx}", (sx * 0.34, 0.5, 0.78), 0.035, 1.0, "y", steel, e, seg=10)
    for yy in (0.18, 1.0, 1.96):
        box(f"mast_cross_{yy}", (0, yy, 0.98), (0.7, 0.06, 0.08), dark, e)
    for sx in (-0.12, 0.12):
        cyl(f"chain_{sx}", (sx, 1.05, 1.1), 0.008, 1.6, "y", steel, e, seg=6)
    box("carriage", (0, 0.42, 1.12), (0.86, 0.36, 0.05), dark, e)
    for k in range(5):
        box(f"guard_bar_{k}", (-0.36 + k * 0.18, 0.88, 1.12), (0.03, 0.66, 0.03), dark, e)
    box("guard_top", (0, 1.22, 1.12), (0.86, 0.03, 0.03), dark, e)
    for sx in (-1, 1):
        box(f"fork_{sx}", (sx * 0.3, 0.075, 1.68), (0.13, 0.045, 1.1), steel, e, bevel=0.008)
        box(f"fork_tip_{sx}", (sx * 0.3, 0.06, 2.3), (0.11, 0.03, 0.16), steel, e, bevel=0.006)
        box(f"fork_up_{sx}", (sx * 0.3, 0.34, 1.12), (0.13, 0.62, 0.05), steel, e, bevel=0.008)
    # wheels: tyre, rim, hub
    for sx in (-1, 1):
        for name, z, r, w in (("f", 0.62, 0.34, 0.24), ("b", -0.72, 0.26, 0.2)):
            cyl(f"tyre_{name}_{sx}", (sx * 0.52, r, z), r, w, "x", rubber, e, seg=28)
            cyl(f"rim_{name}_{sx}", (sx * (0.52 + w / 2 + 0.002), r, z), r * 0.55, 0.02, "x", steel, e, seg=20)
            cyl(f"hub_{name}_{sx}", (sx * (0.52 + w / 2 + 0.012), r, z), r * 0.18, 0.025, "x", dark, e, seg=10)
    # lights, stripes, exhaust
    for sx in (-1, 1):
        box(f"headlight_{sx}", (sx * 0.34, 0.74, 0.86), (0.14, 0.08, 0.04), lamp, e, bevel=0.01)
        box(f"taillight_{sx}", (sx * 0.4, 0.84, -1.07), (0.12, 0.08, 0.03), red, e, bevel=0.01)
    for k in range(8):  # hazard stripes on the back
        if k % 2 == 0:
            box(f"stripe_{k}", (-0.45 + k * 0.128, 0.40, -1.065), (0.064, 0.14, 0.01), dark, e)
    cyl("exhaust", (0.36, 1.12, -0.95), 0.03, 0.62, "y", dark, e, seg=10)
