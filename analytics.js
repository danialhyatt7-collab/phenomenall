/*
 * Historical analytics. The live view only holds the last half hour in memory;
 * this keeps a durable per-day tally so trends can be read week over week.
 *
 * Traffic and the browse funnel (pageviews, unique visitors, viewed / added to
 * cart / reached checkout / contacted) are counted here as events arrive, held
 * in memory and flushed to disk every 30 seconds and on shutdown — so a deploy
 * loses at most a few seconds. Orders and revenue are NOT stored here: they are
 * derived from the durable order log instead, which makes those two series
 * retroactive back to the store's first sale.
 *
 * Days are bucketed in Pakistan local time so a "day" matches the owner's day.
 */
const fs = require("fs");
const path = require("path");

const PK_OFFSET = 5 * 60 * 60 * 1000; // Asia/Karachi, no DST
const VID_CAP = 60000;                // bound the stored same-day visitor set

let DIR = null, FILE = null, VIDS_FILE = null;
let days = {};            // "YYYY-MM-DD" -> { pv, vc, atc, ic, ct, visitors }
let todayKey = null, todaySet = null, dirty = false, timer = null;

function dayKey(ts) { return new Date((ts || Date.now()) + PK_OFFSET).toISOString().slice(0, 10); }
function blank() { return { pv: 0, vc: 0, atc: 0, ic: 0, ct: 0, visitors: 0 }; }
function ensure(k) { if (!days[k]) days[k] = blank(); return days[k]; }

function init(dataDir) {
  DIR = path.join(dataDir, "analytics");
  FILE = path.join(DIR, "daily.json");
  VIDS_FILE = path.join(DIR, "today-vids.json");
  try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) {}
  try { days = JSON.parse(fs.readFileSync(FILE, "utf8")) || {}; } catch (e) { days = {}; }
  todayKey = dayKey();
  todaySet = new Set();
  // Restore today's visitor set so uniques survive a restart on the same day.
  try {
    const t = JSON.parse(fs.readFileSync(VIDS_FILE, "utf8"));
    if (t && t.date === todayKey && Array.isArray(t.vids)) todaySet = new Set(t.vids);
  } catch (e) {}
  ensure(todayKey).visitors = todaySet.size;
  if (!timer) { timer = setInterval(flush, 30000); if (timer.unref) timer.unref(); }
}

const FIELD = { PageView: "pv", ViewContent: "vc", AddToCart: "atc", InitiateCheckout: "ic", Contact: "ct" };

function roll() {
  const k = dayKey();
  if (k === todayKey) return;
  flush();                 // finalise the day that just ended
  todayKey = k;
  todaySet = new Set();
  ensure(todayKey);
  dirty = true;
}

function track(name, vid) {
  const field = FIELD[name];
  if (!field) return;
  roll();
  const b = ensure(todayKey);
  b[field]++;
  if (vid && !todaySet.has(vid)) {
    if (todaySet.size < VID_CAP) todaySet.add(vid);
    b.visitors = todaySet.size;
  }
  dirty = true;
}

function flush() {
  if (!dirty) return;
  try { fs.writeFileSync(FILE, JSON.stringify(days)); } catch (e) {}
  try { fs.writeFileSync(VIDS_FILE, JSON.stringify({ date: todayKey, vids: [...todaySet] })); } catch (e) {}
  dirty = false;
}

// Last `n` days ending today, each row merged with orders/revenue from the log.
function trends(n, orders) {
  n = Math.max(1, Math.min(180, n || 30));
  const byDay = {};
  for (const o of orders || []) {
    if (o.status === "cancelled") continue;
    const k = dayKey(new Date(o.created_at).getTime());
    if (!byDay[k]) byDay[k] = { orders: 0, sales: 0 };
    byDay[k].orders++;
    byDay[k].sales += o.total || 0;
  }
  const out = [];
  const base = Date.now();
  for (let i = n - 1; i >= 0; i--) {
    const k = dayKey(base - i * 24 * 60 * 60 * 1000);
    const t = days[k] || blank();
    const o = byDay[k] || { orders: 0, sales: 0 };
    out.push({
      date: k,
      pageviews: t.pv, visitors: t.visitors,
      view: t.vc, cart: t.atc, checkout: t.ic, contact: t.ct,
      orders: o.orders, sales: o.sales,
    });
  }
  return out;
}

module.exports = { init, track, trends, flush };
