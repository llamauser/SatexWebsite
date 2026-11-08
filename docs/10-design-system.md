# 10 – Design System

Visual direction taken from the promo video: airy white background with large soft blurred color blobs (blue, teal, beige), deep navy text, a blue gradient primary button, rounded white cards with soft shadows, clean geometric headings.

## 1. Tokens (`src/styles/tokens.css`, exposed to Tailwind via CSS variables)
```css
:root {
  --bg: #F7F9FB;            /* page */
  --surface: #FFFFFF;       /* cards */
  --surface-muted: #EEF3F7; /* sidebar, chips */
  --border: #E2E8EE;
  --text: #14243B;          /* navy, headings + body */
  --text-muted: #5B6B7F;
  --primary: #2F74B5;       /* SATEX blue */
  --primary-strong: #1F4E79;
  --primary-gradient: linear-gradient(135deg, #3E86C6 0%, #1F4E79 100%);
  --accent-teal: #4F8FA3;
  --accent-beige: #C9B497;  /* "YOUR MATCH" label, match badge */
  --blob-blue: #8FB3DE; --blob-teal: #5E9AAE; --blob-beige: #D8C6A8;
  --success: #2E8B57; --warning: #C98A1B; --danger: #C0392B;
  --radius-sm: 8px; --radius: 16px; --radius-lg: 24px; --radius-pill: 999px;
  --shadow-card: 0 10px 30px rgba(20,36,59,0.08);
  --shadow-pop: 0 20px 50px rgba(20,36,59,0.14);
}
```
No dark mode in P1 (the brand look is light). Do not hard-code colors in components; use tokens.

## 2. Typography
| Use | Latin | Arabic | Size / weight |
|---|---|---|---|
| Display (hero) | Poppins 700 | IBM Plex Sans Arabic 700 | clamp(36px, 5vw, 64px) |
| H1 / H2 / H3 | Poppins 700 / 600 / 600 | Plex Arabic 700/600/600 | 40 / 28 / 20 |
| Body | Inter 400 | Plex Arabic 400 | 16 / line-height 1.6 |
| Small / labels | Inter 500 | Plex Arabic 500 | 13, uppercase + letter-spacing 0.12em for section labels ("YOUR MATCH") |
Loaded with `next/font` (self-hosted, `display: swap`).

## 3. Layout
- Container max 1200 px, side padding 16 px (mobile) / 24 px (tablet) / 32 px (desktop).
- Breakpoints: Tailwind defaults (`sm 640`, `md 768`, `lg 1024`, `xl 1280`). Mobile-first.
- Background blobs: a fixed decorative layer `BlobBackground` with 3 blurred circles (blur 80px, opacity 0.5), slowly drifting (disabled with `prefers-reduced-motion`). Used on home, match, about, contact, auth. Not used in admin.
- Admin: plain `--bg`, left sidebar navigation (right in RTL), dense tables.

## 4. Components (shadcn/ui based, restyled with tokens; in `src/components/ui/`)
| Component | Spec |
|---|---|
| Button | variants `primary` (gradient, white text, pill radius, 44px height), `secondary` (white, border, navy text), `ghost`, `danger`; sizes sm/md/lg; loading state with spinner |
| Chip | pill, `--surface-muted`, selected = navy fill + white text; used for wizard answers and filters |
| Card | white, `--radius`, `--shadow-card`, padding 24 |
| MatchBadge | beige pill on the image, "98% match" white text |
| StockBadge | In stock (success), Low stock (warning), Out of stock (muted) |
| SpecTable | 2-column rows with hairline separators (video "Composition / Weight / Width / Best for") |
| StepSidebar | wizard steps with check circles and the "% complete" progress bar |
| ColorDot | 20 px circle with 1 px border, selected ring 2 px primary |
| PriceTiers | small table "from X m: Y €/m" |
| StatusPill | one color per status (map in `src/lib/status-colors.ts`) |
| Timeline | vertical status history (quote/order) |
| Drawer, Dialog, Toast, Tabs, Table, Pagination, Skeleton, EmptyState | shadcn defaults restyled |
Icons: `lucide-react`, 20 px, stroke 1.75.

## 5. Motion
- Durations 150 ms (hover), 250 ms (panels), 600 ms (camera moves). Easing `cubic-bezier(0.22,1,0.36,1)`.
- Match "scanning" animation: a counter animating up to the number of references + a shimmering grid of swatches.
- Framer Motion (`motion`) for page/section transitions; all motion respects `prefers-reduced-motion`.

## 6. Imagery
- Fabric photos: 4:3 cards, `object-cover`, `next/image` with Supabase loader, WebP/AVIF.
- Placeholder for missing images: the color's procedural texture.
- Brand: SVG logo placeholder (blue ribbon "S", "SA" navy + "TEX" blue, "COMMERCE" spaced, tagline "Vente des tissus en gros").

## 7. Key screens (reference the video frames)
- **Home hero**: blobs, centered "Stop guessing." (H1) + "Let AI find your **fabric** in seconds." with "fabric" in `--primary`, primary CTA "Start matching", secondary "Explore the catalog".
- **Wizard**: white card 960×560 centered, left step sidebar 30% in `--surface-muted`, right content; the question as H2; chips under it.
- **Match result**: "— YOUR MATCH" beige label above; card split image (left) / details (right) with the badge on the image.
- **Showroom**: full-bleed canvas, floating white pills for labels, legend card bottom-left.
