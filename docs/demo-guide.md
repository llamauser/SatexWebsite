# Demo guide: showing every part of the prototype

A route of about 40 minutes (a short version of 15 minutes is at the end). Every step says what to click and what you should see. The site is in French by default; names in quotes are the French labels.

## 0. Before the demo (10 minutes, once)

1. Start Docker Desktop and Ollama, then double-click `START-SATEX.bat`. Wait for "SATEX is running". The first start takes several minutes.
2. **Wait about 5 minutes after the first start** before showing the AI search: the background jobs are still computing the search data of every fabric with Ollama. (Check: the "SATEX website" window stays open, and the AI search answers after that.)
3. Open `.seed-credentials.local.json` for the passwords of the demo accounts, and have these tabs ready in one browser window (use two profiles, or a private window, so you can be signed in as the client and as the admin at the same time):
   - Site: http://localhost:3000
   - Mailpit (sign-up e-mails): http://127.0.0.1:54324
   - Database browser (Supabase Studio): http://127.0.0.1:54323
4. Do the AI steps once before the audience arrives, so the model is already loaded in memory (the first answer after a start is slow, 1 to 5 minutes for a photo).
5. Use a computer with a real graphics card for the 3D showroom. Chrome or Edge, full screen, zoom 100%.

Accounts: admin `admin@satex.test`, sales `sales1@satex.test`, clients `client1@satex.test` to `client5@satex.test`.

## 1. The shop window: home page (2 min)

1. Open http://localhost:3000. Point out: the promise ("let the AI find your fabric"), the 9 families ("Nos univers"), the 6 featured fabrics with their "from" price, and the picture of the 3D showroom.
2. Switch the language with **FR / EN / عربي** in the header. In Arabic the whole page turns right to left (menus, cards, the showroom list). Switch back to French.

## 2. The catalog and a fabric page (4 min)

1. **Catalogue**: use the filters (family, composition, weight, width, stock, price), change "Trier par", and see that the filters stay in the address bar (you can share a link).
2. Open a fabric. Show the specification table, the colour dots with the **live stock in metres per colour**, the price tiers and the minimum order.
3. Live stock proof (30 seconds): in another window sign in as admin, open **Back-office → Stock**, add or adjust metres for that colour, come back to the fabric page: the figure changes by itself.
4. Click the tab **"Toucher et tombé"** (Feel card): the five scores (softness, drape, stretch, sheen, breathability) and the sentence for each. Say: estimated from composition and weight, or "measured" when the lab values are entered.
5. **The cloth swatch** under the card is a real physics simulation of this fabric. Try the four buttons: **"Suspendu et étiré"** (grab the cloth with the mouse and pull: a stretchy fabric stretches, a stiff one resists), **"Tombé sur table"**, **"Tombé sur sphère"** (a fluid fabric hangs down the sides, a stiff denim stays domed), **"Vent"** (a light fabric flutters, a heavy one barely moves). Change the colour dot: the cloth changes colour. Compare a light silk with a heavy denim: they behave differently.
6. **Compare**: on three fabrics press "Ajouter à la comparaison" (cards or results), then "Comparer (3)": side-by-side specs and the feel cards on top of each other.

## 3. The AI fabric finder (5 min)

1. **AI Match** in the menu. Walk the five steps: audience, style (up to 3), brand spirit, project description, then "Trouver mon tissu".
2. Good example for the description: *"Light summer shirts for women, breathable, soft, natural fibres, around 8 euros per metre."* Wait for the result (with the local model this can take a minute or two, then it is much faster).
3. Results: the top fabrics with a percentage of match, an explanation written for this brief, the available stock, the feel profile. Show the line "Voici comment nous avons compris votre projet" (what the AI understood).
4. Press the refine chips ("Plus léger", "Moins cher", "Plus extensible"...): the results change.
5. Press "Utile / Pas utile" (feedback), then "Demander un échantillon ou un devis".
6. Say: here the AI runs locally (Ollama). Online it would use Claude and Voyage; local models are weaker, especially in Arabic.

Shortcut: in the **Showroom**, each department panel has "Ask the AI": it opens this wizard with the department already mentioned.

## 4. Snap & Match: search with a photo (3 min)

1. Open **/fr/snap** (link in the match results, or type the address).
2. Drag a photo onto the zone (or click it). Test images are in the folder `demo/snap-test-images/` of the project (see "Test images" below).
3. Choose the season, optionally the stretch, press "Trouver des tissus". The site reads the colours and the look of the picture with a vision model, then lists the fabrics in stock that look like it. A photo takes **1 to 5 minutes** locally; this is the slowest step of the demo, so start it, then talk while it runs or show a result prepared before.
4. Show: the colours it found, the fabrics, and that the photo is private (kept 30 days, only its owner sees it).

### Test images
- The folder **`demo/snap-test-images/`** has ten ready images: nine pictures of fabrics from the catalog (one per family) and one real denim texture (Poly Haven, CC0). Each should bring back fabrics of that colour and family. The real denim is the most convincing.
- For a stronger effect use **a real photo**: your own clothes, a curtain, a cushion, a shirt on a hanger, taken with a phone (even a screenshot works). Free stock photos also work: search "denim fabric", "linen texture", "velvet", "knitted sweater", "silk satin" on unsplash.com or pexels.com.
- Best results: the fabric fills the picture, daylight, no big logo or face. A multicoloured print gives broader results than a plain colour.

## 5. The 3D showroom (4 min)

1. **Showroom** in the menu. Wait for the scene (a picture is shown while it loads).
2. Drag to turn the view, scroll to zoom. Use the floor buttons: **both floors / ground floor / upper floor**. Ground floor: the six fabric halls, the cutting room, the shipping dock (forklift, pallets, workers). Upper floor: studio, client suite, offices.
3. Click a hall (or its name in the list below): the panel shows **its live stock**, its fabrics with colour dots, "Voir tout dans le catalogue" and "Demander à l'IA". Click the cutting room and the dock: the counters (cuts today, cuts waiting, deliveries this week) are real numbers from the database.
4. The department list below the scene works with the keyboard, for people who cannot use the mouse.
5. If asked about older computers: without WebGL the page shows a picture and the same list and panels.

## 6. From request to order: the whole business flow (10 min)

**As a visitor, then a client:**
1. On a fabric page choose a colour, enter a length, press the add-to-quote button. The "Demande" icon in the header counts items. Open the drawer: change lengths, add a note.
2. Press send: the site asks you to sign in. Use **Create an account** to show the sign-up (the confirmation e-mail appears in **Mailpit**), or sign in as `client1@satex.test`.
3. Send the quote request. It appears in **My account → quotes** with the status "submitted".
4. Also show on a fabric page: **reserve** a length of a colour (stock is held for a few hours, with a countdown in My account → reservations) and **request a sample** (My account → samples).
5. **Collection Planner** (My account → "Planificateur de collection"): create a collection (name, season, target customer, style words, budget per metre), add 2 or 3 pieces (garment type, quantity, size split), press "Construire le plan". The AI proposes a palette and a fabric for each piece with alternatives, the metres needed, and warns when stock is short ("Il manque … m en stock"). Press "Demander un devis": it becomes a quote. A PDF board of the collection can be downloaded.

**As sales or admin (second window):**
6. **Back-office → Quotes**: open the new request, edit prices, discount and validity, then **"Send to client"**. A PDF quote is generated and attached to the e-mail (e-mails are recorded, not sent, in this local mode: see the table `email_log` in the database browser).
7. Back as the client: the quote is now "sent", with the PDF to download. Press **Accept**.
8. As admin: **Convert to order**. Open the order: payment status, status changes.
9. **Cutting**: the board with three columns (queued, cutting, ready): drag the job across (the numbers on the showroom's cutting room panel come from these jobs).
10. **Deliveries**: schedule the delivery, carrier and tracking number, mark it delivered. The client sees the order timeline update in My account → orders.
11. **Samples** and **Reservations** screens: approve, ship, release.

## 7. The back-office tour (5 min)

- **Home**: the numbers that matter today (quotes to review, samples, cutting queue, deliveries, low stock, reservations expiring).
- **Fabrics**: search, edit a fabric (tabs FR / EN / AR with "auto-translate missing" which uses the AI), colours with photo upload (photos are re-encoded and shrunk automatically), the feel profile fields, **import a catalog from a CSV** (a sample is in `public/samples/fabrics-sample.csv`).
- **Departments**: the showroom layout; moving a department changes the 3D scene.
- **Clients**: the history of one client (quotes, orders, samples, searches). **Messages**: contact form messages (send one from the Contact page first). **AI log**: every search with inputs, what the AI understood, timing and cost. **Users** and **Settings** (VAT, currency, validity of quotes, reservation hours, thresholds).
- Roles: sign in as `sales1@satex.test`: sales sees the operations screens but not Users, Settings or fabric editing. Sign in as a client and open /fr/admin: access is refused.

## 8. Things to say honestly

- It is a **prototype with demo data** (about 80 invented fabrics, generated pictures, demo clients). No payment, no real e-mail sending, no real hosting: everything runs on this computer.
- The AI runs on local models for the demo. Answers are slower and weaker than the online version, and Arabic is the weakest.
- The Arabic and the legal pages (About, Privacy, Terms) need a native review before any real use.
- Not built, by decision: the virtual garment drape (a shirt or skirt falling on a mannequin) and the live guided tour.
- The cloth swatch is a simulation made to be believable; it is not a measurement tool.

## 9. If something goes wrong

| Problem | What to do |
|---|---|
| Page shows no fabrics | The demo data is missing: run `START-SATEX.bat` again. |
| AI search or photo takes very long | Normal for the first request after a start (the model is loading). Wait, or show a result you made earlier. |
| AI search answers look poor | The search data is still being computed: wait a few minutes, keep the "SATEX website" window open. |
| 3D scene does not appear | The browser has no graphics acceleration: try Chrome or Edge on the main screen; the picture and the list still work. |
| Site not responding | Run `STOP-SATEX.bat`, then `START-SATEX.bat`. |
| Password does not work | Passwords are in `.seed-credentials.local.json`. After a database reset, run `pnpm db:seed` again. |

## Short version (15 minutes)
Home and language switch (1) → fabric page with live stock and the cloth swatch (4) → AI Match with the description above (3) → Snap & Match with a prepared result (2) → Showroom (3) → one quote from request to "Send to client" with the PDF (2).
