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
 * Orders are persisted to orders.json in the data directory, which should sit
 * outside the deployed app directory — see PHENOMENAL_DATA_DIR below.
 * Run: node server.js   (PORT env var optional, defaults to 3000)
 */
"use strict";

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");

const ROOT = __dirname;

/* ---------------------------------------------------------------------------
 * Where the writable data lives
 *
 * orders.json and auth.json are the only files here that cannot be recreated:
 * they are every real sale and the owner's login, and both are gitignored, so
 * they exist on the server and nowhere else. A host that replaces the app
 * directory on deploy — which many do, by checking the repo out fresh — would
 * erase them on the next push, silently.
 *
 * So the writable data lives wherever PHENOMENAL_DATA_DIR points, which should
 * be a path OUTSIDE the deployed app directory (e.g. /home/<user>/phenomenal-data).
 * Unset, it falls back to ./data, which is fine locally and is the risky spot
 * in production — the boot log says so out loud.
 *
 * products.json is shipped in the repo and is read from the app directory as
 * before; it is content, not state, and a deploy is supposed to replace it.
 * ------------------------------------------------------------------------- */
const APP_DATA_DIR = path.join(ROOT, "data");
const DATA_DIR = cleanEnv(process.env.PHENOMENAL_DATA_DIR) || APP_DATA_DIR;
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const PRODUCTS_FILE = path.join(APP_DATA_DIR, "products.json");
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

/* ---------------------------------------------------------------------------
 * Meta Conversions API
 *
 * The browser fires InitiateCheckout when someone opens WhatsApp. That is an
 * intent, not a sale — this shop is cash on delivery, so the money only exists
 * once the order is confirmed. Purchase is therefore sent from here, server to
 * server, the moment an order reaches META_PURCHASE_ON.
 *
 * Set up with two env vars in the host's dashboard:
 *   META_CAPI_TOKEN       required — Events Manager → Settings → Generate access token
 *   META_TEST_EVENT_CODE  optional — while testing, so events land in Test Events
 *
 * META_PURCHASE_ON picks the moment Meta learns to optimise for. "confirmed"
 * (the default) reports within minutes, which keeps ad delivery learning fast.
 * "delivered" is truer to money actually collected but can lag by days.
 * ------------------------------------------------------------------------- */
// cleanEnv strips the quotes and stray spaces a hosting panel's web form
// tends to bake into a pasted value — a token with a trailing space fails
// against Meta with an unhelpful error.
const META_PIXEL_ID = cleanEnv(process.env.META_PIXEL_ID) || "927494272063012";
const META_CAPI_TOKEN = cleanEnv(process.env.META_CAPI_TOKEN);
const META_TEST_EVENT_CODE = cleanEnv(process.env.META_TEST_EVENT_CODE);
const META_PURCHASE_ON = (cleanEnv(process.env.META_PURCHASE_ON) || "confirmed").toLowerCase();
const META_API_VERSION = "v21.0";
const META_TIMEOUT_MS = 6000;

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

// Meta expects every identifier normalised before hashing, or it will not match.
function normaliseEmail(raw) {
  return String(raw || "").trim().toLowerCase();
}

// Local Pakistani numbers ("0300 1234567") have to reach Meta as E.164 digits
// without the plus: 923001234567.
function normalisePhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("92")) return d;
  if (d.startsWith("0")) return "92" + d.slice(1);
  if (d.length === 10) return "92" + d;
  return d;
}

function buildMetaPurchase(order) {
  const user = {};
  const email = normaliseEmail(order.email);
  if (email) user.em = [sha256(email)];
  const phone = normalisePhone(order.phone);
  if (phone) user.ph = [sha256(phone)];
  if (order.name) {
    const parts = String(order.name).trim().toLowerCase().split(/\s+/);
    if (parts[0]) user.fn = [sha256(parts[0])];
    if (parts.length > 1) user.ln = [sha256(parts.slice(1).join(" "))];
  }
  user.country = [sha256("pk")];
  // Unhashed by design — these are Meta's own identifiers and carry most of
  // the match quality for an ad-driven order.
  if (order.fbp) user.fbp = order.fbp;
  if (order.fbc) user.fbc = order.fbc;
  if (order.client_ip) user.client_ip_address = order.client_ip;
  if (order.client_ua) user.client_user_agent = order.client_ua;

  // Meta rejects events older than seven days, so an order confirmed late
  // still reports, just stamped at the edge of the window.
  const placed = Date.parse(order.created_at);
  const now = Date.now();
  const floor = now - 6 * 24 * 60 * 60 * 1000;
  const when = Number.isFinite(placed) ? Math.min(Math.max(placed, floor), now) : now;

  return {
    event_name: "Purchase",
    event_time: Math.floor(when / 1000),
    event_id: order.id, // same id every retry, so Meta de-duplicates
    action_source: "website",
    event_source_url: order.event_source_url || "https://phenomenal.pk/",
    user_data: user,
    custom_data: {
      currency: "PKR",
      value: order.total,
      content_name: order.product,
      content_type: "product",
      content_ids: ["shot-of-whiskey-tee"],
      num_items: order.qty,
      order_id: order.id,
    },
  };
}

function postToMeta(payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: "graph.facebook.com",
        path: "/" + META_API_VERSION + "/" + META_PIXEL_ID + "/events",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        timeout: META_TIMEOUT_MS,
      },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode, body: text.slice(0, 500) }));
      }
    );
    req.on("timeout", () => { req.destroy(new Error("timed out after " + META_TIMEOUT_MS + "ms")); });
    req.on("error", (err) => resolve({ status: 0, error: err.message }));
    req.end(body);
  });
}

/**
 * Sends Purchase once per order. Mutates order.capi with the outcome so the
 * result is visible in the order log; the caller persists it.
 */
async function sendMetaPurchase(order) {
  if (order.capi && order.capi.purchase_sent_at) return order.capi;
  if (!META_CAPI_TOKEN) {
    order.capi = { skipped: "META_CAPI_TOKEN is not set", attempted_at: new Date().toISOString() };
    return order.capi;
  }
  const payload = { data: [buildMetaPurchase(order)], access_token: META_CAPI_TOKEN };
  if (META_TEST_EVENT_CODE) payload.test_event_code = META_TEST_EVENT_CODE;

  const result = await postToMeta(payload);
  if (result.status >= 200 && result.status < 300) {
    order.capi = { purchase_sent_at: new Date().toISOString(), response: result.body };
    console.log("Meta Purchase sent for " + order.id + " (Rs " + order.total + ")");
  } else {
    order.capi = {
      attempted_at: new Date().toISOString(),
      error: result.error || "HTTP " + result.status,
      response: result.body || null,
    };
    console.error("Meta Purchase failed for " + order.id + ": " + JSON.stringify(order.capi));
  }
  return order.capi;
}

// A second copy of the order log, rewritten alongside the first. It costs a
// few kilobytes and covers the case the atomic rename cannot: the live file
// being lost or truncated by something outside this process.
function backupOrders(orders) {
  try {
    const bak = ORDERS_FILE + ".bak";
    fs.writeFileSync(bak + ".tmp", JSON.stringify(orders, null, 2));
    fs.renameSync(bak + ".tmp", bak);
  } catch (err) {
    console.error("Order backup failed: " + err.message);
  }
}

// Moving to an external data directory must not strand the orders and login
// already sitting in ./data. Copied, never moved: if the new path turns out to
// be wrong, the originals are still where they were.
function migrateDataDir() {
  if (DATA_DIR === APP_DATA_DIR) return;
  for (const name of ["orders.json", "auth.json"]) {
    const from = path.join(APP_DATA_DIR, name);
    const to = path.join(DATA_DIR, name);
    try {
      if (!fs.existsSync(from) || fs.existsSync(to)) continue;
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.copyFileSync(from, to);
      console.log("Copied " + name + " into the data directory: " + to);
    } catch (err) {
      console.error("Could not copy " + name + " to " + DATA_DIR + ": " + err.message);
    }
  }
}

// The whole point of the split is invisible unless the log says where the data
// ended up and how much of it is there. A deploy that wipes the app directory
// shows up here as an order count that dropped to zero.
function reportDataDir() {
  const orders = readOrders();
  console.log("Data directory: " + DATA_DIR + " (" + orders.length + " orders on file)");
  if (DATA_DIR === APP_DATA_DIR) {
    console.log(
      "  WARNING: that is inside the app directory. If this host replaces the app\n" +
      "  directory on deploy, the next push erases every order and the admin login.\n" +
      "  Set PHENOMENAL_DATA_DIR to a path outside it and restart."
    );
  }
}

function readOrders() {
  try {
    return JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error("Order log unreadable (" + err.message + ") — trying the backup");
    }
    try {
      const orders = JSON.parse(fs.readFileSync(ORDERS_FILE + ".bak", "utf8"));
      console.error("Recovered " + orders.length + " orders from the backup copy");
      return orders;
    } catch (err2) {
      return [];
    }
  }
}

function writeOrders(orders) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  backupOrders(orders);
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

// Values pasted into a hosting panel often arrive wrapped in quotes or padded
// with a stray space; both would silently become part of the credential.
function cleanEnv(value) {
  let v = String(value == null ? "" : value).trim();
  if (v.length > 1 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
    v = v.slice(1, -1).trim();
  }
  return v;
}
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

/* Static files, with byte ranges.
 *
 * iOS Safari will not play a <video> from a server that answers a Range
 * request with the whole file: it asks for bytes, expects 206, and gives up
 * on a plain 200. Streaming the range also means a 5 MB hero is no longer
 * read into memory in full on every single request.
 */
function serveStatic(req, res, urlPath) {
  let rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  if (rel === "admin") rel = "admin.html";
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT) || rel.startsWith("data") || rel === "server.js") {
    json(res, 404, { error: "not found" });
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      json(res, 404, { error: "not found" });
      return;
    }
    const type = MIME[path.extname(file)] || "application/octet-stream";
    const head = { "Content-Type": type, "Accept-Ranges": "bytes" };
    const range = req.headers.range;
    const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());

    if (m && (m[1] || m[2])) {
      let start, end;
      if (m[1]) {
        start = parseInt(m[1], 10);
        end = m[2] ? parseInt(m[2], 10) : st.size - 1;
      } else {
        // "bytes=-500" means the last 500 bytes
        start = Math.max(0, st.size - parseInt(m[2], 10));
        end = st.size - 1;
      }
      if (!(start <= end && start < st.size)) {
        res.writeHead(416, { "Content-Range": "bytes */" + st.size });
        res.end();
        return;
      }
      end = Math.min(end, st.size - 1);
      head["Content-Range"] = "bytes " + start + "-" + end + "/" + st.size;
      head["Content-Length"] = end - start + 1;
      res.writeHead(206, head);
      if (req.method === "HEAD") return res.end();
      fs.createReadStream(file, { start: start, end: end }).pipe(res);
      return;
    }

    head["Content-Length"] = st.size;
    res.writeHead(200, head);
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
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
        // Kept for the Conversions API Purchase sent when this order is
        // confirmed — without them Meta cannot tie the sale to the ad click.
        fbp: body.fbp ? String(body.fbp).slice(0, 120) : null,
        fbc: body.fbc ? String(body.fbc).slice(0, 255) : null,
        event_source_url: body.event_source_url ? String(body.event_source_url).slice(0, 500) : null,
        client_ip: String(clientKey(req)).split(",")[0].trim(),
        client_ua: req.headers["user-agent"] ? String(req.headers["user-agent"]).slice(0, 500) : null,
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
      const wasStatus = order.status;
      order.status = body.status;
      order.updated_at = new Date().toISOString();
      // Only on the transition into the trigger status, and only once ever.
      if (order.status === META_PURCHASE_ON && wasStatus !== META_PURCHASE_ON) {
        await sendMetaPurchase(order);
      }
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

    if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res, p);
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
  migrateDataDir();
  reportDataDir();

  // Managed hosts (Hostinger, Render, a VPS panel) often give no shell, so the
  // login can also be set from environment variables in the host's dashboard.
  // Those are pasted into a web form, so surrounding quotes and stray spaces
  // are common and would otherwise become part of the credential itself.
  const envUser = cleanEnv(process.env.ADMIN_USER);
  const envPass = cleanEnv(process.env.ADMIN_PASSWORD);
  if (envUser && envPass) {
    if (checkLogin(envUser, envPass)) {
      console.log('Admin login already matches ADMIN_USER: "' + envUser + '"');
    } else {
      saveLogin(envUser, envPass);
      console.log('Admin login set from environment: "' + envUser + '"');
    }
  } else if (process.env.ADMIN_USER || process.env.ADMIN_PASSWORD) {
    console.log("ADMIN_USER and ADMIN_PASSWORD must BOTH be set — ignoring the one that is.");
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

  // Say plainly which account is live, so a shell-less host can be diagnosed
  // from the runtime log alone. Never prints the password.
  const live = readAuth();
  if (live) console.log('Admin sign-in username: "' + live.username + '"');

  // Say whether Purchase reporting is armed, without ever printing the token.
  if (!META_CAPI_TOKEN) {
    console.log("Meta Purchase: OFF — META_CAPI_TOKEN is not set, confirmed orders will not report.");
  } else {
    console.log(
      "Meta Purchase: ON — pixel " + META_PIXEL_ID + ", sends on status \"" + META_PURCHASE_ON + '"' +
      (META_TEST_EVENT_CODE
        ? ", TEST MODE (" + META_TEST_EVENT_CODE + ") — events go to Test Events only, not live reporting"
        : ", live reporting")
    );
  }

  server.listen(PORT, () => {
    console.log("Phenomenal store running → http://localhost:" + PORT);
    console.log("Admin dashboard        → http://localhost:" + PORT + "/admin");
  });
}
