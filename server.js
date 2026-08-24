/**
 * Phenomenal store backend — zero-dependency Node server.
 *
 * Serves the storefront and provides Shopify-style commerce features:
 *   GET  /api/products        product catalog
 *   GET  /api/orders          all recorded orders (admin)
 *   POST /api/orders          record a new order (called at checkout)
 *   PATCH /api/orders/:id     update order status (pending → confirmed → shipped → delivered)
 *   GET  /api/stats           revenue / order-count summary
 *   GET  /api/customers       customers derived from the order log
 *   GET  /admin               orders dashboard
 *
 * Orders are persisted to data/orders.json (created on first order).
 * Run: node server.js   (PORT env var optional, defaults to 3000)
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");
const PORT = process.env.PORT || 3000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

const ORDER_STATUSES = ["pending", "confirmed", "shipped", "delivered", "cancelled"];

function readOrders() {
  try {
    return JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8"));
  } catch (err) {
    return [];
  }
}

function writeOrders(orders) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = ORDERS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(orders, null, 2));
  fs.renameSync(tmp, ORDERS_FILE);
}

function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(s);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => {
      buf += c;
      if (buf.length > 64 * 1024) {
        reject(new Error("payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(buf));
    req.on("error", reject);
  });
}

function serveStatic(res, urlPath) {
  let rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  if (rel === "admin") rel = "admin.html";
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT) || rel.startsWith("data") || rel === "server.js") {
    json(res, 404, { error: "not found" });
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      json(res, 404, { error: "not found" });
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;

  try {
    if (p === "/api/products" && req.method === "GET") {
      const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf8"));
      return json(res, 200, products);
    }

    if (p === "/api/orders" && req.method === "GET") {
      return json(res, 200, readOrders());
    }

    if (p === "/api/orders" && req.method === "POST") {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (err) {
        return json(res, 400, { error: "invalid JSON body" });
      }
      const qty = Math.max(1, Math.min(10, parseInt(body.qty, 10) || 1));
      const order = {
        id: "PA-" + crypto.randomBytes(4).toString("hex").toUpperCase(),
        created_at: new Date().toISOString(),
        product: String(body.product || "Shot of Whiskey tee").slice(0, 120),
        size: ["S", "M", "L", "XL", "XXL"].includes(body.size) ? body.size : "M",
        qty,
        unit_price: 7999,
        total: 7999 * qty,
        name: body.name ? String(body.name).slice(0, 120) : null,
        phone: body.phone ? String(body.phone).slice(0, 40) : null,
        address: body.address ? String(body.address).slice(0, 240) : null,
        email: body.email ? String(body.email).slice(0, 120) : null,
        marketing_opt_in: body.marketing_opt_in === true,
        channel: "whatsapp",
        status: "pending",
      };
      const orders = readOrders();
      orders.unshift(order);
      writeOrders(orders);
      return json(res, 201, order);
    }

    const patchMatch = p.match(/^\/api\/orders\/([A-Za-z0-9-]+)$/);
    if (patchMatch && req.method === "PATCH") {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (err) {
        return json(res, 400, { error: "invalid JSON body" });
      }
      if (!ORDER_STATUSES.includes(body.status)) {
        return json(res, 400, { error: "status must be one of: " + ORDER_STATUSES.join(", ") });
      }
      const orders = readOrders();
      const order = orders.find((o) => o.id === patchMatch[1]);
      if (!order) return json(res, 404, { error: "order not found" });
      order.status = body.status;
      order.updated_at = new Date().toISOString();
      writeOrders(orders);
      return json(res, 200, order);
    }

    if (p === "/api/stats" && req.method === "GET") {
      const orders = readOrders();
      const active = orders.filter((o) => o.status !== "cancelled");
      const revenue = active.reduce((s, o) => s + o.total, 0);
      const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
      return json(res, 200, {
        orders: orders.length,
        pending: orders.filter((o) => o.status === "pending").length,
        units: active.reduce((s, o) => s + o.qty, 0),
        revenue,
        aov: active.length ? Math.round(revenue / active.length) : 0,
        last7: orders.filter((o) => new Date(o.created_at).getTime() >= since).length,
        by_status: ORDER_STATUSES.reduce((acc, st) => {
          acc[st] = orders.filter((o) => o.status === st).length;
          return acc;
        }, {}),
      });
    }

    // Customers are derived from the order log — one row per person, keyed on
    // whichever contact detail they gave (email preferred, then phone, then name).
    if (p === "/api/customers" && req.method === "GET") {
      const byKey = new Map();
      for (const o of readOrders()) {
        const key = (o.email || o.phone || o.name || "guest").toLowerCase().trim();
        let c = byKey.get(key);
        if (!c) {
          c = {
            id: key,
            name: o.name || null,
            phone: o.phone || null,
            email: o.email || null,
            city: o.city || null,
            address: o.address || null,
            marketing_opt_in: false,
            orders: 0,
            units: 0,
            spent: 0,
            first_order: o.created_at,
            last_order: o.created_at,
          };
          byKey.set(key, c);
        }
        c.orders += 1;
        c.name = c.name || o.name;
        c.phone = c.phone || o.phone;
        c.email = c.email || o.email;
        c.address = c.address || o.address;
        if (o.marketing_opt_in) c.marketing_opt_in = true;
        if (o.status !== "cancelled") {
          c.units += o.qty;
          c.spent += o.total;
        }
        if (o.created_at > c.last_order) c.last_order = o.created_at;
        if (o.created_at < c.first_order) c.first_order = o.created_at;
      }
      const list = Array.from(byKey.values()).sort((a, b) => (a.last_order < b.last_order ? 1 : -1));
      return json(res, 200, list);
    }

    if (req.method === "GET") return serveStatic(res, p);
    json(res, 405, { error: "method not allowed" });
  } catch (err) {
    json(res, 500, { error: "internal error" });
  }
});

server.listen(PORT, () => {
  console.log("Phenomenal store running → http://localhost:" + PORT);
  console.log("Admin dashboard        → http://localhost:" + PORT + "/admin");
});
