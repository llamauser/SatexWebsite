# 05 – Commerce: Catalog, Stock, Quotes, Samples, Orders, Notifications

## 1. Catalog
### Filters (`/catalog`, all URL query params)
| Param | UI | Logic |
|---|---|---|
| `q` | search box | `search_text @@ websearch_to_tsquery('simple', unaccent(q))` OR trigram similarity on name > 0.3 |
| `category` | chips (multi) | `category_id in (...)` |
| `construction` | knit / woven / non-woven | equality |
| `structure` | multi-select | equality |
| `fiber` | multi-select (cotton, polyester, viscose, linen, wool, silk, elastane, nylon, modal, acrylic) | composition contains fiber with pct ≥ 1 |
| `gsm_min`, `gsm_max` | range slider 20–600 | between |
| `stretch` | none / mechanical / two_way / four_way | equality |
| `use` | multi-select | `uses && array[...]` |
| `season` | SS / AW / all | `seasons && ...` (all_season always matches) |
| `color` | 12 color families | color family computed from LAB hue/lightness, see below |
| `in_stock` | toggle (default on) | at least one color with `available_m >= moq_m` |
| `sort` | relevance, newest, price asc/desc, gsm asc/desc | |

**Color families** (computed in a SQL function `color_family(lab)`): white, black, grey, beige, brown, red, orange, yellow, green, blue, purple, pink. Rules: L > 90 and chroma < 8 → white; L < 20 → black; chroma < 8 → grey; otherwise by hue angle with brown/beige for low-L/low-chroma oranges. Unit-test with 30 fixtures.

### Fabric card
Image (first photo of the first color), name, structure + GSM + width line, composition short ("92% CO · 8% EA"), color dots (max 6 + "+n"), stock badge (In stock / Low stock / Out of stock), "from X {currency}/m" (currency from `app_settings`) if prices are visible.

### Fabric detail page
See `01-sitemap.md`. Stock per color shows `available_m` rounded down to the meter, and "Low stock" when below `low_stock_threshold_m`. Stock updates live through Supabase Realtime (subscribe to `stock_lots` changes for the fabric's colors → re-fetch the view; debounce 500 ms).

## 2. Pricing
- Unit price for a quantity = price of the tier with the highest `min_m` ≤ meters.
- Quote line `unit_price` is frozen when the line is added. Staff can override it (`price_overridden = true`).
- `recompute_quote(quote_id)`: `line_total = round(meters*unit_price,2)`; `subtotal = Σ`; `total = round(subtotal*(1-discount_pct/100)*(1+vat_rate),2)`. Called by trigger on line changes.
- Display: `Intl.NumberFormat(locale, {style:'currency', currency})` with Latin digits for all locales.

## 3. Quote cart
- One `draft` quote per client. Guest cart in `localStorage` key `satex.cart.v1` = `[{colorId, meters}]`, merged on sign-in (sum meters for the same color).
- Line validation: meters ≥ `moq_m`, step 0.5 m, ≤ 10 000. If meters > `available_m`, show a warning "Partially available, lead time to be confirmed" (still allowed).
- Drawer shows lines, unit price, line total, estimated total, "Submit request" (+ optional message to sales).

## 4. Reservations
See `02-user-flows.md` F2 and `04-database.md` stock functions. The UI shows a countdown (hh:mm) and disables "Reserve" when the limit is reached (with an explanation).

## 5. Quote PDF
Generated server-side with `@react-pdf/renderer` in the client's `preferred_locale` (Arabic: RTL layout, embedded font "IBM Plex Sans Arabic"; Latin: "Inter").
Content: logo, company info from settings, quote ref + revision, date, valid until, client company + addresses, table (SKU, fabric name, color name + code, meters, unit price, line total), subtotal, discount, VAT, total, currency, terms text (from settings key `quote_terms` i18n, default provided in seed), footer "Textile expert since 1995".
Stored at `quote-pdfs/quotes/{id}/r{revision}.pdf`.

## 6. Admin quote review
- Editable while `submitted`/`in_review`: lines (meters, unit price), add/remove lines, discount %, valid-until (default today + `quote_validity_days`), internal notes.
- "Send to client" → validates → generates PDF → status `sent`, `sent_at` → email `quote_sent`.
- "Convert to order" (only `accepted`) → creates the order in a transaction (`convert_quote_to_order(quote_id)`), status quote `converted`.

## 7. Back-office cutting board
Kanban columns `queued | cutting | ready`. Card: order ref, client, fabric + color, planned meters, due order age.
- Drag queued → cutting opens a dialog: choose a lot (list lots of that color with meters ≥ planned) → `start_cut`.
- Drag cutting → ready opens a dialog: actual meters cut → `record_cut`.
- Realtime: the board subscribes to `cutting_jobs` changes.

## 8. Notifications
Emails via **Resend**, React Email templates in `src/emails/`, one template per event, localized. Every send is enqueued in `q_email` (never sent inline) and logged in `email_log`. In-app notifications are written to `notifications` for the same client events.

| Event key | To | Trigger |
|---|---|---|
| `account_welcome` | client | email confirmed |
| `quote_submitted_client` | client | quote → submitted |
| `quote_submitted_staff` | staff_notification_email | quote → submitted |
| `quote_sent` | client | → sent (link to portal, PDF attached) |
| `quote_accepted_staff` / `quote_rejected_staff` | assigned sales or staff email | client decision |
| `quote_expired` | client | → expired |
| `order_confirmed` | client | order created |
| `order_ready` | client | → ready |
| `delivery_in_transit` / `delivery_delivered` | client | delivery status |
| `sample_status_changed` | client | any sample status change |
| `sample_requested_staff` | staff | new sample request |
| `reservation_created` / `reservation_expiring` / `reservation_expired` | client | F2 |
| `contact_message_staff` | staff | contact form |

WhatsApp notifications are **out of scope for P1** (only a `wa.me` click-to-chat link from settings in the footer and contact page).
