# Twenty4x lead relay (Brevo)

Every "Get a tailored demo" submission on the website is emailed through Brevo to:

- hello@twenty4x.com
- ceo@twenty4x.com
- productmanager@maritimeexpertise.com

Reply-to is set to the visitor, so hitting Reply answers them directly.

## Why this small relay exists

The Brevo API key must never be placed in the website's code: anyone can read page source and
use the key to send email from your Brevo account. The key lives in this Cloudflare Worker as an
encrypted secret. The website only knows the Worker's URL.

## One-time setup (about 10 minutes)

1. **Brevo: verify the sender.** Mail is sent from `noreply@twenty4x.net`. The domain `twenty4x.net`
   is already authenticated in Brevo (Settings, *Senders, domains and dedicated IPs*). To use a
   different address, change `SENDER_EMAIL` in `wrangler.toml`; it must be on an authenticated domain.
2. **Brevo: API key.** Brevo, *SMTP and API*, *API keys*: create a v3 key. Keep it out of chat,
   email and the website code.
3. **Cloudflare: account.** A free Cloudflare account is enough. Install Node.js 18+.
4. **Allowed origins.** In `wrangler.toml`, set `ALLOWED_ORIGINS` to every address the site is served
   from, for example `https://twenty4x.com,https://www.twenty4x.com`. Other websites are refused.
5. **Deploy.** In this folder:

   ```
   npx wrangler login
   npx wrangler secret put BREVO_API_KEY      # paste the Brevo key when prompted
   npx wrangler deploy
   ```

   Wrangler prints the relay URL, for example `https://twenty4x-lead-relay.<account>.workers.dev`.
6. **Connect the site.** In the site's code, set
   `const ENQUIRY_ENDPOINT='https://twenty4x-lead-relay.<account>.workers.dev';`
   (search for `ENQUIRY_ENDPOINT`). Or set `window.TWENTY4X_ENQUIRY_ENDPOINT` before the page script.
7. **Test.**

   ```
   curl -X POST "$RELAY_URL" -H "Origin: https://twenty4x.com" -H "Content-Type: application/json" \
     -d '{"contact":{"name":"Test Lead","email":"test@example.com","company":"Test Co"},"fleet":{"size":"1 to 5","vesselTypes":["Tankers"]}}'
   ```

   Expect `{"ok":true,"messageId":"..."}` and an email in all three inboxes.
   Watch live errors with `npx wrangler tail`.

## Behaviour

| Situation | Relay answer | What the visitor sees |
|---|---|---|
| Brevo accepted the email | 200 `{ok:true}` | "Request sent" |
| Missing name, company or valid email | 422 | Form error, nothing sent |
| Request from another website | 403 | Nothing sent |
| Bot filled the hidden trap field | 200, nothing sent | (bots only) |
| Brevo error (bad key, unverified sender) | 502 | "Your request was not sent", with email and copy fallback |
| Key or sender not configured | 500 | Same fallback |
| `ENQUIRY_ENDPOINT` empty on the site | (no call) | "Not sent yet", with email and copy fallback |

The website never shows "Request sent" unless the relay confirms Brevo accepted the email.

## Changing recipients

Edit `LEAD_RECIPIENTS` in `wrangler.toml` (comma-separated) and run `npx wrangler deploy`.

## Optional hardening

- Add a Cloudflare rate-limiting rule on the Worker route (for example 5 requests per minute per IP).
- Add Cloudflare Turnstile to the form if spam gets past the hidden trap field.

## Lead list (no email needed)

Every valid submission is saved in the Cloudflare D1 database `twenty4x-leads` (table `leads`, see
`schema.sql`) **before** the email is sent, so leads are kept even if Brevo fails. The `Email`
column shows `sent`, `failed` or `pending`.

- View: open `<relay-url>/leads`. The browser asks for a login: any username, password = `ADMIN_PASSWORD`.
- Download: `<relay-url>/leads.csv` (opens in Excel / Google Sheets).
- Set or change the password: `npx wrangler secret put ADMIN_PASSWORD`
- Query directly: `npx wrangler d1 execute twenty4x-leads --remote --command "SELECT * FROM leads ORDER BY id DESC LIMIT 20"`

## Client links (make a link per client)

Open `<relay-url>/links` (same password as `/leads`). Type the client name (company, email, campaign and note
are optional) and press **Create link**. You get a unique link such as

```
https://deck.twenty4x.net/?utm_source=twenty4x&utm_medium=client-link&utm_campaign=nov-fleet&utm_content=ravi-kumar-oceanic-lines-n7cge
```

Press **Copy** and send it. The link stays on the page, so you can copy it again later. The page shows how many
times each link was opened and when and where it was last opened. Click the number to see every visit for that client.

When the client opens it, the visit is saved with IP, full location (city, region, postcode, country), network and
device, and an email arrives: "Ravi Kumar opened your link · Dubai, United Arab Emirates · iPhone".
Every new browser session sends an email. Reloading the same tab does not.

The portal domain(s) offered come from `PORTAL_URLS` in `wrangler.toml`.
Removing a link keeps its past visits; later opens are still recorded but without the client name.

## Tracked links (who opened the portal)

Any portal link with `utm_*` tags is tracked. Untagged visits are not recorded or emailed.

**Make a link by hand.** Put the person or company in `utm_content`, so the email tells you who opened it:

```
https://deck.twenty4x.com/?utm_source=email&utm_medium=outreach&utm_campaign=nov-fleet&utm_content=john-acme
```

Use one link per person. Anyone they forward it to shows up under the same tag; a different IP or device usually gives that away.

**What happens.** The portal posts once per browser session to `<relay-url>/visit`. The relay adds the IP address,
location (city, region, postcode, country, coordinates and time zone, from Cloudflare), network owner (for example
a company's office network), browser, system and device type. It saves the visit in D1 (`visits` table) and emails
`VISIT_RECIPIENTS` (or `LEAD_RECIPIENTS` if that is not set). When the visitor leaves, the time on the page is added.

- Reloading the same tab sends no new email. A new tab, browser or device is a new session and sends one.
- Link previewers and email security scanners (Outlook Safe Links, Slack, WhatsApp, Mimecast and others) are ignored.
- `VISIT_EMAILS = "off"` in `wrangler.toml` stops the emails; visits are still saved.
- Visits: `<relay-url>/visits` and `/visits.csv`, with the same password as `/leads`.
- Leads now carry `visitor_id` in their attribution, which matches the `visitor_id` of their visits.

Location comes from the IP address and is usually right to the city, not the street. VPNs and mobile networks
can show a different place. An IP address is personal data under GDPR: mention visit tracking in the privacy notice.

**Turn it on** (one time, in this folder):

```
npx wrangler d1 execute twenty4x-leads --remote --file=schema.sql   # adds the visits and links tables; existing data is untouched
npx wrangler deploy
```

Then upload the updated `Twenty4x Bridge/index.html`. Test with `node test-visit.mjs`.
