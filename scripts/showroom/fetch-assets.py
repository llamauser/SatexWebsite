"""Downloads the free CC0 assets the 3D showroom is built from (https://polyhaven.com, licence CC0: no attribution required).

    python scripts/showroom/fetch-assets.py

Raw files go to assets/showroom-src/polyhaven/ (git-ignored). The Blender scripts in scripts/showroom/ turn them, with the
parts modelled in this repository, into public/showroom/*.glb, which is what the site serves.
"""
import json
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2] / "assets" / "showroom-src" / "polyhaven"
UA = {"User-Agent": "satex-showroom-build/1.0 (project asset fetch)"}

MODELS = [
    "steel_frame_shelves_03", "hand_truck", "plastic_crate_01", "cardboard_box_01", "hanging_industrial_lamp", "mounted_fluorescent_lights",
    "modern_arm_chair_01", "modern_coffee_table_01", "modern_wooden_cabinet", "sofa_02", "potted_plant_01", "potted_plant_02", "potted_plant_04",
    "throw_pillows_01", "wall_clock", "projector_screen", "korean_fire_extinguisher_01", "metal_stool_02", "desk_lamp_arm_01", "dining_chair_02",
    "wooden_display_shelves_01", "rollershutter_door",
]
TEXTURES = [
    "hangar_concrete_floor", "concrete_floor_worn_001", "painted_plaster_wall", "plastered_wall_04", "herringbone_parquet", "terrazzo_tiles",
    "laminate_floor_02", "fabric_pattern_05", "denim_fabric", "metal_plate",
]
HDRIS = []  # none: the site generates its lighting environment


def api(path: str):
    with urllib.request.urlopen(urllib.request.Request(f"https://api.polyhaven.com/{path}", headers=UA), timeout=60) as r:
        return json.load(r)


def fetch(url: str, dest: pathlib.Path):
    if dest.exists() and dest.stat().st_size > 0:
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        dest.write_bytes(r.read())


def main():
    for name in MODELS:
        g = api(f"files/{name}")["gltf"]["1k"]["gltf"]
        fetch(g["url"], ROOT / "models" / name / f"{name}.gltf")
        for rel, inc in g.get("include", {}).items():
            fetch(inc["url"], ROOT / "models" / name / rel)
        print("model", name)
    for name in TEXTURES:
        files = api(f"files/{name}")
        for kind in ("Diffuse", "nor_gl", "Rough", "AO"):
            if kind in files:
                fetch(files[kind]["1k"]["jpg"]["url"], ROOT / "textures" / name / f"{name}_{kind}.jpg")
        print("texture", name)
    for name in HDRIS:
        fetch(api(f"files/{name}")["hdri"]["1k"]["hdr"]["url"], ROOT / "hdri" / f"{name}_1k.hdr")
        print("hdri", name)


if __name__ == "__main__":
    main()
