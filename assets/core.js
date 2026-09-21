// K1 TERMINAL — shared runtime. Auth gate, supabase client, records IO,
// realtime helpers, formatters, canvas charting. Vanilla ESM only.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const CDN_OK = typeof createClient === "function";

/* ------------------------------------------------------------------ client */
// One GoTrueClient per browser context: repeated createClient() calls spawn
// parallel auth managers fighting over the same storage key (and supabase-js
// warns about it). Cache the first instance and hand it to every caller.
let _sbSingleton = null;
export function createSb() {
  if (_sbSingleton) return _sbSingleton;
  const env = window.K1_ENV || {};
  _sbSingleton = createClient(env.SUPABASE_URL || "", env.SUPABASE_KEY || "");
  return _sbSingleton;
}

/* ------------------------------------------------------- edge functions */
// Calls the Supabase Edge Functions in K1_ENV.API_BASE with the current
// session token attached (functions validate it themselves). Falls back to
// same-origin /api/<path> when API_BASE is empty.
export async function apiFetch(path, opts = {}) {
  const env = window.K1_ENV || {};
  const base = (env.API_BASE || "").replace(/\/+$/, "");
  const rel = String(path).replace(/^\/+/, "");
  const url = /^https?:/i.test(path)
    ? path
    : base ? `${base}/${rel}` : `/api/${rel}`;
  const headers = { ...(opts.headers || {}) };
  if (base && url.startsWith(base)) {
    try {
      const { data } = await createSb().auth.getSession();
      const tok = data && data.session && data.session.access_token;
      if (tok) {
        headers.Authorization = `Bearer ${tok}`;
        headers.apikey = env.SUPABASE_KEY || "";
      }
    } catch { /* token optional upstream */ }
  }
  return fetch(url, { ...opts, headers });
}

export function maskedHost() {
  try {
    const h = new URL(window.K1_ENV.SUPABASE_URL).host;
    const [first, ...rest] = h.split(".");
    const m = first.length > 6 ? first.slice(0, 3) + "•••" + first.slice(-2) : "•••";
    return [m, ...rest].join(".");
  } catch { return "unconfigured"; }
}

/* ------------------------------------------------------------------ format */
function _num(v) {
  if (v === null || v === undefined || v === "") return NaN;
  return Number(v);
}

export function fmtNum(v, d = 2) {
  v = _num(v);
  if (!isFinite(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fmtPx(v) {
  v = _num(v);
  if (!isFinite(v)) return "—";
  const a = Math.abs(v);
  const d = a >= 1000 ? 2 : a >= 100 ? 2 : a >= 1 ? 3 : a >= 0.1 ? 4 : a >= 0.001 ? 6 : 8;
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fmtPct(v, d = 1) {
  v = _num(v);
  if (!isFinite(v)) return "—";
  const s = (v * 100).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  return (v > 0 ? "+" : "") + s + "%";
}

export function fmtSigned(v, d = 2) {
  v = _num(v);
  if (!isFinite(v)) return "—";
  return (v > 0 ? "+" : "") + fmtNum(v, d);
}

export function toDate(x) {
  if (x == null) return null;
  if (x instanceof Date) return x;
  if (typeof x === "number" || /^\d+$/.test(String(x).trim())) {
    const n = Number(x);
    if (n > 1e14) return new Date(n / 1000);          // microseconds
    if (n > 1e11) return new Date(n);                 // milliseconds
    return new Date(n * 1000);                        // seconds
  }
  const d = new Date(x);
  return isNaN(d) ? null : d;
}

export function usToDate(us) { return new Date(Number(us) / 1000); }

export function fmtUtc(x) {
  const d = toDate(x);
  if (!d) return "—";
  const p = n => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
         `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

export function fmtClock(x) {
  const d = toDate(x);
  if (!d) return "—";
  const p = n => String(n).padStart(2, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

export function timeAgo(ts) {
  const d = toDate(ts);
  if (!d) return "—";
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function shortId(id, n = 10) {
  const s = String(id ?? "");
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/* ------------------------------------------------------------------ dom */
export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

export function dirColor(dir) {
  const d = String(dir || "").toUpperCase();
  if (d === "LONG" || d === "BUY") return "var(--up)";
  if (d === "SHORT" || d === "SELL") return "var(--down)";
  return "var(--muted)";
}

export function dirClass(dir) {
  const d = String(dir || "").toUpperCase();
  if (d === "LONG" || d === "BUY") return "up";
  if (d === "SHORT" || d === "SELL") return "down";
  return "";
}

const BADGE_MAP = {
  LONG: "up", BUY: "up", OPEN: "up", OK: "up", APPROVED: "up", CONFIRMED: "up",
  CORROBORATED: "up", FILLED: "up", COMPLETED: "up", VALIDATED: "up", LIVE: "up",
  SHORT: "down", SELL: "down", DOWN: "down", REJECTED: "down", CLOSED: "down",
  DEAD_LETTER: "down", DEAD: "down", DISPUTED: "down", BLOCKED: "down",
  NO_TRADE: "amb", PENDING: "amb", QUEUED: "amb", LEASED: "amb", UNVERIFIED: "amb",
  EXPLORATORY: "amb", INSUFFICIENT_EVIDENCE: "amb", ABSTAIN: "amb", NEUTRAL: "amb",
};

export function badge(text) {
  const t = String(text ?? "—").toUpperCase();
  const b = el("span", "badge", t);
  if (BADGE_MAP[t]) b.classList.add(BADGE_MAP[t]);
  return b;
}

export function emptyRow(msg = "NO DATA — awaiting workers") {
  return el("div", "empty", msg);
}

/* -------------------------------------------------------------- conn state */
const _conn = new Map();
function _connUpdate() {
  let state = "down";
  for (const s of _conn.values()) {
    if (s === "SUBSCRIBED") { state = "live"; break; }
    if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") continue;
    state = "conn";
  }
  for (const d of document.querySelectorAll(".conn-dot")) {
    d.classList.remove("live", "conn", "down");
    d.classList.add(state === "live" ? "live" : state === "conn" ? "conn" : "down");
  }
  for (const l of document.querySelectorAll(".conn-label")) {
    l.textContent = state === "live" ? "LIVE" : state === "conn" ? "CONN" : "DOWN";
  }
}
function _trackConn(ch, status) {
  // a real channel report supersedes the init "manual" placeholder so the
  // indicator can reach DOWN when every channel dies (e.g. network offline)
  _conn.delete("manual");
  _conn.set(ch, status);
  _connUpdate();
}
export function setConnState(state) {
  _conn.set("manual", state === "live" ? "SUBSCRIBED" : state === "conn" ? "JOINING" : "CLOSED");
  _connUpdate();
}

/* ------------------------------------------------------------------ auth */
function _startClock() {
  const tick = () => {
    const t = fmtUtc(new Date()) + " UTC";
    for (const c of document.querySelectorAll("#utc-clock, .utc-clock")) c.textContent = t;
  };
  tick();
  setInterval(tick, 1000);
}

function _showUser(session) {
  const u = document.querySelectorAll("#user-email, .user-email");
  const email = session && session.user ? session.user.email || "" : "";
  for (const n of u) n.textContent = email;
}

function _loginOverlay(sb) {
  return new Promise((resolve) => {
    const ov = el("div", "login-overlay");
    ov.innerHTML = `
      <div class="login-box">
        <div class="panel-h"><span class="panel-t">TERMINAL ACCESS</span></div>
        <div class="login-body">
          <div class="micro" style="color:var(--amber)">AUTHENTICATION REQUIRED</div>
          <div><label for="k1-li-email">EMAIL</label><input id="k1-li-email" class="inp" type="email" autocomplete="username" placeholder="operator@k1"></div>
          <div><label for="k1-li-pass">PASSWORD</label><input id="k1-li-pass" class="inp" type="password" autocomplete="current-password" placeholder="••••••••"></div>
          <div class="login-err" id="k1-li-err"></div>
          <div class="login-ok" id="k1-li-ok"></div>
          <div class="login-actions">
            <button class="btn primary" id="k1-li-go">▸ AUTHENTICATE</button>
            <button class="btn" id="k1-li-reg">FIRST-TIME REGISTRATION</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const email = ov.querySelector("#k1-li-email");
    const pass = ov.querySelector("#k1-li-pass");
    const err = ov.querySelector("#k1-li-err");
    const ok = ov.querySelector("#k1-li-ok");
    const go = ov.querySelector("#k1-li-go");
    const reg = ov.querySelector("#k1-li-reg");
    const fail = m => { err.textContent = m || "AUTH FAILED"; ok.textContent = ""; };
    const done = session => { ov.remove(); resolve(session); };
    const busy = on => {
      go.disabled = reg.disabled = on;
      go.textContent = on ? "… CHECKING" : "▸ AUTHENTICATE";
    };
    const humanize = m => {
      const s = String(m || "");
      if (/invalid login credentials/i.test(s))
        return "EMAIL OR PASSWORD INCORRECT — check credentials, or use FIRST-TIME REGISTRATION";
      if (/missing email|email.*required|phone/i.test(s) && /missing|required/i.test(s))
        return "EMAIL REQUIRED — type your email address";
      if (/unable to validate email|invalid.*email/i.test(s))
        return "EMAIL ADDRESS NOT VALID — check for typos";
      if (/password.*(at least|characters|short|weak)/i.test(s))
        return "PASSWORD TOO SHORT — use at least 6 characters";
      if (/already.*(registered|been registered|in use)/i.test(s))
        return "EMAIL ALREADY REGISTERED — sign in instead";
      if (/failed to fetch|network|fetch/i.test(s))
        return "NETWORK ERROR — check your connection and retry";
      return s;
    };
    const checkFields = () => {
      if (!email.value.trim() || !pass.value) return "ENTER EMAIL AND PASSWORD";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()))
        return "EMAIL ADDRESS NOT VALID — check for typos";
      return null;
    };
    const submit = async () => {
      err.textContent = ""; ok.textContent = "";
      const pre = checkFields();
      if (pre) return fail(pre);
      busy(true);
      try {
        const { data, error } = await sb.auth.signInWithPassword({
          email: email.value.trim(), password: pass.value,
        });
        if (error) return fail(humanize(error.message));
        done(data.session);
      } finally { busy(false); }
    };
    go.addEventListener("click", submit);
    reg.addEventListener("click", async () => {
      err.textContent = ""; ok.textContent = "";
      const pre = checkFields();
      if (pre) return fail(pre);
      busy(true);
      try {
        const { data, error } = await sb.auth.signUp({
          email: email.value.trim(), password: pass.value,
        });
        if (error) return fail(humanize(error.message));
        if (data.session) return done(data.session);
        ok.textContent = "REGISTERED — CONFIRM EMAIL THEN SIGN IN";
      } finally { busy(false); }
    });
    ov.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
    setTimeout(() => email.focus(), 30);
  });
}

export async function initTerminal({ title, onAuth } = {}) {
  if (title) document.title = `K1 ▸ ${title}`;
  _startClock();
  let sb;
  try {
    sb = createSb();
  } catch (e) {
    _fatalConfig(e);
    throw e;
  }
  const so = document.getElementById("signout");
  if (so) so.addEventListener("click", async () => { try { await sb.auth.signOut(); } finally { location.reload(); } });
  setConnState("conn");
  let session = null;
  try { session = (await sb.auth.getSession()).data.session; } catch { /* no session */ }
  if (!session) session = await _loginOverlay(sb);
  _showUser(session);
  sb.auth.onAuthStateChange((_e, s) => { _showUser(s); if (!s) location.reload(); });
  if (onAuth) await onAuth(sb);
  // announce "authenticated + first render done" for the guided tour (tour.js)
  window.__k1Authed = true;
  window.__k1Sb = sb;
  window.dispatchEvent(new CustomEvent("k1:authed", { detail: { sb } }));
  return sb;
}

function _fatalConfig(e) {
  const ov = el("div", "login-overlay");
  ov.innerHTML = `
    <div class="login-box">
      <div class="panel-h"><span class="panel-t">TERMINAL ACCESS</span></div>
      <div class="login-body">
        <div class="micro" style="color:var(--down)">CONFIGURATION ERROR</div>
        <div class="micro" style="text-transform:none;line-height:1.6">
          Supabase client could not be created. Set real values in
          <b style="color:var(--amber)">/config.js</b> (SUPABASE_URL / SUPABASE_KEY).
        </div>
        <div class="login-err">${String(e && e.message || e)}</div>
      </div>
    </div>`;
  document.body.appendChild(ov);
}

/* ------------------------------------------------------------------ data IO */
export function parseRecordRow(row) {
  try {
    const p = JSON.parse(row.payload);
    if (p && typeof p === "object") {
      p._kind = row.kind;
      p._id = row.id;
      p._event_us = Number(row.event_us);
      p._available_us = Number(row.available_us);
      return p;
    }
  } catch { /* malformed payload */ }
  return null;
}

export async function loadRecords(sb, kind, { limit = 100 } = {}) {
  const { data, error } = await sb.from("k1_records")
    .select("kind,id,payload,event_us,available_us")
    .eq("kind", kind)
    .order("available_us", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  const out = [];
  for (const row of data) { const p = parseRecordRow(row); if (p) out.push(p); }
  return out; // newest-first by available_us
}

export function subscribeChanges(sb, table, event, cb) {
  const ch = sb.channel(`k1-${table}-${event}-${Math.random().toString(36).slice(2, 8)}`)
    .on("postgres_changes", { event, schema: "public", table }, p => { try { cb(p); } catch (e) { console.error(e); } })
    .subscribe(status => _trackConn(ch, status));
  return ch;
}

export function subscribeInserts(sb, table, cb) {
  return subscribeChanges(sb, table, "INSERT", cb);
}

export async function recordCounts(sb) {
  try {
    const { data, error } = await sb.from("k1_record_counts").select("*");
    if (error) return [];
    return data || [];
  } catch { return []; }
}

export async function queueStats(sb) {
  try {
    const { data, error } = await sb.from("k1_queue_stats").select("*");
    if (error) return [];
    return data || [];
  } catch { return []; }
}

export async function dbPing(sb) {
  const t0 = performance.now();
  try {
    await sb.from("k1_records").select("id", { count: "exact", head: true }).limit(1);
    return Math.round(performance.now() - t0);
  } catch { return -1; }
}

/* ------------------------------------------------------------------ charts */
const _RO = typeof ResizeObserver !== "undefined"
  ? new ResizeObserver(entries => {
      for (const e of entries) {
        const c = e.target;
        if (c.__k1redraw) requestAnimationFrame(c.__k1redraw);
      }
    })
  : null;

function _fit(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return null;
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function _watch(canvas, redraw) {
  canvas.__k1redraw = redraw;
  if (_RO) { _RO.observe(canvas); }
}

const C_UP = "#00c864", C_DOWN = "#ff4d4d", C_GRID = "#1a2127", C_AXIS = "#7a8580",
      C_AMBER = "#ffb000", C_CYAN = "#3ec6e0";

/* bars: {t:[],o:[],h:[],l:[],c:[],v:[]} oldest→newest; t in s/ms/us/ISO. */
export function drawCandles(canvas, bars, { maxBars = 120 } = {}) {
  const draw = () => {
    const f = _fit(canvas);
    if (!f) return;
    const { ctx, w, h } = f;
    if (!bars || !bars.c || !bars.c.length) {
      ctx.fillStyle = "#4a5450"; ctx.font = "9px ui-monospace, monospace";
      ctx.textAlign = "center"; ctx.fillText("NO DATA", w / 2, h / 2);
      return;
    }
    const n0 = bars.c.length, start = Math.max(0, n0 - maxBars), n = n0 - start;
    const o = bars.o.slice(start), hi = bars.h.slice(start), lo = bars.l.slice(start),
          c = bars.c.slice(start), v = (bars.v || []).slice(start), t = (bars.t || []).slice(start);
    const axR = 56, axB = 14, volH = Math.floor((h - axB) * 0.18), gap = 4;
    const plotW = w - axR, priceH = h - axB - volH - gap;
    let mn = Infinity, mx = -Infinity, vmx = 0;
    for (let i = 0; i < n; i++) {
      if (lo[i] < mn) mn = lo[i];
      if (hi[i] > mx) mx = hi[i];
      if (v[i] > vmx) vmx = v[i];
    }
    if (!isFinite(mn) || !isFinite(mx) || mn === mx) { mn = (c[n - 1] || 1) * 0.99; mx = (c[n - 1] || 1) * 1.01; }
    const pad = (mx - mn) * 0.06; mn -= pad; mx += pad;
    const y = p => (mx - p) / (mx - mn) * priceH;
    const bw = plotW / n, body = Math.max(1, Math.floor(bw * 0.7));
    // grid + price axis
    ctx.strokeStyle = C_GRID; ctx.fillStyle = C_AXIS; ctx.font = "9px ui-monospace, monospace";
    ctx.textAlign = "left"; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const p = mx - (mx - mn) * i / 4, yy = Math.round(y(p)) + .5;
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke();
      ctx.fillText(fmtPx(p), plotW + 4, yy + 3);
    }
    // time axis
    ctx.textAlign = "center";
    const step = Math.max(1, Math.floor(n / 4));
    for (let i = 0; i < n; i += step) {
      const d = toDate(t[i]);
      if (!d) continue;
      const lbl = `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
      ctx.fillText(lbl, i * bw + bw / 2, h - 3);
    }
    // volume
    const vy = h - axB;
    for (let i = 0; i < n; i++) {
      const up = c[i] >= o[i];
      ctx.fillStyle = up ? "rgba(0,200,100,.35)" : "rgba(255,77,77,.35)";
      const vh = vmx ? (v[i] / vmx) * volH : 0;
      ctx.fillRect(i * bw + (bw - body) / 2, vy - vh, body, vh);
    }
    // candles
    for (let i = 0; i < n; i++) {
      const up = c[i] >= o[i], col = up ? C_UP : C_DOWN;
      const x = i * bw + bw / 2;
      ctx.strokeStyle = col; ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(x, y(hi[i])); ctx.lineTo(x, y(lo[i])); ctx.stroke();
      const yo = y(o[i]), yc = y(c[i]);
      ctx.fillRect(x - body / 2, Math.min(yo, yc), body, Math.max(1, Math.abs(yc - yo)));
    }
    // last price line
    const last = c[n - 1], lyy = Math.round(y(last)) + .5;
    ctx.strokeStyle = C_AMBER; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, lyy); ctx.lineTo(plotW, lyy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#000"; ctx.fillRect(plotW + 1, lyy - 6, axR - 2, 12);
    ctx.strokeStyle = C_AMBER; ctx.strokeRect(plotW + 1, lyy - 6, axR - 2, 12);
    ctx.fillStyle = C_AMBER; ctx.fillText(fmtPx(last), plotW + 4, lyy + 3);
  };
  canvas.__bars = bars;
  _watch(canvas, draw);
  draw();
}

/* points: number[] or [{x,y}] — equity / PnL curve. */
export function drawLine(canvas, points, { color } = {}) {
  const draw = () => {
    const f = _fit(canvas);
    if (!f) return;
    const { ctx, w, h } = f;
    const ys = (points || []).map(p => typeof p === "number" ? p : p && p.y);
    if (!ys.length) {
      ctx.fillStyle = "#4a5450"; ctx.font = "9px ui-monospace, monospace";
      ctx.textAlign = "center"; ctx.fillText("NO DATA", w / 2, h / 2);
      return;
    }
    const axR = 56, axB = 14, plotW = w - axR, plotH = h - axB;
    let mn = Math.min(...ys, 0), mx = Math.max(...ys, 0);
    if (mn === mx) { mn -= 1; mx += 1; }
    const pad = (mx - mn) * 0.08; mn -= pad; mx += pad;
    const xs = (points || []).map((p, i) => typeof p === "number" ? i : (p.x ?? i));
    const x0 = xs[0], x1 = xs[xs.length - 1], xr = (x1 - x0) || 1;
    const X = x => (x - x0) / xr * (plotW - 4) + 2;
    const Y = v => (mx - v) / (mx - mn) * plotH;
    ctx.strokeStyle = C_GRID; ctx.fillStyle = C_AXIS; ctx.font = "9px ui-monospace, monospace";
    ctx.textAlign = "left"; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const vv = mx - (mx - mn) * i / 4, yy = Math.round(Y(vv)) + .5;
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke();
      ctx.fillText(fmtNum(vv, 1), plotW + 4, yy + 3);
    }
    const zy = Math.round(Y(0)) + .5;
    if (zy > 0 && zy < plotH) {
      ctx.strokeStyle = "#39434b"; ctx.beginPath(); ctx.moveTo(0, zy); ctx.lineTo(plotW, zy); ctx.stroke();
    }
    // x labels if times provided
    if (typeof points[0] === "object") {
      ctx.textAlign = "center"; ctx.fillStyle = C_AXIS;
      for (let i = 0; i <= 3; i++) {
        const idx = Math.min(xs.length - 1, Math.round(i * (xs.length - 1) / 3));
        const d = toDate(xs[idx]);
        if (d) ctx.fillText(`${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`, X(xs[idx]), h - 3);
      }
    }
    const last = ys[ys.length - 1];
    const col = color || (last >= 0 ? C_UP : C_DOWN);
    ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let i = 0; i < ys.length; i++) {
      const x = X(xs[i]), yv = Y(ys[i]);
      if (i === 0) ctx.moveTo(x, yv); else ctx.lineTo(x, yv);
    }
    ctx.stroke();
    // last value chip
    const lyy = Math.max(7, Math.min(h - axB - 7, Y(last)));
    ctx.fillStyle = "#000"; ctx.fillRect(plotW + 1, lyy - 6, axR - 2, 12);
    ctx.strokeStyle = col; ctx.strokeRect(plotW + 1, lyy - 6, axR - 2, 12);
    ctx.fillStyle = col; ctx.textAlign = "left"; ctx.fillText(fmtNum(last, 1), plotW + 4, lyy + 3);
  };
  _watch(canvas, draw);
  draw();
}

/* tiny sparkline, no axes */
export function spark(canvas, values, { color } = {}) {
  const draw = () => {
    const f = _fit(canvas);
    if (!f) return;
    const { ctx, w, h } = f;
    const vs = (values || []).filter(v => isFinite(v));
    if (vs.length < 2) return;
    let mn = Math.min(...vs), mx = Math.max(...vs);
    if (mn === mx) { mn -= 1; mx += 1; }
    const col = color || (vs[vs.length - 1] >= vs[0] ? C_UP : C_DOWN);
    ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i < vs.length; i++) {
      const x = i / (vs.length - 1) * (w - 2) + 1;
      const y = (mx - vs[i]) / (mx - mn) * (h - 4) + 2;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  _watch(canvas, draw);
  draw();
}

if (!CDN_OK) console.error("supabase-js CDN import failed — check network/CSP");
