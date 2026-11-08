# 08b – Phase 2–4 Features: Snap & Match, Collection Planner, Guided Live Tour

(Feel Card + Virtual Drape are in `08-cloth-system.md`.)

---
## A. Snap & Match (Phase 2)
Upload a photo of a garment or fabric and get matching in-stock fabrics.

### Flow
1. `/snap`: drag-drop or camera capture (`<input type="file" accept="image/*" capture="environment">`). Accept jpg, png, webp, heic; max 8 MB. Optional crop step (square crop around the fabric area, `react-easy-crop`).
2. The server action `uploadSnap` re-encodes with `sharp` (strip EXIF, max 1600 px, webp) → bucket `snap-uploads/{session_id}.webp` → row in `snap_uploads (id, session_id, storage_path, created_at)`.
3. Analysis (parallel):
   - **Vision**: `claude-sonnet-5-5` with the image, forced tool `submit_visual` →
     ```ts
     type Visual = { is_textile: boolean; construction_guess: 'knit'|'woven'|'nonwoven'|null; structure_guess: FabricStructure|null;
       pattern: 'solid'|'stripe'|'check'|'print'|'jacquard'|'other'; dominant_colors: {hex:string; share:number}[]; // max 3
       sheen: number; texture: 'smooth'|'textured'|'fuzzy'|'ribbed'|'open'; garment_guess: string|null;
       likely_uses: Use[]; confidence: number; notes: string }
     ```
     If `is_textile=false` → friendly error "We couldn't see a fabric, try a closer photo".
   - **Image embedding** of the upload (Voyage, input_type `query`) vs `embeddings` where `owner_type='color_image'` → top 60 by cosine.
4. **Follow-up questions** (max 2, chips, skippable), because a photo can't show weight or composition:
   - "What season is it for?" (SS / AW / all) and "Does it need stretch?" (no / some / a lot). Skipped answers = null.
5. Build a `Spec` from Visual + answers (construction, structures, colors from dominant_colors, uses, stretch, seasons), then score candidates:
   `score = 0.40·image_sim_norm + 0.20·color_score + 0.40·spec_score` where `image_sim_norm = clamp((sim-0.3)/0.5,0,1)`, `color_score = max(0, 1 - minΔE00/30)` against the dominant color, and `spec_score` = the P1 scoring function without the semantic component.
6. Results use the same results page/components as the wizard (`match_sessions.mode='snap'`), with the uploaded photo shown side by side with each match. Explanations mention the visual similarity.

### Acceptance
- Works on mobile camera capture; total time p50 < 8 s.
- Photos auto-deleted after 30 days (cron); privacy note shown on the upload page.
- Golden test: 10 seed fabric photos (re-photographed/augmented: rotated, color-jittered) → the same fabric in top 3 for ≥ 8/10.

---
## B. Collection Planner (Phase 2)
A designer describes a whole line and gets a coherent, in-stock fabric plan with meterage and one-click quote.

### Data
```sql
collections (id, client_id fk, name text, season season, brief jsonb, palette jsonb,   -- [{name,hex}]
             status text check (status in ('draft','planned','quoted')) default 'draft', quote_id uuid null, created_at, updated_at)
collection_items (id, collection_id fk cascade, garment_type text, label text, quantity_units int, size_run jsonb,  -- {"XS":10,"S":20,...}
                  spec jsonb, chosen_color_id uuid null, alternatives jsonb, meters_needed numeric, sort int)
garment_consumption (garment_type text primary key, base_m_per_unit numeric not null, ref_width_cm int default 150,
                     size_factors jsonb not null)   -- {"XS":0.9,"S":0.95,"M":1,"L":1.05,"XL":1.1,"XXL":1.15}
```
Seed `garment_consumption` (meters per unit at 150 cm width, size M): t_shirt 0.8, polo 0.9, shirt 1.6, dress_short 1.8, dress_long 2.8, skirt 1.0, trousers 1.4, jeans 1.5, shorts 0.8, jacket 2.0, coat 2.8, hoodie 1.6, leggings 0.7, sports_bra 0.4, swimsuit 0.5, cushion_cover 0.6, curtain_panel 3.0.

### Flow (`/planner`, signed-in clients)
1. **Brief**: collection name, season, target customer, style keywords (same chips as the wizard), budget per meter (optional), free description.
2. **Pieces**: add 1–12 pieces: garment type (from `garment_consumption`), label, quantity, size run (default even split), notes.
3. **Plan**: Claude (`claude-sonnet-5-5`, forced tool `submit_plan`) returns a palette (3–6 colors with names and hex) and a `Spec` per piece, designed to be coherent (shared fabric families, harmonious weights).
4. For each piece, run the P1 retrieval + scoring with its spec, plus a **palette bonus**: `+0.1 × max(0, 1 - minΔE00(color, palette)/25)`; keep the top 3 as `alternatives`; preselect the best whose color is in the palette.
5. **Coherence checks** (shown as badges): palette fit (all chosen colors ΔE < 15 from a palette color), supplier coverage (all in stock = yes), number of distinct fabrics (fewer = easier production).
6. **Meterage**: `meters = Σ_sizes qty_size × base_m_per_unit × size_factor × (ref_width_cm / fabric_width_cm) × 1.08` (8% waste), rounded up to 0.5 m and to at least MOQ. Show per piece and the total; flag if `meters > available_m`.
7. The user can swap a piece's fabric among alternatives or search the catalog; meterage updates live.
8. **Request quote for the collection** → creates a quote (`source='planner'`, `collection_id`) with one line per piece → normal quote flow. Export a PDF "collection board" (palette, pieces, fabric photos, meterage).

### Acceptance
- A 6-piece plan returns in < 20 s p50 (pieces scored in parallel).
- Meterage formula unit-tested; changing a fabric updates the total instantly (client-side).

---
## C. Guided Live Tour (Phase 4)
A sales rep and a client walk through the 3D showroom together, with voice/video, synchronized camera and fabric selection. Appointment-based, desktop-first.

### Data
```sql
tour_slots (id, sales_id fk profiles, starts_at timestamptz, ends_at timestamptz, is_booked boolean default false)
tour_bookings (id, slot_id fk unique, client_id fk, topic text, related_quote_id uuid null, related_collection_id uuid null,
               status text check (status in ('booked','cancelled','completed','no_show')) default 'booked',
               room_name text unique, created_at)
```

### Booking
- Staff create slots in `/admin/tours` (30-min default, recurring weekly template).
- The client books from `/account/tours`, the client-suite hotspot, a quote page or a collection page (prefills topic/related). Emails with an `.ics` attachment to both parties; reminders 24 h and 15 min before.
- Cancellation up to 2 h before.

### Room (`/tour/[bookingId]`)
- Access: only the booking's client and the slot's sales rep (or any staff), from 10 min before start to 60 min after.
- LiveKit Cloud: token from `/api/livekit/token` (server checks access, identity = profile id, room = `booking.room_name`, TTL 2 h). Env `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
- Layout: the showroom scene full-screen; video tiles top-right (`@livekit/components-react`); controls: mic, camera, leave, "Follow guide" toggle, "Request control".
- **Sync** over LiveKit data channel (reliable for state, lossy for camera), JSON messages:
  ```ts
  { t:'cam', pos:[x,y,z], target:[x,y,z], zoom:number }         // leader → all, max 10/s, receivers interpolate 150 ms
  { t:'focus', departmentId:string|null }                         // opens/closes the side panel
  { t:'fabric', fabricId:string, colorId?:string }                // shows a fabric card overlay to everyone
  { t:'cart', action:'add', colorId:string, meters:number }       // rep proposes a line; client sees "Accept → add to my quote cart"
  { t:'control', leaderId:string }                                // hand over control
  ```
- The rep is the leader by default. When "Follow guide" is off, the client navigates freely.
- No recording. A text chat panel (data channel) is included; the chat is not persisted.
- After the call: booking → `completed`; the rep can add notes to the client record.

### Acceptance
- Two browsers (client + rep) see synchronized camera movement with < 300 ms perceived lag on a normal connection.
- Mobile: joining works (audio + 2D floor plan sync); full 3D on mobile is best-effort.
