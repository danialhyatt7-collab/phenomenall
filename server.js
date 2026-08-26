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
 *   GET  /admin               orders dashboard (owner login required)\n *\n * Set or change the owner login:  node server.js --set-login
 *
 * Orders are persisted to data/orders.json (created on first order).
 * Run: node server.js   (PORT env var optional, defaults to 3000)
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");

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

/* ---------------------------------------------------------------------------
 * Owner login.
 *
 * Credentials live in data/auth.json, which is gitignored and never contains a
 * plaintext password — only a random salt and an scrypt hash of it. The file is
 * written 0600. Sessions are random tokens held in memory, so restarting the
 * server signs everyone out.
 *
 * Change the login at any time with:  node server.js --set-login
 * ------------------------------------------------------------------------- */
const AUTH_FILE = path.join(DATA_DIR, "auth.json");
const SESSION_MS = 12 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;
const sessions = new Map();
const attempts = new Map();

function scryptHash(password, saltHex) {
  return crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64).toString("hex");
}
function sha(v) {
  return crypto.createHash("sha256").update(String(v)).digest();
}
function readAuth() {
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
  } catch (err) {
    return null;
  }
}
function saveLogin(username, password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const rec = { username, salt, hash: scryptHash(password, salt), updated_at: new Date().toISOString() };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(rec, null, 2), { mode: 0o600 });
  return rec;
}
function checkLogin(username, password) {
  const a = readAuth();
  if (!a) return false;
  const userOk = crypto.timingSafeEqual(sha(String(username).toLowerCase()), sha(a.username.toLowerCase()));
  const passOk = crypto.timingSafeEqual(
    Buffer.from(scryptHash(String(password), a.salt), "hex"),
    Buffer.from(a.hash, "hex")
  );
  return userOk && passOk;
}
function getCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
function currentUser(req) {
  const token = getCookie(req, "pa_session");
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return s.user;
}
function requireAuth(req, res) {
  if (currentUser(req)) return true;
  json(res, 401, { error: "Sign in to view this." });
  return false;
}
function clientKey(req) {
  return req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
}
setInterval(() => {
  const now = Date.now();
  for (const [t, s] of sessions) if (s.expires < now) sessions.delete(t);
}, 60 * 60 * 1000).unref();

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
    if (p === "/api/me" && req.method === "GET") {
      const user = currentUser(req);
      return user ? json(res, 200, { user }) : json(res, 401, { error: "Not signed in." });
    }

    if (p === "/api/login" && req.method === "POST") {
      const key = clientKey(req);
      const rec = attempts.get(key);
      if (rec && rec.count >= MAX_ATTEMPTS && Date.now() < rec.until) {
        return json(res, 429, { error: "Too many attempts. Try again in a few minutes." });
      }
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (err) {
        return json(res, 400, { error: "invalid JSON body" });
      }
      if (!checkLogin(body.username || "", body.password || "")) {
        const next = attempts.get(key) || { count: 0 };
        next.count += 1;
        next.until = Date.now() + LOCKOUT_MS;
        attempts.set(key, next);
        return json(res, 401, { error: "Wrong username or password." });
      }
      attempts.delete(key);
      const auth = readAuth();
      const token = crypto.randomBytes(32).toString("hex");
      sessions.set(token, { user: auth.username, expires: Date.now() + SESSION_MS });
      const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Set-Cookie":
          "pa_session=" + token + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=" +
          SESSION_MS / 1000 + secure,
      });
      return res.end(JSON.stringify({ ok: true, user: auth.username }));
    }

    if (p === "/api/logout" && req.method === "POST") {
      const token = getCookie(req, "pa_session");
      if (token) sessions.delete(token);
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Set-Cookie": "pa_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
      });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (p === "/api/products" && req.method === "GET") {
      const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf8"));
      return json(res, 200, products);
    }

    if (p === "/api/orders" && req.method === "GET") {
      if (!requireAuth(req, res)) return;
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
        unit_price: 4999,
        total: 4999 * qty,
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
      if (!requireAuth(req, res)) return;
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
      if (!requireAuth(req, res)) return;
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
      if (!requireAuth(req, res)) return;
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

/* ---- first run / changing the login ------------------------------------- */
/* One readline interface is reused for every question: creating a fresh one per
 * prompt drops anything already buffered on stdin, which breaks piped input. */
function makeAsker() {
  // Masking only makes sense on a real terminal; piped stdin has no echo to hide
  // and terminal mode would desync the prompts.
  const tty = !!process.stdin.isTTY;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
  let hide = false;
  let prompt = "";
  rl._writeToOutput = function (str) {
    if (!hide || !tty) return rl.output.write(str);
    // readline re-renders prompt + typed text on every keypress; redraw the
    // prompt alone so the password is never echoed to the screen.
    if (str.indexOf(prompt) === 0) rl.output.write(prompt);
  };
  return {
    ask(question, hidden) {
      return new Promise((resolve) => {
        hide = !!hidden;
        prompt = question;
        rl.question(question, (answer) => {
          if (hidden && tty) rl.output.write("\n");
          resolve(String(answer).trim());
        });
      });
    },
    close() {
      hide = false;
      rl.close();
    },
  };
}

function readAllStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => (data += d));
    process.stdin.on("end", () => resolve(data));
  });
}

async function setLoginInteractive() {
  let username = process.env.ADMIN_USER;
  let password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    if (process.stdin.isTTY) {
      console.log("\nSet the owner login for the Phenomenal admin.\n");
      const asker = makeAsker();
      username = await asker.ask("Username: ", false);
      password = await asker.ask("Password: ", true);
      const again = await asker.ask("Confirm password: ", true);
      asker.close();
      if (password !== again) {
        console.error("Those did not match. Nothing was changed.");
        process.exit(1);
      }
    } else {
      // piped in: username on line 1, password on line 2
      const lines = (await readAllStdin()).split(/\r?\n/);
      username = (lines[0] || "").trim();
      password = (lines[1] || "").trim();
      if (lines[2] !== undefined && lines[2].trim() && lines[2].trim() !== password) {
        console.error("Those did not match. Nothing was changed.");
        process.exit(1);
      }
    }
  }

  if (!username) {
    console.error("Username cannot be empty. Nothing was changed.");
    process.exit(1);
  }
  if (!password || password.length < 8) {
    console.error("Use a password of at least 8 characters. Nothing was changed.");
    process.exit(1);
  }
  saveLogin(username, password);
  console.log('Saved. Sign in at /admin as "' + username + '".\n');
  process.exit(0);
}

if (process.argv.includes("--set-login")) {
  setLoginInteractive();
} else {
  // Managed hosts (Hostinger, Render, a VPS panel) often give no shell, so the
  // login can also be set from environment variables in the host's dashboard.
  if (process.env.ADMIN_USER && process.env.ADMIN_PASSWORD) {
    if (!checkLogin(process.env.ADMIN_USER, process.env.ADMIN_PASSWORD)) {
      saveLogin(process.env.ADMIN_USER, process.env.ADMIN_PASSWORD);
      console.log('Admin login set from environment: "' + process.env.ADMIN_USER + '"');
    }
  }

  // No account yet? Create one with a strong random password and show it once,
  // so the admin is never reachable without credentials.
  if (!readAuth()) {
    const password = crypto.randomBytes(9).toString("base64url");
    saveLogin("owner", password);
    console.log("\n" + "=".repeat(54));
    console.log("  ADMIN LOGIN CREATED — copy this now, it is shown once");
    console.log("=".repeat(54));
    console.log("  Username: owner");
    console.log("  Password: " + password);
    console.log("=".repeat(54));
    console.log("  Change it any time:  node server.js --set-login\n");
  }

  server.listen(PORT, () => {
    console.log("Phenomenal store running → http://localhost:" + PORT);
    console.log("Admin dashboard        → http://localhost:" + PORT + "/admin");
  });
}
