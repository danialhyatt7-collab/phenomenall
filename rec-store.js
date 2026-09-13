/*
 * Session-replay storage. Each recording is an event stream produced by rrweb
 * on the storefront (DOM changes, clicks, scroll, masked input). We keep them
 * as flat files under the data directory and cap how many we hold, so a busy
 * ad day cannot fill the disk.
 *
 * Per session:
 *   <sid>.json   — metadata (times, device, page count, whether it converted)
 *   <sid>.ndjson — one line per flushed chunk, each a JSON array of events
 *
 * Nothing here reaches out anywhere; the browser posts to our own origin and
 * the recorder masks every form field, so no typed customer detail is stored.
 */
const fs = require("fs");
const path = require("path");

let REC_DIR = null;
const MAX_SESSIONS = 150; // newest kept; oldest evicted past this
const MAX_BYTES_PER = 4 * 1024 * 1024; // a single session cannot exceed this
const MAX_EVENTS_PER = 20000;

function init(dataDir) {
  REC_DIR = path.join(dataDir, "recordings");
  try { fs.mkdirSync(REC_DIR, { recursive: true }); } catch (e) {}
}
function okSid(sid) { return typeof sid === "string" && /^[a-z0-9]{6,40}$/i.test(sid); }
function metaPath(sid) { return path.join(REC_DIR, sid + ".json"); }
function dataPath(sid) { return path.join(REC_DIR, sid + ".ndjson"); }

function readMeta(sid) {
  try { return JSON.parse(fs.readFileSync(metaPath(sid), "utf8")); } catch (e) { return null; }
}
function writeMeta(sid, meta) {
  try { fs.writeFileSync(metaPath(sid), JSON.stringify(meta)); } catch (e) {}
}

// Keep at most MAX_SESSIONS, dropping the oldest by start time.
function evict() {
  let files;
  try { files = fs.readdirSync(REC_DIR); } catch (e) { return; }
  const metas = files.filter((f) => f.endsWith(".json"))
    .map((f) => readMeta(f.slice(0, -5))).filter(Boolean)
    .sort((a, b) => a.start - b.start);
  let over = metas.length - MAX_SESSIONS;
  for (let i = 0; i < over; i++) remove(metas[i].sid);
}

function appendChunk(sid, events, incomingMeta) {
  if (!okSid(sid) || !Array.isArray(events) || !events.length) return { ok: false };
  let meta = readMeta(sid);
  const fresh = !meta;
  const now = Date.now();
  if (fresh) {
    meta = {
      sid: sid,
      start: now,
      last: now,
      ua: str(incomingMeta && incomingMeta.ua, 300),
      vw: int(incomingMeta && incomingMeta.vw),
      vh: int(incomingMeta && incomingMeta.vh),
      referrer: str(incomingMeta && incomingMeta.referrer, 300),
      url: str(incomingMeta && incomingMeta.url, 300),
      engaged: str(incomingMeta && incomingMeta.engaged, 40),
      events: 0,
      bytes: 0,
      pages: 0,
      ordered: false,
    };
  }
  if (meta.bytes >= MAX_BYTES_PER || meta.events >= MAX_EVENTS_PER) {
    meta.last = now; writeMeta(sid, meta); return { ok: true, full: true };
  }
  const line = JSON.stringify(events);
  try { fs.appendFileSync(dataPath(sid), line + "\n"); } catch (e) { return { ok: false }; }
  meta.last = now;
  meta.events += events.length;
  meta.bytes += Buffer.byteLength(line) + 1;
  // rrweb type 2 is a full snapshot — a good proxy for a page/navigation.
  for (const e of events) if (e && e.type === 2) meta.pages++;
  writeMeta(sid, meta);
  if (fresh) evict();
  return { ok: true };
}

function markOrdered(sid) {
  if (!okSid(sid)) return;
  const meta = readMeta(sid);
  if (meta && !meta.ordered) { meta.ordered = true; writeMeta(sid, meta); }
}

function list() {
  let files;
  try { files = fs.readdirSync(REC_DIR); } catch (e) { return []; }
  return files.filter((f) => f.endsWith(".json"))
    .map((f) => readMeta(f.slice(0, -5))).filter(Boolean)
    .map((m) => ({ ...m, duration: Math.max(0, m.last - m.start) }))
    .sort((a, b) => b.start - a.start);
}

function read(sid) {
  if (!okSid(sid)) return null;
  const meta = readMeta(sid);
  if (!meta) return null;
  let raw;
  try { raw = fs.readFileSync(dataPath(sid), "utf8"); } catch (e) { return null; }
  const events = [];
  for (const ln of raw.split("\n")) {
    if (!ln) continue;
    try { const arr = JSON.parse(ln); if (Array.isArray(arr)) for (const e of arr) events.push(e); } catch (e) {}
  }
  return { meta: meta, events: events };
}

function remove(sid) {
  if (!okSid(sid)) return false;
  try { fs.unlinkSync(metaPath(sid)); } catch (e) {}
  try { fs.unlinkSync(dataPath(sid)); } catch (e) {}
  return true;
}

function str(v, n) { return v == null ? null : String(v).slice(0, n); }
function int(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }

module.exports = { init, appendChunk, markOrdered, list, read, remove };
