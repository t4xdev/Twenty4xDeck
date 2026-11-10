# Twenty4x Deck

The Twenty4x product portal and the small backend that handles its demo requests and tracked client links.

| Folder | What it is | Where it runs |
|---|---|---|
| [`Twenty4xBridge/`](Twenty4xBridge/) | The portal: a single-page site with a 3D vessel and the "Get a tailored demo" form | Static hosting at `https://deck.twenty4x.net` (later also `https://deck.twenty4x.com`) |
| [`twenty4x-lead-relay/`](twenty4x-lead-relay/) | Cloudflare Worker that emails leads through Brevo, records link visits, and hosts the admin pages | `https://twenty4x-lead-relay.twenty4x-lead-relay.workers.dev` |

```
Visitor's browser ──► Portal (index.html) ──► Lead relay (Cloudflare Worker) ──► Brevo ──► team inboxes
                                                     │
                                                     └──► D1 database: leads, visits, links
```

## What it does

- **Demo requests.** The portal's form posts to the relay. The relay saves the lead to D1, then emails the team through Brevo.
  The Brevo API key stays in Cloudflare, never in the website code.
- **Client links.** On `/links` you enter a client's name and get a unique portal link to copy and share.
  When the client opens it, the relay records the IP, full location, network and device, and emails the team
  ("Ravi Kumar opened your link · Dubai, United Arab Emirates · iPhone"). Each new browser session sends one email.
- **Admin pages** (browser login: any username, password = `ADMIN_PASSWORD`):

  | Page | Shows |
  |---|---|
  | `/links` | Create client links, copy them, and see the open count and last opened for each |
  | `/visits` | Every tracked link opening (`/visits?link=<code>` for one client, `/visits.csv` to export) |
  | `/leads` | Every demo request (`/leads.csv` to export) |

## Repository layout

```
Twenty4xBridge/
  index.html            the whole portal (HTML, CSS, JS in one file)
  vessel-glb.txt        3D vessel model, loaded by index.html; upload it next to index.html
twenty4x-lead-relay/
  src/worker.js         the Worker: lead form, visits, admin pages
  schema.sql            D1 tables (leads, visits, links); safe to run again
  wrangler.toml         Worker settings: recipients, sender, allowed origins, portal URLs, D1 binding
  test.mjs              lead-form tests
  test-visit.mjs        visit and client-link tests (uses an in-memory SQLite copy of schema.sql)
  README.md             full relay guide: setup, behaviour, tracked links
```

## Requirements

- Node.js 22.5 or newer (the tests use the built-in `node:sqlite`)
- A Cloudflare account with access to the `twenty4x-lead-relay` Worker and the `twenty4x-leads` D1 database
- A Brevo account with `twenty4x.net` authenticated as a sender domain

## Deploying

### 1. The relay

```bash
cd twenty4x-lead-relay
npx wrangler login                                                   # once per machine
npx wrangler d1 execute twenty4x-leads --remote --file=schema.sql    # only when schema.sql changed
npx wrangler deploy
```

Secrets are set once and survive deploys. They are never stored in this repository:

```bash
npx wrangler secret put BREVO_API_KEY     # Brevo v3 API key
npx wrangler secret put ADMIN_PASSWORD    # password for /links, /visits, /leads
```

### 2. The portal

Upload `Twenty4xBridge/index.html` and `Twenty4xBridge/vessel-glb.txt` to the portal's host.
Deploy the relay first when both have changed.

The portal finds the relay through `ENQUIRY_ENDPOINT` in `index.html`.

## Configuration

All in `twenty4x-lead-relay/wrangler.toml` under `[vars]`. Run `npx wrangler deploy` after any change.

| Variable | Purpose |
|---|---|
| `LEAD_RECIPIENTS` | Inboxes that receive demo requests (comma-separated) |
| `VISIT_RECIPIENTS` | Inboxes for "link opened" emails; falls back to `LEAD_RECIPIENTS` |
| `VISIT_EMAILS` | `on` or `off`. When off, visits are still saved |
| `SENDER_EMAIL`, `SENDER_NAME` | Sender; must be on a domain authenticated in Brevo |
| `ALLOWED_ORIGINS` | Sites allowed to post to the relay. Add every domain the portal is served from |
| `PORTAL_URLS` | Domain(s) client links point to. The first is the default; more than one adds a dropdown on `/links` |

To add `deck.twenty4x.com` once it is live, set
`PORTAL_URLS = "https://deck.twenty4x.net/,https://deck.twenty4x.com/"` and deploy.

## Testing

```bash
cd twenty4x-lead-relay
node test.mjs          # lead form
node test-visit.mjs    # visits and client links; prints PASS/FAIL per check
```

The tests mock Brevo and the database, so they send no email and touch no live data.

## Useful commands

```bash
npx wrangler tail                                                    # live relay logs
npx wrangler d1 execute twenty4x-leads --remote \
  --command "SELECT client, code, created_at FROM links ORDER BY id DESC LIMIT 20"
```

## Privacy

Visit tracking stores IP addresses and approximate location, which count as personal data under GDPR.
Mention link tracking in the privacy notice. Location comes from the IP address: usually right to the city,
and VPNs or mobile networks can show a different place.
