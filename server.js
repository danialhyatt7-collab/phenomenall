/**
 * Phenomenal store backend — zero-dependency Node server.
 *
 * Serves the storefront and provides Shopify-style commerce features:
 *   GET  /api/products        product catalog
 *   GET  /api/orders          all recorded orders (admin)
 *   POST /api/orders          record a new order (called at WhatsApp checkout)
 *   PATCH /api/orders/:id     update order status (pending → confirmed → shipped → delivered)
 *   GET  /api/stats           revenue / order-count summary
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
        unit_price: 2199,
        total: 2199 * qty,
        name: body.name ? String(body.name).slice(0, 120) : null,
        city: body.city ? String(body.city).slice(0, 120) : null,
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
      return json(res, 200, {
        orders: orders.length,
        pending: orders.filter((o) => o.status === "pending").length,
        units: active.reduce((s, o) => s + o.qty, 0),
        revenue: active.reduce((s, o) => s + o.total, 0),
      });
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
