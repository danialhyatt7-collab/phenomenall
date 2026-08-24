# Phenomenal — Shot of Whiskey Tee

A one-product, high-converting store for an oversized heavyweight tee, with:

- **three.js hero** — the tee rendered as a cloth-waving textured plane floating in amber ember dust, with mouse parallax.
- **WhatsApp checkout** — size/quantity picker with a live message preview; the order opens pre-written in WhatsApp to **0337 4841818**.
- **Order-recording backend** — a zero-dependency Node server with Shopify-style features: product catalog API, order records, status pipeline (pending → confirmed → shipped → delivered), revenue stats, and an admin dashboard.

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
| `/api/orders` | POST | Record an order (called automatically at checkout) |
| `/api/orders/:id` | PATCH | Update order status |
| `/api/stats` | GET | Orders / units / revenue summary |

## Static hosting

`index.html` also works as a pure static page (GitHub Pages, Netlify, the deployed artifact): the order-recording call fails silently and WhatsApp remains the order channel.
