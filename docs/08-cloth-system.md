# 08 – Feel Card & Virtual Drape (Phase 3, cloth "Option C")

Three parts, all driven by **one feel profile per fabric** (`fabric_feel`):
1. **Feel Card**: radar chart + plain-language description.
2. **Interactive swatch**: real-time XPBD cloth in the browser (grab, stretch, drop, wind).
3. **Garment drape**: pre-baked Blender cloth simulation on a mannequin, textured live per color.

Plus the **texture pipeline** that turns a swatch photo into tileable texture maps.

---
## 1. Feel profile estimation (`src/lib/cloth/feel.ts`, pure, unit-tested)
Used when a score is null and `is_measured = false`. All scores are clamped to [0,10] and rounded to 0.5.
Composition-weighted averages use the fiber table:

| Fiber | softness | breathability | sheen |
|---|---|---|---|
| cotton | 7 | 8 | 2 |
| linen | 4 | 10 | 3 |
| wool | 6 | 7 | 2 |
| silk | 9 | 8 | 9 |
| viscose | 8 | 8 | 6 |
| modal | 9 | 8 | 5 |
| polyester | 5 | 3 | 5 |
| nylon | 5 | 3 | 6 |
| elastane | 6 | 3 | 4 |
| acrylic | 6 | 4 | 3 |
| other | 5 | 5 | 3 |

- **softness** = avg + 1.5 if finish has `brushed` or `peached` + 0.5 if `mercerized` − 2 if structure ∈ {denim, canvas} − 1 if gsm > 300.
- **breathability** = avg − max(0, (gsm − 150) / 50) + 2 if structure = mesh − 1 if finish has `water_repellent` or `coated`.
- **sheen** = avg + 3 if satin + 2 if velvet + 1 if `mercerized` − 1 if structure ∈ {crepe, denim, canvas, fleece}.
- **drape** = 10 − (gsm − 60)/40 + 1 if knit + 1.5 if structure ∈ {chiffon, crepe, satin} + 1 if jersey − 2 if ∈ {denim, canvas, gabardine} − 3 if felt + 2·share(viscose+silk+modal) − 1·share(linen) (share in 0..1).
- **stretch**: if `stretch_pct` is set: piecewise linear over points (0,0) (5,2) (15,5) (30,7.5) (60,10). Else from `stretch`: none 0, mechanical 2, two_way 6, four_way 8.5, then + 0.2 × elastane% (cap 10).

**Measured overrides** (when `measured` has the key):
- `drape_coefficient` (Cusick, 0–1): drape = 10 × (0.95 − DC)/0.65.
- `stretch_pct_warp/weft`: stretch from the max of both through the piecewise curve.

## 2. Feel → physics parameters (`src/lib/cloth/mapping.ts`)
Constants are **starting values**, tuned with the cloth lab page (§4.6) and then frozen. `lerp(a,b,t)` with t = score/10.
`ρ = gsm / 1000` (kg/m²).

### 2.1 Browser XPBD (swatch)
| Param | Formula |
|---|---|
| particle mass | ρ × cellArea (cellArea = (0.4 m / (N−1))²) |
| stretch compliance αs | 10^lerp(−8, −5, stretch) |
| shear compliance | 10 × αs |
| bend compliance αb | 10^lerp(−5, −1, drape) |
| velocity damping (per substep) | lerp(0.02, 0.005, drape) |
| friction | lerp(0.6, 0.3, sheen) |
| air drag | 0.02 × clamp(1 − gsm/600, 0.1, 1) |

### 2.2 Blender cloth modifier (bake)
| Blender setting | Formula |
|---|---|
| `quality` | 10 |
| `mass` (per vertex, kg) | ρ × template `avg_vertex_area` (stored in the template's metadata JSON) |
| `tension_stiffness` = `compression_stiffness` | lerp(40, 5, stretch) |
| `shear_stiffness` | tension / 3 |
| `bending_stiffness` | 10^lerp(1.7, −1.3, drape)  (≈50 stiff → 0.05 fluid) |
| `tension_damping` | 5 |
| `air_damping` | 1 + 2 × (1 − gsm/600) clamped ≥ 0.5 |
| self collision | on, distance 0.003, friction lerp(0.6,0.3,sheen)×10 |
| collision (mannequin) | distance 0.005 |

Both sets are stored in `fabric_feel.sim_params = {"xpbd":{...},"blender":{...},"version":1}`, recomputed by a DB trigger → server function whenever the fabric's gsm/composition/structure/stretch/finish or feel changes.

## 3. Feel Card UI (`src/components/feel/FeelCard.tsx`)
- Radar chart, 5 axes (Softness, Drape, Stretch, Sheen, Breathability), custom SVG (no chart library), 0–10 rings at 2.5/5/7.5/10, accent fill 20% opacity. RTL: the axis order is mirrored.
- Badge: "Estimated" (tooltip: "Computed from composition and weight") or "Measured".
- One plain-language line per axis (i18n templates by band 0–3 / 3–6 / 6–8 / 8–10), e.g. drape 8–10 → "Very fluid, falls softly".
- Placement: fabric page tab **Feel & Drape**; a mini radar (no labels, 64 px) on match result cards; `/compare?ids=a,b,c` page overlaying up to 3 fabrics with a compare tray ("Add to compare" on cards; state in localStorage).

## 4. Interactive swatch (real-time XPBD)
### 4.1 Tech
- three.js **WebGPURenderer** with TSL compute nodes when `navigator.gpu` is available.
- Fallback: three.js WebGLRenderer + CPU solver in a **Web Worker** (positions transferred as `Float32Array` each frame; no SharedArrayBuffer, so no COOP/COEP headers are needed).
- Module: `src/lib/cloth/xpbd/` with `solver.cpu.ts`, `solver.gpu.ts` (same interface `ClothSolver { step(dt); setParams(p); grab(i, pos); release(); positions }`).

### 4.2 Model
- Square swatch 0.4 × 0.4 m. Grid N×N particles: N = 40 (GPU), 30 (CPU).
- Constraints: structural distance (right, down), shear (both diagonals), bending as skip-one distance constraints (i↔i+2 in both directions) with compliance αb.
- Solver: 10 substeps per frame, 1 iteration per substep (small-steps XPBD). GPU: Jacobi with constraint **graph coloring** (structural 4 colors, shear 4, bending 4) to avoid write races. CPU: Gauss-Seidel.
- Collisions: particle radius 0.004 m; ground plane y = 0; analytic table box; analytic sphere. Friction from params. No self-collision.
- Fixed time step 1/60 s with an accumulator; skip simulation when the tab is hidden.

### 4.3 Modes (buttons above the canvas)
| Mode | Setup | Shows |
|---|---|---|
| Hang & pull (default) | two top corners pinned | user grabs any point and pulls; a label shows the current strain % vs the fabric's stretch limit |
| Table drape | dropped over a table edge | drape / stiffness |
| Sphere drape | dropped onto a 0.12 m sphere (like a drape tester) | fluidity, fold count |
| Wind | pinned top edge, gusts on | weight / airiness |
| Reset | – | – |

Grab: raycast against the cloth mesh → nearest particle → its position follows the pointer projected onto a camera-facing plane (inverse mass 0 while held). Touch supported.

### 4.4 Rendering
`MeshPhysicalMaterial` with the color's texture set (albedo, normal, roughness), `sheen = sheen_score/10 × 0.8`, `sheenColor` = color hex, double-sided. UV in meters, so `texture.repeat = 1 / (repeat_cm/100)`. Normals recomputed each frame. Color picker = the fabric's colors.

### 4.5 Performance & fallback
- Target: 60 fps desktop (GPU path), ≥ 30 fps mid phone (CPU path, N=30).
- Auto-degrade: if the average frame time > 40 ms for 2 s, drop N by 10 (min 20).
- No WebGL at all → show only the Feel Card with the message "Interactive preview not supported on this device".

### 4.6 Cloth lab (`/admin/cloth-lab`, admin only)
Sliders for every XPBD parameter and the mapping constants, 3 fabrics side by side, "Export constants" → JSON to paste into `mapping.ts`. Used once to calibrate against real fabrics (e.g. a jersey, a denim and a satin should be visibly different).

## 5. Garment drape (pre-baked)
### 5.1 Templates (assets to create in Blender 4.x, stored in `worker/templates/`)
| Template | File | Notes |
|---|---|---|
| t_shirt | `t_shirt.blend` | front + back panels, sleeves, sewn |
| dress | `dress.blend` | A-line midi |
| trousers | `trousers.blend` | straight leg |
| cushion | `cushion.blend` | 45×45 cm cover on an insert (for upholstery) |

Each `.blend` contains: object `Garment` (cloth modifier, sewing springs, **UVs in real-world meters: 1 UV unit = 1 m**), object `Mannequin` (collision, also exported once as `models/mannequins/{template}.glb`), and `template.json` beside it: `{ "avg_vertex_area": 0.00004, "frames": 150, "fps": 24 }`.
**These 4 assets must be authored (modelled or bought + adapted) before Phase 3 starts.** This is a separate asset task in the P3 backlog.

### 5.2 Bake job
```sql
bake_jobs (id, fabric_id fk, template text, params_hash text, status job_status default 'pending',
           output_path text, error text, attempts int default 0, started_at, finished_at, created_at,
           unique(fabric_id, template, params_hash))
```
- Enqueue: when `sim_params` changes (or a fabric is activated), insert a `bake_jobs` row per template that applies (upholstery category → cushion only; others → t_shirt, dress, trousers) and send `{"job_id":...}` to `q_bake`.
- Worker steps: read the message → load the job + params → `blender -b worker/templates/{template}.blend -P worker/bake.py -- /tmp/job.json` → `bake.py` applies the Blender settings (§2.2), simulates frames 1–150, applies the modifier at frame 150 (settled pose), deletes the mannequin, exports **only the garment mesh** as `.glb` with Draco (level 7), UVs kept → upload to `models/bakes/{fabric_id}/{template}.glb` → update the row `done` → delete the message.
- Timeout 10 min; max 3 attempts, then `failed` with the error shown in `/admin/bakes` (retry button).
- Color doesn't require a new bake: the bake is per fabric × template; the color is just the texture.

### 5.3 Viewer (fabric page "Feel & Drape" tab, next to the swatch)
- Template switcher (only templates with a `done` bake), color switcher, orbit controls (rotate 360°, limited zoom), soft studio lighting, mannequin rendered in neutral matte grey.
- No bake yet → placeholder "3D preview being prepared".
- glTF loaded with `DRACOLoader` + `KTX2Loader`.

## 6. Texture pipeline (worker, Python 3.12 + OpenCV + numpy)
Input: a photo with `fabric_images.kind = 'flat_swatch'` (fabric laid flat, even diffuse light, straight-on, at least 15×15 cm visible) and `repeat_cm` (physical width of the photo area, entered by the admin).
```sql
texture_jobs (id, color_id fk, image_id fk, status job_status default 'pending', outputs jsonb, error text, attempts int default 0, created_at, finished_at)
```
Steps (`worker/texture.py`):
1. Center square crop, resize to 1024².
2. Flatten illumination: `img / GaussianBlur(img, σ=64) × mean(img)`.
3. Make tileable: offset by half (np.roll), cross-fade the seams with the original using a feathered mask 128 px wide; report a seam score (mean gradient across seam) in `outputs`.
4. Albedo = result (sRGB).
5. Height = high-pass luminance (σ=8) → normal map via Sobel, strength 2.0.
6. Roughness = `clip(1 − 0.6·sheen/10 + 0.3·normalized local variance, 0.2, 1)`.
7. Encode KTX2 (`toktx --t2 --encode uastc`) + WebP fallbacks → upload to `textures/{color_id}/{albedo|normal|roughness}.{ktx2|webp}` → set `fabric_colors.texture = {albedo, normal, roughness, repeat_cm}`.
Seed data uses procedurally generated textures (see `12-seed-data.md`), so P3 works before real photos exist.

## 7. Worker deployment
- One Docker image `worker/Dockerfile`: base `ubuntu:24.04` + Blender 4.x (official tarball) + Python deps (opencv-python-headless, numpy, psycopg[binary], supabase) + KTX-Software `toktx`.
- Entrypoint `worker/main.py`: loop reading `q_texture` and `q_bake` via `pgmq.read` (visibility timeout 900 s), concurrency 1 per instance.
- Host: Modal (preferred: pay per use, scales to zero, triggered by a cron every minute that checks the queue length) or Railway/Fly.io (one small always-on instance).
- Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`.
