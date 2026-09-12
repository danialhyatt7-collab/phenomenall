# PHENOMENAL — Handoff

Last updated 12 Sep 2026.

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

## Environment variables (hPanel → Environment variables)

Set them, then **redeploy** — they are only read at boot.

| Variable | Required | Notes |
| --- | --- | --- |
| `META_CAPI_TOKEN` | yes | Conversions API. Without it every server event silently no-ops. |
| `PHENOMENAL_DATA_DIR` | yes | `/home/u572472735/phenomenal-data`. Orders and admin login live here, **outside** the app directory a deploy replaces. |
| `ADMIN_USER` / `ADMIN_PASSWORD` | yes | Admin sign-in. Currently `phenomenal808`. |
| `META_TEST_EVENT_CODE` | no | **Only while testing.** While set, events reach Test Events and nothing else — they do not count toward reporting or ad optimisation. Delete the row (do not blank it) and redeploy when done. |
| `META_PIXEL_ID` | no | Defaults to the dataset above. Injected into the HTML at serve time. |
| `META_PURCHASE_ON` | no | Order status that triggers Purchase. Default `confirmed`. |

Boot log (hPanel → Runtime logs) states the truth on every start:
`Data directory: … (N orders on file)` and `Meta Purchase: ON … live reporting`.
If the data directory line carries a WARNING, `PHENOMENAL_DATA_DIR` did not take.

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

## Still open

1. **Supplier specs.** GSM removed and still invented. The size chart is industry-standard
   figures, not measurements from actual stock. "Bone cream" unconfirmed. Paid traffic is
   being sent to a page making these claims; wrong sizing on COD means refused parcels and
   the courier is paid both ways.
2. **Hero video playback on a real iPhone** — never confirmed by anyone. The dev container
   has no H.264 decoder so it cannot be tested there.
3. **Aggregated Event Measurement ranking** — domain is verified, ranking not set. Meta's
   default applies. Rank InitiateCheckout top while it is the optimisation event; changing
   it starts a 72-hour cooling period, so do it between campaigns.
4. **three.js, 670 KB** for the frost in the scroll section. Lazy-loaded now, so it costs
   nothing up front. Canvas 2D would do the same in ~3 KB.
5. **Test orders** from 12 Sep still in admin — cancel them so revenue starts at zero.

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

The hero is the shirt full-bleed with the copy in a bar along the bottom; nothing sits on
the garment, which is both the product and the line. The three-step scroll world lives
between the order form and the FAQ, not at the top. `home-01.html` is a separate warm
cream page, deliberately off-palette, and uses `assets/product.jpg`; swapping in a real
cream-wall model shot would let its colour correction and edge feather come off entirely.
