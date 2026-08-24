# PHENOMENAL — Shot of Whiskey Tee

A one-product store for an oversized drop-shoulder tee, built as an immersive scroll experience.

- **Hero loop** — the tee floating in monochrome smoke, generated with Nano Banana Pro + Kling 3.0, upscaled to 2K and rebuilt as a seamless forward-and-reverse loop. Two cuts are shipped and chosen by screen orientation: `ice-wide.mp4` (2578×1440) for landscape, `ice.mp4` (1440×1928) for portrait.
- **Scroll chapters** — a pinned 400vh stage crossfades three chapters (01 The Statement → 02 The Tee → 03 The Drop) with a live chapter index.
- **three.js** — a light drifting-particle layer over the video, capped at 30fps and paused off-screen so it stays smooth on older devices.
- **Utility header** — nav, working search over a page index, region chip, support, and a cart badge wired to the live order quantity.
- **Checkout** — size, quantity, name, contact number, address, email and a marketing opt-in; the order is sent through and recorded by the backend.
- **Backend** — a zero-dependency Node server with product catalog, order records, a status pipeline, revenue stats, and an admin dashboard.

Product: Rs 7,999, free shipping nationwide, cash on delivery.

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

## Static hosting

`index.html` also runs as a pure static page (GitHub Pages, the published artifact): the order-recording call fails silently there and the message channel carries the order.
