# PHENOMENAL — Handoff

Last updated 13 Sep 2026.

## Links

Live <https://phenomenal.pk/> · Admin <https://phenomenal.pk/admin> · Alt home <https://phenomenal.pk/home-01.html>
Repo `danialhyatt7-collab/phenomenall` · Dataset `927494272063012` ("Phenomenal Data") · Business `765618932338430`

## Deploy

Hostinger auto-deploys from `main`. Push, and it is live in 30–75 seconds.

```
git push origin <branch>
git checkout main && git merge --ff-only <branch>
git push origin main
```

No artifact build, no Pages branch. HTML is served `no-cache` so a deploy is picked
up at once; assets carry a week of `Cache-Control` and an ETag.

Verify a deploy with a cache-busted request, never a browser reload:
`curl -s "https://phenomenal.pk/?cb=$(date +%s)" | grep <something you changed>`

**Verify GET-only against production.** Do not POST to `/api/orders` to test — it
writes to the live order log. On 13 Sep eight blank test orders were created this way
and had to be deleted by hand from the admin. Test writes against a local
`node server.js` on a spare port with a scratch `PHENOMENAL_DATA_DIR`.

## Environment variables (hPanel → Environment variables)

Set them, then **redeploy** — they are only read at boot.

| Variable | Required | Notes |
| --- | --- | --- |
| `META_CAPI_TOKEN` | yes | Conversions API. Without it every server event silently no-ops. |
| `PHENOMENAL_DATA_DIR` | yes | `/home/u572472735/phenomenal-data`. Orders, admin login, session replays and the analytics tally live here, **outside** the app directory a deploy replaces. |
| `ADMIN_USER` / `ADMIN_PASSWORD` | yes | Admin sign-in. Current values: user `phenomenal808`, password `phenomenal888`. Seeds `auth.json` (scrypt-hashed) on boot. |
| `META_TEST_EVENT_CODE` | no | **Only while testing.** While set, events reach Test Events and nothing else — they do not count toward reporting or ad optimisation. Delete the row (do not blank it) and redeploy when done. |
| `META_PIXEL_ID` | no | Defaults to the dataset above. Injected into the HTML at serve time. |
| `META_PURCHASE_ON` | no | Order status that triggers Purchase. Default `confirmed`. |

Boot log (hPanel → Runtime logs) states the truth on every start:
`Data directory: … (N orders on file)` and `Meta Purchase: ON … live reporting`.
If the data directory line carries a WARNING, `PHENOMENAL_DATA_DIR` did not take.

## Product — all specs verified against the supplier (13 Sep)

Nothing on the page is invented any more. Confirmed from the supplier product card
and size chart:

- **Colour:** White (not the old "bone cream").
- **Print:** DTF — a full-colour transfer heat-pressed onto the fabric. The old copy
  ("soft-hand ink that sits into the fabric") described the opposite of DTF and was wrong.
- **Fabric:** 35% cotton, 65% polyester (PC blend). Confirmed.
- **Neck / cut:** Round neck, oversized drop-shoulder.
- **Care:** No bleach · machine wash cool (up to 40°C) · no tumble dry · iron low, never
  directly over the print.
- **Sizes:** S–XL only. XXL was removed (the maker's chart does not cover it — add it back
  only with real numbers). Chart is the maker's flat (half) measurements in inches:

  | Size | Chest | Length | Shoulder | Sleeve |
  | --- | --- | --- | --- | --- |
  | S | 21" | 27" | 23.5" | 8" |
  | M | 22" | 28" | 24.5" | 9" |
  | L | 23" | 29" | 25.5" | 9.5" |
  | XL | 24" | 30" | 26.5" | 10" |

  Chest is a flat width; the size note tells buyers to double it to compare with the
  body. Keep `data/products.json`, the on-page size table, the spec grid, the Product
  JSON-LD and the server-side size whitelist in step if any of this changes.

## SEO & sharing

- **Open Graph + Twitter card + canonical** in the storefront `<head>`. Controls the link
  preview on WhatsApp, Instagram, Messenger. Share image is `assets/ice-hero-wide.jpg`.
  Absolute URLs are required.
- **Product JSON-LD** (schema.org) in the `<head>`. Controls the Google rich result
  (price, "In stock"). Values mirror the live product. Validate at
  <https://search.google.com/test/rich-results>.
- **Favicons + apple-touch-icon** (`assets/favicon.png`, `assets/apple-touch-icon.png`) —
  the star mark alone, on its black ground (iOS flattens transparency onto white).

## Security

- **Baseline response headers on every route** (`server.js`, top of the request handler):
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`,
  `Permissions-Policy`, and `Strict-Transport-Security` when `x-forwarded-proto` is https.
  Set with `res.setHeader` so each route's own `writeHead` does not clobber them.
- **No CSP yet.** The pages carry inline scripts (the pixel, the storefront logic), so a
  real policy needs nonces injected at serve time — a separate, larger job. This is the
  main remaining security item.
- **Rate limits are per-process, in-memory.** `orderAllowed` (6 / 10 min), `trackAllowed`
  (40 / min) and the login lockout (8 attempts / 15 min) all live in a `Map` in one Node
  process. The host runs **multiple worker processes**, so these are not global caps and
  an admin session created on one worker is not seen by another. A true global limit (and
  cross-worker sessions) would need shared state — see "Still open".

## Admin

Dark "SmartShort" theme, lime accent, usable on a phone. Views (sidebar):

- **Home** — dashboard: order counts, units, revenue.
- **Orders** — the order list; per-order status pipeline
  (pending → confirmed → shipped → delivered) and a **Delete** button. Confirming an order
  is what fires the Meta Purchase; a deleted Purchase cannot be withdrawn from Meta.
- **Products** / **Customers** — catalog and buyer list.
- **Live** — real-time board fed by `/api/track`: visitors now, pageview sparkline, the
  browse funnel, an activity feed, today's sales. Anonymous per-browser hash, in memory.
- **Globe** (on Live) — dotted-continents canvas world. Order pins on the real delivery
  city; live-visitor dots placed coarsely by browser timezone (no IP lookup — deliberately
  imprecise, and labelled as such).
- **Trends** — durable per-day history, week-over-week KPI deltas and charts. Orders and
  revenue are derived retroactively from the order log; traffic builds from now on.
- **Sessions** — self-hosted rrweb session replay. Records **engaged** visits only (zero
  cost on bounces), all form fields masked, storage capped. Lists replays, flags
  conversions, keeps a stored/all-time count, has a date filter.

## Events

Every browser event is sent twice — once by the pixel, once by the server — under the
same `event_id`. That shared id is what makes Meta count one event, shown in Events
Manager as *Browser and Server, deduplicated*.

| Event | Fires | Sent from |
| --- | --- | --- |
| PageView | page load | browser + server |
| ViewContent | order section scrolls into view, once per session | browser + server |
| AddToCart | at checkout, beside InitiateCheckout | browser + server |
| InitiateCheckout | checkout submit, after validation, before WhatsApp | browser + server |
| Contact | any WhatsApp link click | browser + server |
| Purchase | **admin only** — "Mark as confirmed" | server only |

`/api/track` is the server half. It accepts only the five browser events, so Purchase
cannot be fired from a page even by a hand-crafted request, and it is rate limited per IP.
The same call also feeds the Live view and the durable analytics tally — separate from
Meta, and touching neither the pixel nor the Conversions API.

AddToCart fires at checkout, not on the size chips: M is preselected, so a buyer happy
with M never "selects" a size and the event was missing for most real orders.

### Purchase rules

- Sent **only** on the transition into `confirmed`, from the admin. Never from the site.
- `event_id` is the order id, so repeated confirms cannot double-count. Verified: four
  clicks produce one event.
- A failed send is retried on the next confirm; a successful one never is.
- Stamped at the **moment of confirmation**, not when the order was placed. Meta rejects
  events older than seven days and these orders are confirmed on delivery, roughly a week
  out — stamping at confirmation is what keeps them inside the window.
- The admin shows, per order, whether the event actually reached Meta.

### Customer data

Hashed with SHA-256 **server-side only** — the access token never reaches the browser.
Phone is normalised to E.164 digits first (`0300 1234567` → `923001234567`), name and
email lowercased, country `pk`. `fbp`, `fbc`, IP and user agent go unhashed, as Meta
expects. The browser also passes the same details to the pixel as advanced matching,
which hashes its own copy.

## Orders

Stored as JSON in `PHENOMENAL_DATA_DIR`, with a `.bak` written alongside every save and
read automatically if the live file is lost or truncated. Each order keeps the customer
details, `fbp`, `fbc`, IP, user agent, and the `ic_event_id` of the InitiateCheckout that
started it, so a sale can be traced back to the click.

The browser posts the order with `sendBeacon` so it survives the switch to WhatsApp.

## Code map

- `server.js` — zero-dependency Node HTTP server: static serving with byte ranges,
  the API, Meta CAPI, auth, rate limits, security headers.
- `analytics.js` — durable per-day tally for Trends (flushed to disk every 30s).
- `rec-store.js` — session-replay storage (rrweb events), capped.
- `tz-geo.js` — timezone → coarse point, and delivery address → city point, for the globe.
- `vendor/rrweb-*` — self-hosted rrweb record + player (no CDN).
- `index.html` — the storefront. `admin.html` — the admin app. `home-01.html` — alt page.

## API

| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/api/products` | GET | — | Catalog |
| `/api/track` | POST | rate-limited | Server half of a browser event; feeds Live + Trends |
| `/api/orders` | POST | rate-limited | Record an order (checkout) |
| `/api/orders` | GET | admin | All orders |
| `/api/orders/:id` | PATCH | admin | Update status (fires Purchase on `confirmed`) |
| `/api/orders/:id` | DELETE | admin | Remove an order (clear test rows) |
| `/api/rec` | POST | — | Store a session replay chunk |
| `/api/rec`, `/api/rec/:id` | GET | admin | List / read replays |
| `/api/rec/:id` | DELETE | admin | Delete a replay |
| `/api/live` | GET | admin | Live board data |
| `/api/trends` | GET | admin | Historical KPIs |
| `/api/stats`, `/api/customers` | GET | admin | Summary / buyer list |
| `/api/login`, `/api/logout`, `/api/me` | POST/GET | — | Admin session |

## Still open

1. **Hero video playback on a real iPhone** — never confirmed by anyone. The dev container
   has no H.264 decoder so it cannot be tested there.
2. **Aggregated Event Measurement ranking** — domain is verified, ranking not set. Meta's
   default applies. Rank InitiateCheckout top while it is the optimisation event; changing
   it starts a 72-hour cooling period, so do it between campaigns.
3. **Global rate limiting + cross-worker admin sessions.** Both are per-process today (see
   Security). Fine for now; a shared store (small file or similar) would make them real.
4. **Content-Security-Policy** with script nonces — the last cheap-ish security header not
   yet shipped, blocked on the inline scripts.
5. **Real product photography.** `home-01.html` still uses `assets/product.jpg`; a real
   white-tee model shot would let its colour correction and edge feather come off entirely.
6. **Operational:** order `PA-F3748ECC` (Rashid Lucky, 13 Sep) is `pending` in the admin —
   action it.

Resolved since the 12 Sep handoff: supplier specs (colour/print/fabric/sizes/care all now
real), three.js replaced by a ~3 KB canvas-2D frost, and all test orders cleared.

## Running ads

Optimise on **InitiateCheckout**. Purchase volume is near zero and confirmations lag a
week, so Purchase cannot drive learning yet; switch past roughly 50/week. Do not judge a
campaign on Purchase before day 8 — the number is structurally incomplete until
confirmations land. Expect a gap between InitiateCheckout and confirmed orders; that is
cash on delivery, not broken tracking.

For opted-out iOS users the attribution window is capped at seven days, which is where
these confirmations land. Some iPhone-sourced sales will never attribute. Apple's rule,
not fixable.

## Gotchas, all of these cost real time

- **The host runs multiple worker processes.** Anything held in process memory (rate-limit
  counters, login lockout, admin sessions) is per-worker, not shared. A request can land on
  a worker that has never seen your session, so an authed call may 401 at random — retry and
  it hits the right one. This is why the order rate limit did not trip in production testing.
- **The cascade bites repeatedly.** Author CSS beats the browser's `[hidden]` rule. Class
  selectors outrank bare `h1,h2,h3`. Two overrides in this file did nothing until they were
  moved *after* the single-class rules they had to beat. If a change "does nothing",
  suspect ordering before logic.
- **iOS will not load a `display:none` video.** It counts as off-screen, so `canplay` never
  fires and the poster stays up for good. Lay the video out and animate opacity instead.
- **iOS needs byte ranges.** A server answering a Range request with `200` and the whole
  file will not play video at all. `serveStatic` returns `206` properly.
- **`100vh` on iOS is the chrome-hidden height**, so a full-height pane hangs under Safari's
  URL bar and its contents get cut. Use `svh` with a `vh` fallback.
- **The font stylesheet is render-blocking.** It once held first paint for 12.7 seconds. It
  is now a preload that promotes itself; do not turn it back into a plain stylesheet link.
- **Assets need `Cache-Control`** or the browser re-downloads them per element. The 5 MB
  hero clip was fetched twice on every visit until headers were added.
- **`pkill -f "node server.js"` kills your own shell**, as does `pkill -f <anything in your
  own command line>`. Use `pgrep -f "^node server\.js$"`, or just use a different port.
- **Playwright force-clicks can hit overlays.** Use `form.requestSubmit()`.
- **Events Manager's "Time received" shows the event_time you send**, not when Meta got it.
  This looked exactly like Purchase firing at checkout and cost a long detour.
- **Test events vs live.** While `META_TEST_EVENT_CODE` is set nothing counts. Separately,
  opening the site from the Test events tab flags *your browser* with a cookie, so your own
  visits keep landing there. Test in a private window to see the live path.

## Design

Rs 4,999 struck from Rs 7,999, "first-drop price" — one PRICE/WAS_PRICE pair drives
everything. Scarcity stays factual: no timers, no "only N left".

Sora display (-0.03em) + Inter body, IBM Plex Mono labels. Monochrome, `#070606` / `#F2EFE9`.
No WhatsApp green. Never regenerate the hero footage. Cursor drift was removed by request —
do not reintroduce it.

The brand mark is the chrome star (`assets/brand-mark.webp`), keyed to transparency and
animated (echo rings, sheen sweep, travelling sparkle) around a static raster, in the
storefront header and footer. The wordmark was removed by request.

The hero is the shirt full-bleed with the copy in a bar along the bottom; nothing sits on
the garment, which is both the product and the line. The three-step scroll world lives
between the order form and the FAQ, not at the top. `home-01.html` is a separate cream
page, deliberately off-palette, and uses `assets/product.jpg`; the tee itself is white.
