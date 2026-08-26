# PHENOMENAL — Shot of Whiskey Tee

A one-product store for an oversized drop-shoulder tee, built as an immersive scroll experience.

- **Hero loop** — the tee floating in monochrome smoke, generated with Nano Banana Pro + Kling 3.0, upscaled to 2K and rebuilt as a seamless forward-and-reverse loop. Two cuts are shipped and chosen by screen orientation: `ice-wide.mp4` (2578×1440) for landscape, `ice.mp4` (1440×1928) for portrait.
- **Scroll chapters** — a pinned 400vh stage crossfades three chapters (01 The Statement → 02 The Tee → 03 The Drop) with a live chapter index.
- **three.js** — a light drifting-particle layer over the video, capped at 30fps and paused off-screen so it stays smooth on older devices.
- **Utility header** — nav, working search over a page index, region chip, support, and a cart badge wired to the live order quantity.
- **Checkout** — size, quantity, name, contact number, address, email and a marketing opt-in; the order is sent through and recorded by the backend.
- **Backend** — a zero-dependency Node server with product catalog, order records, a status pipeline, revenue stats, and an admin dashboard.
- **Tracking** — Meta pixel in the browser, plus a server-to-server Purchase sent when an order is actually confirmed.

Product: Rs 4,999 (first-drop price, down from Rs 7,999), free shipping nationwide, cash on delivery.

## Run

```bash
node server.js
# Store:  http://localhost:3000
# Admin:  http://localhost:3000/admin
```

No npm install needed — the backend uses only Node built-ins. Orders persist to `data/orders.json` (gitignored, created on first order).

## API

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/products` | GET | Product catalog |
| `/api/orders` | GET | All recorded orders |
| `/api/orders` | POST | Record an order (called at checkout) |
| `/api/orders/:id` | PATCH | Update order status |
| `/api/stats` | GET | Orders / units / revenue summary |

## Tracking

The browser fires `PageView` on load and `InitiateCheckout` when someone opens
WhatsApp from the order form. It deliberately does **not** fire `Purchase`:
this shop is cash on delivery, so opening WhatsApp is an intent, not a sale.
Reporting it as a purchase would inflate ROAS and teach Meta to optimise for
people who click checkout rather than people who actually pay.

`Purchase` is sent instead from the server, over the Conversions API, when an
order first reaches the trigger status — carrying the real order value, hashed
customer details, and the `_fbp` / `_fbc` identifiers captured at checkout so
Meta can match the sale back to the ad click. It is sent once per order and
keyed on the order id, so a retry cannot double-count.

Configure it with environment variables (the host's dashboard, no shell needed):

| Variable | Required | Purpose |
|---|---|---|
| `META_CAPI_TOKEN` | yes | Events Manager → your pixel → Settings → Generate access token. Without it Purchase is skipped and the reason is recorded on the order. |
| `META_TEST_EVENT_CODE` | no | Set while testing so events appear under Test Events instead of live reporting. Remove it when you go live. |
| `META_PURCHASE_ON` | no | Which status sends Purchase. Defaults to `confirmed` (fast feedback, good for ad learning). Use `delivered` to report only money actually collected, at the cost of a multi-day delay. |
| `META_PIXEL_ID` | no | Defaults to the store's pixel. |

The outcome of each attempt is stored on the order as `capi`, so a failure is
visible in `data/orders.json` rather than silent.

## Static hosting

`index.html` also runs as a pure static page (GitHub Pages, the published artifact): the order-recording call fails silently there and the message channel carries the order.
