# 07 – 3D Showroom (Phase 1)

Inspired by the video: an isometric, stylized two-floor warehouse (fabric halls downstairs, studio and offices upstairs) with clickable department hotspots and live stock.

## 1. Approach
- **Modelled in Blender, furnished from data.** The building and the objects are 3D models; *where* things stand comes from the data, so the admin can still move departments and change rack counts, and the stock still decides how full the racks look.
  - `public/showroom/shell.glb` (about 3 MB): the building (floors, far walls, mezzanine, stairs, columns, windows, glass balustrade, sign, floor markings) with ambient occlusion baked into a vertex color. Two groups, `ground` and `mezzanine` (hidden when only the ground floor is shown).
  - `public/showroom/props.glb` (about 3 MB): a library of single objects named `prop_<name>` (rack bay, fabric roll, cutting table, pallet load, forklift, desk, meeting table, dress form, sofa, armchair, chair, plants, hand truck, crates...). One mesh per material.
  - `src/lib/showroom/placements.ts` (pure, tested) decides what stands in each department from its layout and the live stock; `src/lib/showroom/spec.json` holds the dimensions shared by the Blender scripts and the site.
- Libraries: `@react-three/fiber`, `@react-three/drei`, `three`. Loaded only on `/showroom` via `next/dynamic` with `ssr:false`; the two .glb files are fetched when the 3D view opens.
- **Rebuilding the models**: `python scripts/showroom/fetch-assets.py` (downloads the raw free assets, git-ignored), then `pnpm showroom:build` (runs the Blender scripts in `scripts/showroom/blender/` headless and compresses the result with `scripts/showroom/optimize.mjs`: WebP textures, quantized geometry, no meshopt/draco because their decoders need WebAssembly or a CDN, which the CSP does not allow). Blender 4.2+ is required (built with 5.1).
- **Credits**: models and textures from [Poly Haven](https://polyhaven.com) (CC0, no attribution required, credited here anyway): sofa_02, modern_arm_chair_01, modern_coffee_table_01, modern_wooden_cabinet, potted_plant_01/02/04, dining_chair_02, hand_truck, plastic_crate_01, cardboard_box_01, desk_lamp_arm_01, projector_screen, throw_pillows_01; textures painted_plaster_wall, laminate_floor_02, concrete_floor_worn_001, fabric_pattern_05. The rack The rack, roll, tables, forklift, desk, dress form and the whole building are modelled in this repository.

## 2. Scene composition
- Building: floor 40 m × 24 m on a visible plinth, full-height walls on the two far sides only (the near sides are open, like the video's cut-away), a mezzanine at 4.15 m over the back of the building (z from 14.8 m) with a glass balustrade, stairs at the left that arrive at an opening in the balustrade, steel columns and beams, clerestory windows, the SATEX sign.
- Rack bays hold 4 levels x 4 slots of fabric rolls (`spec.rack`). **Stock decides how full they look**: 1 roll per 100 m of stock up to 12 means "full" (`rollsFor`), shown as the share of slots filled, in a fixed pseudo-random order so more stock only adds rolls and nothing flickers when the numbers refresh. The rolls are tinted with the real top colors in stock.
- Everything standing in the visible departments is grouped by prop and drawn as instanced meshes: one draw call per part of each prop for the whole building (about 50 in all, plus 18 for the building).
- Lighting: a generated indoor environment map (three's RoomEnvironment, no download) + hemisphere light + one sun with soft shadows (2048 map, `PCFSoftShadowMap`), Khronos neutral tone mapping, background `#E9EEF3`. A translucent painted rectangle on the floor marks each department; it is what is hovered and clicked, and it is outlined when selected.
- Camera: orthographic, isometric angle (45° yaw, 35° pitch), `MapControls` limited: zoom 0.6–2.2, pan inside bounds, rotation ±25° only. Floor toggle "Floor 0 / Floor 1 / Both" hides the mezzanine and the departments of a floor.

## 3. Departments (seed, `departments.layout` in meters, origin = front-left corner)
| slug | floor | kind | categories | layout (x,z,w,d) |
|---|---|---|---|---|
| natural-fibers | 0 | fabric_hall | natural-fibers | 2, 2, 8, 6 |
| upholstery | 0 | fabric_hall | upholstery | 12, 2, 8, 6 |
| knits | 0 | fabric_hall | knits, technical-activewear | 22, 2, 8, 6 |
| shirting-suiting | 0 | fabric_hall | shirting, suiting, linings | 2, 10, 8, 6 |
| denim | 0 | fabric_hall | denim | 12, 10, 8, 6 |
| eveningwear | 0 | fabric_hall | eveningwear | 22, 10, 8, 6 |
| cutting | 0 | cutting | – | 32, 2, 6, 8 |
| shipping | 0 | shipping | – | 32, 12, 6, 8 |
| design-studio | 1 | studio | – | 2, 16, 14, 7 |
| client-suite | 1 | client_suite | – | 18, 16, 10, 7 |
| offices | 1 | office | – | 30, 16, 8, 7 |

## 4. Interaction
- Hover a department → highlight outline + floating label (pill with icon + name, video style).
- Click a fabric hall → camera eases to it (600 ms) and a **side panel** opens (bottom sheet on mobile): department name, description, live list of its fabrics (from linked categories) with available meters, color dots, links to fabric pages, "Ask AI for this department" (opens `/match` with audience/use prefilled).
- Click cutting / shipping → panel shows public, anonymized live counters: "Cutting jobs today", "Orders shipped this week" (from a security-definer function `showroom_stats()`).
- Click client suite → P4 "Book a guided tour" CTA (P1: "Contact us").
- Legend card bottom-left: "TWO FLOORS · 00 Fabric halls · 01 Studio & offices" (from the video).
- Live stock: subscribe to Realtime on `stock_lots`; rack roll counts scale with available meters (1 roll per 100 m, max 12).

## 5. Fallback & performance
- There is **no 2D view** (it was removed on purpose). Without WebGL, or if the scene crashes, the page shows the picture `public/showroom/preview.webp` with a note saying why; the department list and the panels keep working. Small or low-memory devices and visitors who prefer reduced motion get the 3D scene like everyone else (it is optimised for phones).
- Budget: < 150 draw calls (instanced props), < 1.5 MB JS for the showroom chunk (the models, about 6 MB, are loaded separately), 60 fps on a mid laptop, ≥ 30 fps on a mid phone.
- A static pre-rendered image (`public/showroom/preview.webp`, made from a screenshot) is used on the home page teaser, as the loading placeholder and as the picture when 3D is not available.
- Accessibility: the department list is also rendered as an accessible HTML list (screen readers and keyboard navigation), synced with the 3D selection.

## 6. Polish pass (people, props, shadows)

- **Figures**: `scripts/showroom/blender/figures.py` builds the people (standing, walking, holding a clipboard, seated), the tailor's dress form and the forklift. Clothes, skin and hair are separate tintable materials: `Placement` carries `color`, `color2`, `skin`, `hair` and the scene tints each instance (`personAt` in `src/lib/showroom/placements.ts` picks the palettes from a seed, so the people are always the same ones).
- **Contact shadows**: `src/lib/showroom/contact-shadow.ts` makes one soft canvas texture; `ContactShadows` in `Scene3D.tsx` lays one instanced plane under every prop listed in `SHADOWED_PROPS`, sized from the footprint of its parts. No shadow maps, so phones pay almost nothing.
- **Ask the AI**: each department panel links to `/match?topic=<department name>`; the matcher pre-fills its description (`match.wizard.topicPrefill`) when the box is still empty.
- **Preview image**: `public/showroom/preview.webp` (a render of the finished scene) is shown on the home page and as the placeholder while the 3D code loads. Regenerate it after any big change to the scene.
- Rebuild the GLBs with the Blender scripts (`build_props.py`, `build_shell.py`) then `scripts/showroom/optimize.mjs`.
