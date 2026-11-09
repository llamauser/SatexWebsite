# Run the app on a computer (Windows, macOS or Linux)

Everything runs on the computer: the website, a local database (Supabase in Docker) and fake AI and e-mail, so **no account or key is needed** for a demo.

## 1. Install once
| Tool | Where | Check |
|---|---|---|
| Git | git-scm.com | `git --version` |
| Node.js 22 or newer (LTS) | nodejs.org | `node --version` |
| pnpm 9 | after Node: `npm install -g pnpm@9` | `pnpm --version` |
| Docker Desktop (**running**; on Windows it needs WSL 2) | docker.com | `docker ps` shows no error |

An Internet connection is needed the first time (downloads, Google fonts).

## 2. Get the code
```bash
git clone https://github.com/llamauser/SatexWebsite.git
cd SatexWebsite
pnpm install
```

## 3. Start the local database (first time: 5 to 10 minutes of downloads)
```bash
pnpm db:start
```
It prints the addresses when it is ready (Studio, Mailpit, API). Leave Docker running.

## 4. Create the settings file `.env.local`
Windows PowerShell:
```powershell
node scripts/supabase-env.mjs | Out-File -Encoding ascii .env.local
Add-Content .env.local "NEXT_PUBLIC_SITE_URL=http://localhost:3000"
Add-Content .env.local "AI_PROVIDER=fake"
Add-Content .env.local "EMBED_PROVIDER=fake"
Add-Content .env.local "EMAIL_PROVIDER=log"
Add-Content .env.local "CRON_SECRET=local-secret"
```
macOS / Linux:
```bash
node scripts/supabase-env.mjs > .env.local
printf "NEXT_PUBLIC_SITE_URL=http://localhost:3000\nAI_PROVIDER=fake\nEMBED_PROVIDER=fake\nEMAIL_PROVIDER=log\nCRON_SECRET=local-secret\n" >> .env.local
```

### Using Ollama instead of the fake AI (this PC)
Install Ollama (ollama.com), start it, and download the two models once:
```bash
ollama pull bge-m3      # embeddings (1024 numbers: this is what the database expects)
ollama pull qwen3:8b    # understands the search brief, writes the explanations, translates
```
`qwen3:8b` needs about 8 GB of free memory; on a weaker PC use a smaller model (for example `qwen3:4b`) and put its name in `OLLAMA_CHAT_MODEL`.
Then use these lines in `.env.local` **in place of** the `AI_PROVIDER` / `EMBED_PROVIDER` lines of step 4:

PowerShell:
```powershell
Add-Content .env.local "AI_PROVIDER=ollama"
Add-Content .env.local "EMBED_PROVIDER=ollama"
Add-Content .env.local "OLLAMA_BASE_URL=http://localhost:11434"
Add-Content .env.local "OLLAMA_CHAT_MODEL=qwen3:8b"
Add-Content .env.local "EMBEDDING_MODEL=bge-m3"
```
(If `AI_PROVIDER=fake` is already in the file, delete those two `fake` lines.) Check Ollama answers: open http://localhost:11434 (it says "Ollama is running").
The first search is slow while the model loads into memory. Local models are weaker than Claude, especially in Arabic: results are good enough for a demo, not the final quality.

**If the database was already seeded with the fake AI**, rebuild the search data: open Supabase Studio (http://127.0.0.1:54323) → SQL editor → run
`delete from public.embeddings; update public.fabrics set name = name;` and keep the job runner of step 7 running: each fabric is embedded again by Ollama (a few minutes for 30 fabrics).

## 5. Fill the database with demo data
```bash
pnpm db:seed
```
Creates the demo accounts, 30 fabrics with colors, stock, and demo quotes, orders and samples. The passwords are written to `.seed-credentials.local.json` (never committed).

## 6. Start the website
```bash
pnpm dev
```
Open http://localhost:3000 (it redirects to /fr). Switch language with FR / EN / عربي in the header.

## 7. Start the background jobs (second terminal)
Translations, AI search data and e-mails are processed by a job runner. Online, Vercel calls it every minute; locally call it yourself:

PowerShell:
```powershell
while ($true) { curl.exe -s -H "Authorization: Bearer local-secret" http://localhost:3000/api/jobs/run | Out-Null; Start-Sleep 15 }
```
macOS / Linux:
```bash
while true; do curl -s -H "Authorization: Bearer local-secret" http://localhost:3000/api/jobs/run >/dev/null; sleep 15; done
```

## 8. Accounts to try
Open `.seed-credentials.local.json` for the passwords.
| Role | E-mail | Goes to |
|---|---|---|
| Admin | `admin@satex.test` | /fr/admin (everything) |
| Sales | `sales1@satex.test` | /fr/admin (quotes, orders, stock, cutting...) |
| Clients | `client1@satex.test` ... `client5@satex.test` | /fr/account (quotes, orders, reservations, samples) |

Handy addresses: **Mailpit** http://127.0.0.1:54324 (sign-up and password e-mails), **Supabase Studio** http://127.0.0.1:54323 (browse the database). E-mails sent by the shop (quotes, orders...) are only recorded in the `email_log` table in this mode.

## 9. Things to show in a demo
1. Home, catalog with filters, a fabric page with live stock (change stock in /admin/stock and watch the page update).
2. AI search (/fr/match): answer the 5 steps, get matches (fake AI gives deterministic answers; real answers need `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY`).
3. Showroom (/fr/showroom): 3D scene, click a department; "2D view" button for the plan.
4. As a client: add fabrics to the quote, sign in, send the request. As sales: /fr/admin/quotes, change prices, "Send to client" (PDF), then accept as the client, "Convert to order", cutting board, delivery.

## 10. Stop and restart
```bash
pnpm db:stop     # stops the database (data is kept)
pnpm db:start    # starts it again
pnpm db:reset    # wipes the database and re-applies the migrations (then run pnpm db:seed again)
```

## Problems
- **`pnpm db:start` fails**: Docker Desktop is not running (start it and wait for the whale icon to be steady), or ports 54321-54324 are used.
- **Page shows no fabrics**: the seed was not run, or `.env.local` was created before `pnpm db:start` finished. Redo steps 4-5 and restart `pnpm dev`.
- **Error about fonts when starting**: no Internet; connect once, the fonts are then cached.
- **Changed `.env.local`**: stop `pnpm dev` (Ctrl+C) and start it again.
- **Accounts do not work after `db:reset`**: run `pnpm db:seed` again (it rewrites the passwords file).
