# Zain Catering Services — Business Automation Stack

n8n + PostgreSQL + Admin Portal + Gotenberg + Cloudflare Tunnel — complete.

## What's in this folder

```
zain-catering-automation/
├── docker-compose.yml              # n8n + Postgres + Admin Portal + Gotenberg + Cloudflare Tunnel
├── .env.example                    # copy to .env and fill in real secrets
├── postgres-init/
│   ├── 01_schema.sql               # runs automatically on first container start
│   └── 02_seed_data.sql            # (empty — fresh start, no demo data)
├── admin-portal/                   # custom Node.js dashboard + webhook proxy
│   ├── Dockerfile
│   ├── package.json
│   ├── server.js                   # Express API + static file server
│   └── public/
│       ├── index.html              # SPA shell
│       ├── styles.css              # dark-theme design system
│       └── app.js                  # dashboard rendering + Typeform-style wizard forms
├── invoice-template/
│   └── invoice_template.html       # Zain Catering branded invoice layout
├── n8n-data/                       # n8n workflows + credentials (persisted volume)
├── postgres-data/                  # actual database files (persisted volume)
├── zain_catering_COMBINED_WORKFLOW.json   # ALL workflow modules merged into ONE importable file
└── validate.py                     # script to check workflow JSON for duplicate/dangling nodes
```

## First-time setup

1. `cp .env.example .env` and fill in real passwords/secrets.
2. (Optional but recommended for anything client-facing) Set up Cloudflare Tunnel:
   - Install `cloudflared` on the host machine
   - `cloudflared tunnel login`
   - `cloudflared tunnel create zain-n8n`
   - `cloudflared tunnel token zain-n8n` → paste into `.env` as `CLOUDFLARE_TUNNEL_TOKEN`
   - Point a DNS record (e.g. `automation.zaincatering.com`) at the tunnel via the Cloudflare dashboard
   - Update `WEBHOOK_URL`, `N8N_HOST`, `N8N_PROTOCOL` in `.env` to match
3. `docker compose up -d`
4. n8n editor: `http://localhost:5678` (or your tunnel domain) — login with the basic auth creds from `.env`
5. Admin Portal: `http://localhost:8080` — custom dashboard with KPIs, order/client/invoice/payment tables, and built-in order & payment forms.
6. Gotenberg runs headless on `:3000` — no UI, n8n's HTTP Request node will call it directly during invoice generation.

## Database schema

Six tables in the `public` schema (n8n uses a separate `n8n_internal` schema in the same Postgres instance):

| Table | Purpose |
|---|---|
| `clients` | Name, phone (unique key), WhatsApp number, email, address, `last_order_at` |
| `orders` | One row per event — ref, event date, guest count, venue, sound system, status |
| `invoices` | One per order — total, paid amount, **generated column** `balance = total - paid_amount` |
| `payments` | Real payments AND promise-to-pay entries (`is_promise`, `promised_date`, `promise_status`) |
| `feedback` | Rating + comment per order |
| `reminder_log` | Audit trail so reminders aren't sent twice |

Two sequences (`order_ref_seq`, `invoice_number_seq`) generate clean numbering: `ZC-2026-0001`, `ZC-INV-2026-0001`.

## Why n8n shares the same Postgres instance

n8n needs its own storage for workflow definitions, execution logs, and credentials. Rather than run a second database container, it's pointed at the same Postgres but a **separate schema** (`n8n_internal`), so:
- One backup covers everything
- n8n's internal tables never collide with business tables

## Admin Portal features

The admin portal at `:8080` provides:

- **Dashboard** — KPI cards (total orders, revenue, pending balance, active clients) + recent orders table
- **Orders page** — filterable by status, searchable by name/phone/ref, CSV export
- **Clients page** — client directory with order counts and last event date
- **Invoices page** — filterable by payment status, with balance highlighting
- **Payments page** — real payments and promise-to-pay entries
- **Built-in wizard forms** — Typeform-style step-by-step forms for:
  - Client Order Request
  - Internal Order Entry (phone orders)
  - Confirm Order & Issue Invoice
  - Log Payment or Promise

The wizard forms submit directly to n8n webhooks via a server-side proxy, so the admin portal and n8n work together seamlessly.

## Importing the workflow

Import `zain_catering_COMBINED_WORKFLOW.json` once in n8n (Workflows → Import from File). All entry points (webhook triggers, schedule triggers, error trigger) live on one canvas, already wired together.

### Required one-time setup after import

1. **Postgres credential**: create a credential named exactly `Zain Catering Postgres` pointing at the `postgres` container (host: `postgres`, port `5432`, database/user/password from your `.env`).
2. **SMTP credential**: create `Zain Catering SMTP` for outgoing email (Gmail app password, or any SMTP relay).
3. **Google Drive credential** (for invoice PDF storage): create `Zain Catering Google Drive` via OAuth2, then set a real `folderId` on the "Upload Invoice PDF to Drive" node.
4. **Cloudflare Tunnel domain**: replace `YOUR_N8N_DOMAIN` in the feedback request email node with your real domain.
5. **Activate**: flip the workflow from inactive to active once credentials are wired up.

## Suggested rollout order

1. Run one full manual test order through the admin portal's Internal Order Form → confirm/price it → check invoice PDF lands in Drive and (if email present) arrives in inbox.
2. Log a real payment and a "promise to pay" entry, confirm both update the invoice/`payments` table correctly.
3. Manually trigger the daily reminder sweep once (right-click → Execute Workflow in n8n) to see the digest format.
4. Walk Zain through the admin portal live — the order forms and dashboard are the parts he'll use most.
5. Only after a week of real orders, revisit the 45-day re-engagement threshold and 20% low-stock threshold with actual data.
