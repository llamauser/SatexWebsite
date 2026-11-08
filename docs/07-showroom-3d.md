# 07 – 3D Showroom (Phase 1)

Inspired by the video: an isometric, stylized two-floor warehouse (fabric halls downstairs, studio and offices upstairs) with clickable department hotspots and live stock.

## 1. Approach
- **No external 3D model is available**, so the Phase 1 showroom is **generated from data**: each `departments.layout` describes a zone, and the scene builds it from reusable low-poly components (React Three Fiber + drei). A modelled glTF can replace it later without changing the data.
- Library: `@react-three/fiber`, `@react-three/drei`, `three`. Loaded only on `/showroom` via `next/dynamic` with `ssr:false`.

## 2. Scene composition
- Building shell: floor slab 40 m × 24 m, low outer walls (no front wall, so it reads like the video's cut-away), a second-floor mezzanine covering the back 40% of the building at height 4 m, stairs at the left.
- Components (in `src/components/showroom/parts/`): `FabricRack` (shelf with fabric rolls colored from the department's real top colors), `RollStack`, `CuttingTable`, `Forklift` (simple), `Desk`, `MeetingTable`, `Plant`, `Signage` (SATEX logo panel), `PathLines` (glowing floor lines between departments, as in the video).
- Materials: soft matte, palette from `10-design-system.md`; ambient + one directional light with soft shadows (shadow map 1024, `PCFSoftShadowMap`); background `#E9EEF3`.
- Camera: orthographic, isometric angle (rotation ~45° yaw, 35° pitch), `MapControls` limited: zoom 0.6–2.0, pan inside bounds, rotation ±25° only. Floor toggle "Floor 0 / Floor 1 / Both" fades the mezzanine.

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
- Show the **2D floor plan** (SVG generated from the same layouts, two tabs for the floors, same click → panel) when: WebGL is unavailable, `navigator.deviceMemory < 4`, `prefers-reduced-motion`, or the user toggles "2D view". The toggle state is saved in localStorage.
- Budget: < 150 draw calls (use `InstancedMesh` for rolls/racks/plants), < 1.5 MB JS for the showroom chunk, 60 fps on a mid laptop, ≥ 30 fps on a mid phone.
- A static pre-rendered image (`public/showroom/preview.webp`, made from a screenshot) is used on the home page teaser and as the loading placeholder.
- Accessibility: the department list is also rendered as an accessible HTML list (screen readers and keyboard navigation), synced with the 3D selection.
