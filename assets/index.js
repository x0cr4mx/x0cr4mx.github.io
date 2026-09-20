// K1 TERMINAL — command center. Six live panels + ticker tape over k1_records.
import {
  initTerminal, loadRecords, subscribeInserts, subscribeChanges, parseRecordRow,
  recordCounts, queueStats, drawCandles, drawLine, apiFetch,
  fmtNum, fmtPx, fmtPct, fmtSigned, fmtUtc, fmtClock, timeAgo, usToDate,
  el, clear, badge, dirClass, maskedHost,
} from "./core.js";

const TF_ORDER = ["1m", "5m", "15m", "1h", "4h", "1d"];
const $ = id => document.getElementById(id);

const state = {
  series: new Map(),      // "SYM|TF" -> Map(open_time -> candle)
  anomalies: [],          // MarketAnomaly payloads
  decisions: [],          // TradingDecision payloads (newest first)
  forecasts: new Map(),   // forecast id -> payload
  trades: [],             // PaperTrade payloads
  positions: new Map(),   // order_id -> latest PaperPosition payload
  counts: [],             // k1_record_counts rows
  lastEventUs: 0,
};

initTerminal({ title: "TERMINAL", onAuth: start }).catch(e => console.error(e));

async function start(sb) {
  $("sb-host").textContent = maskedHost();
  await Promise.allSettled([
    loadMarkets(sb), loadScanner(sb), loadWorld(), loadDecisions(sb),
    loadPaper(sb), loadSystem(sb),
  ]);
  // seed last-event marker from whatever we loaded
  let mx = 0;
  for (const d of state.decisions) mx = Math.max(mx, d._available_us || 0);
  for (const t of state.trades) mx = Math.max(mx, t._available_us || 0);
  for (const m of state.series.values()) for (const c of m.values())
    mx = Math.max(mx, c._available_us || 0);
  state.lastEventUs = mx;
  renderSysCounts();
  $("sb-ts").textContent = fmtUtc(new Date());

  subscribeInserts(sb, "k1_records", p => {
    const r = p && p.new ? parseRecordRow(p.new) : null;
    if (!r) return;
    state.lastEventUs = Math.max(state.lastEventUs, r._available_us || 0);
    $("sb-ts").textContent = fmtUtc(new Date());
    routeRecord(r, p.new);
  });
  for (const ev of ["UPDATE", "INSERT"]) {
    subscribeChanges(sb, "prb_latest", ev, p => {
      const pl = p && p.new ? p.new.payload : null;
      if (pl) renderScanner(typeof pl === "string" ? safeParse(pl) : pl);
    });
  }
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

function routeRecord(r) {
  switch (r._kind) {
    case "Candle": onCandle(r); break;
    case "MarketAnomaly":
      state.anomalies.unshift(r);
      if (state.anomalies.length > 500) state.anomalies.length = 500;
      renderAnomCount(); break;
    case "TradingDecision":
      state.decisions.unshift(r);
      if (state.decisions.length > 100) state.decisions.length = 100;
      renderDecisions(true); break;
    case "Forecast": state.forecasts.set(r.id, r); renderDecisions(false); break;
    case "PaperTrade": state.trades.push(r); renderPaper(); break;
    case "PaperPosition": onPosition(r); break;
  }
  // bump footer record total + kind count
  const c = state.counts.find(x => x.kind === r._kind);
  if (c) { c.n = Number(c.n) + 1; } else { state.counts.push({ kind: r._kind, n: 1 }); }
  renderSysCounts();
  renderRecordsTotal();
}

/* ---------------------------------------------------------------- MARKETS */
async function loadMarkets(sb) {
  const [candles, anomalies] = await Promise.all([
    loadRecords(sb, "Candle", { limit: 2000 }),
    loadRecords(sb, "MarketAnomaly", { limit: 200 }),
  ]);
  for (const c of candles) onCandle(c, true);
  state.anomalies = anomalies;
  buildSelectors();
  renderAnomCount();
  renderTape();
  renderMarketPanel();
}

function onCandle(c, defer) {
  const key = `${c.symbol}|${c.timeframe}`;
  let m = state.series.get(key);
  if (!m) { m = new Map(); state.series.set(key, m); }
  const ex = m.get(c.open_time);
  if (!ex || (c.revision || 1) >= (ex.revision || 1)) m.set(c.open_time, c);
  if (!defer) {
    renderTape();
    const sel = `${$("mk-sym").value}|${$("mk-tf").value}`;
    if (key === sel) renderMarketPanel();
  }
}

function seriesBars(key) {
  const m = state.series.get(key);
  if (!m) return null;
  const arr = [...m.values()].sort((a, b) => new Date(a.open_time) - new Date(b.open_time));
  return {
    t: arr.map(c => c.open_time),
    o: arr.map(c => c.open), h: arr.map(c => c.high),
    l: arr.map(c => c.low), c: arr.map(c => c.close),
    v: arr.map(c => c.volume || 0),
    arr,
  };
}

function buildSelectors() {
  const syms = new Set(), tfs = new Set();
  for (const k of state.series.keys()) {
    const [s, tf] = k.split("|");
    syms.add(s); tfs.add(tf);
  }
  const symSel = $("mk-sym"), tfSel = $("mk-tf");
  clear(symSel); clear(tfSel);
  for (const s of [...syms].sort()) symSel.appendChild(el("option", "", s));
  for (const tf of TF_ORDER.filter(t => tfs.has(t)).concat([...tfs].filter(t => !TF_ORDER.includes(t)).sort()))
    tfSel.appendChild(el("option", "", tf));
  const first = state.series.keys().next().value;
  if (first) {
    const [s, tf] = first.split("|");
    symSel.value = s; tfSel.value = tf;
  }
  symSel.onchange = () => { renderMarketPanel(); renderAnomCount(); };
  tfSel.onchange = () => { renderMarketPanel(); renderAnomCount(); };
}

function renderMarketPanel() {
  const key = `${$("mk-sym").value}|${$("mk-tf").value}`;
  const b = seriesBars(key);
  drawCandles($("mk-chart"), b);
  if (!b || !b.arr.length) {
    $("mk-last").textContent = "—"; $("mk-chg").textContent = "—";
    $("mk-meta").textContent = "NO CANDLES";
    return;
  }
  const last = b.arr[b.arr.length - 1], first = b.arr[0];
  const chg = last.close / first.open - 1;
  $("mk-last").textContent = fmtPx(last.close);
  const ce = $("mk-chg");
  ce.textContent = `${fmtSigned(last.close - first.open)} (${fmtPct(chg)})`;
  ce.className = chg >= 0 ? "up" : "down";
  $("mk-meta").textContent = `${b.arr.length} BARS · ${fmtUtc(last.close_time)}Z`;
}

function renderAnomCount() {
  const sym = $("mk-sym").value;
  const recent = state.anomalies.filter(a => !sym || a.symbol === sym).length;
  $("mk-anom").textContent = recent ? `⚠ ${recent} ANOM` : "";
  $("mk-anom").style.color = recent ? "var(--amber)" : "var(--dim)";
}

/* ------------------------------------------------------------------ TAPE */
function renderTape() {
  const per = new Map(); // sym -> {key, c} latest candle across tfs
  for (const [key, m] of state.series) {
    const sym = key.split("|")[0];
    for (const c of m.values()) {
      const cur = per.get(sym);
      if (!cur || new Date(c.close_time) > new Date(cur.c.close_time)) per.set(sym, { key, c });
    }
  }
  if (!per.size) return;
  const tape = $("tape");
  clear(tape);
  const items = [];
  for (const [sym, { key, c }] of [...per.entries()].sort()) {
    const b = seriesBars(key);
    const first = b && b.arr.length ? b.arr[0] : c;
    const chg = c.close / first.open - 1;
    items.push({ sym, px: c.close, chg });
  }
  // duplicate for seamless marquee loop
  for (let rep = 0; rep < 2; rep++) {
    for (const it of items) {
      const s = el("span", "tape-item");
      s.appendChild(el("span", "sym", it.sym));
      s.appendChild(el("span", "px", fmtPx(it.px)));
      s.appendChild(el("span", `chg ${it.chg >= 0 ? "up" : "down"}`, fmtPct(it.chg)));
      tape.appendChild(s);
      tape.appendChild(el("span", "tape-sep", "·"));
    }
  }
}

/* --------------------------------------------------------------- SCANNER */
async function loadScanner(sb) {
  try {
    const { data, error } = await sb.from("prb_latest").select("payload,updated_at").eq("id", 1).maybeSingle();
    if (error || !data) { renderScanner(null); return; }
    const pl = typeof data.payload === "string" ? safeParse(data.payload) : data.payload;
    renderScanner(pl);
  } catch { renderScanner(null); }
}

function renderScanner(pl) {
  const tb = $("scan-table").tBodies[0];
  clear(tb);
  if (!pl || !Array.isArray(pl.setups) || !pl.setups.length) {
    $("scan-empty").classList.remove("hidden");
    $("scan-foot").textContent = pl ? `scanned ${pl.scanned ?? "—"}` : "NO SCAN";
    $("scan-ts").textContent = pl && pl.ts ? fmtClock(pl.ts * 1000) : "";
    return;
  }
  $("scan-empty").classList.add("hidden");
  const setups = [...pl.setups].sort((a, b) => (b.quality || 0) - (a.quality || 0)).slice(0, 9);
  setups.forEach((s, i) => {
    const tr = el("tr");
    tr.appendChild(el("td", "dim", String(i + 1)));
    tr.appendChild(el("td", "", s.symbol || "—"));
    tr.appendChild(el("td", "dim", s.timeframe || ""));
    const dt = el("td"); dt.appendChild(badge(s.direction || "?")); tr.appendChild(dt);
    const sc = el("td", `num ${dirClass(s.direction)}`, fmtSigned(s.score, 2)); tr.appendChild(sc);
    tr.appendChild(el("td", "num", fmtNum(s.rr, 1)));
    const q = el("td");
    const bar = el("div", "bar q");
    const fill = el("i"); fill.style.left = "0"; fill.style.width = `${Math.max(0, Math.min(1, s.quality || 0)) * 100}%`;
    bar.appendChild(fill); q.appendChild(bar); tr.appendChild(q);
    tb.appendChild(tr);
  });
  const feeds = Object.entries(pl.feed_status || {});
  const down = feeds.filter(([, v]) => v !== "ok").length;
  const nerr = pl.errors ? Object.keys(pl.errors).length : 0;
  $("scan-foot").textContent =
    `scanned ${pl.scanned ?? "—"} · feed ${down ? `${down}/${feeds.length} DOWN` : "OK"}${nerr ? ` · ${nerr} ERR` : ""}`;
  $("scan-ts").textContent = pl.ts ? `SCAN ${fmtClock(pl.ts * 1000)}Z` : "";
}

/* ------------------------------------------------------------------ WORLD */
async function loadWorld() {
  const tb = $("world-table").tBodies[0];
  try {
    const r = await apiFetch("events", { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    let rows = [];
    if (Array.isArray(j.countries)) {
      rows = j.countries.map(c => [c.country ?? c.name ?? c.cc ?? "?", Number(c.mentions ?? c.n ?? c.count ?? 0)]);
    } else if (j.countries && typeof j.countries === "object") {
      rows = Object.entries(j.countries).map(([k, v]) => [k, typeof v === "number" ? v : Number(v && (v.mentions ?? v.n ?? v.count)) || 0]);
    }
    rows = rows.filter(r => r[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
    clear(tb);
    if (!rows.length) { $("world-empty").classList.remove("hidden"); }
    else {
      $("world-empty").classList.add("hidden");
      const tot = rows.reduce((s, r) => s + r[1], 0) || 1;
      for (const [name, n] of rows) {
        const tr = el("tr");
        tr.appendChild(el("td", "", name));
        tr.appendChild(el("td", "num", fmtNum(n, 0)));
        tr.appendChild(el("td", "num dim", fmtPct(n / tot, 0)));
        tb.appendChild(tr);
      }
    }
    const esc = j.escalation;
    let escTxt = "";
    if (esc != null) {
      if (typeof esc === "number") escTxt = `ESC ${fmtNum(esc, 1)}`;
      else if (typeof esc === "object") {
        const top = Object.entries(esc).sort((a, b) => Number(b[1]) - Number(a[1]))[0];
        if (top) escTxt = `HOT ${top[0]} ${fmtNum(top[1], 0)}`;
      } else escTxt = `ESC ${String(esc).toUpperCase()}`;
    }
    $("world-esc").textContent = escTxt;
    $("world-esc").style.color = "var(--amber)";
    $("world-foot").textContent = `${Array.isArray(j.points) ? j.points.length : 0} POINTS · ${fmtClock(new Date())}Z`;
  } catch (e) {
    clear(tb);
    $("world-empty").classList.remove("hidden");
    $("world-empty").textContent = "OFFLINE — /api/events unavailable";
    $("world-foot").textContent = "feed down";
  }
}

/* --------------------------------------------------------------- DECISIONS */
async function loadDecisions(sb) {
  const [decs, fcs] = await Promise.all([
    loadRecords(sb, "TradingDecision", { limit: 10 }),
    loadRecords(sb, "Forecast", { limit: 100 }),
  ]);
  state.decisions = decs;
  for (const f of fcs) state.forecasts.set(f.id, f);
  renderDecisions(false);
}

function renderDecisions(flashFirst) {
  const tb = $("dec-table").tBodies[0];
  clear(tb);
  const list = state.decisions.slice(0, 10);
  if (!list.length) { $("dec-empty").classList.remove("hidden"); return; }
  $("dec-empty").classList.add("hidden");
  list.forEach((d, i) => {
    const tr = el("tr", flashFirst && i === 0 ? "flash" : "");
    tr.appendChild(el("td", "dim", fmtClock(usToDate(d._available_us))));
    tr.appendChild(el("td", "", d.symbol || "—"));
    const at = el("td"); at.appendChild(badge(d.action || "?")); tr.appendChild(at);
    const f = d.forecast_id ? state.forecasts.get(d.forecast_id) : null;
    tr.appendChild(el("td", "num cy", f && f.probability != null ? fmtPct(f.probability, 0) : "—"));
    tb.appendChild(tr);
  });
}

/* ------------------------------------------------------------------- PAPER */
function onPosition(p) {
  const cur = state.positions.get(p.order_id);
  if (!cur || (p._available_us || 0) >= (cur._available_us || 0)) state.positions.set(p.order_id, p);
  renderPaper();
}

async function loadPaper(sb) {
  const [trades, poss] = await Promise.all([
    loadRecords(sb, "PaperTrade", { limit: 500 }),
    loadRecords(sb, "PaperPosition", { limit: 500 }),
  ]);
  state.trades = trades;
  for (const p of poss) {
    const cur = state.positions.get(p.order_id);
    if (!cur || (p._available_us || 0) >= (cur._available_us || 0)) state.positions.set(p.order_id, p);
  }
  renderPaper();
}

function renderPaper() {
  const trades = [...state.trades].sort((a, b) => new Date(a.exit_time) - new Date(b.exit_time));
  let cum = 0;
  const curve = trades.map(t => { cum += Number(t.pnl) || 0; return { x: new Date(t.exit_time).getTime(), y: cum }; });
  drawLine($("pp-chart"), curve);
  const open = [...state.positions.values()].filter(p => p.status === "OPEN").length;
  const fees = state.trades.reduce((s, t) => s + (Number(t.fees) || 0), 0);
  const pn = $("pp-pnl");
  pn.textContent = fmtSigned(cum, 2);
  pn.className = `v ${cum >= 0 ? "up" : "down"}`;
  $("pp-open").textContent = String(open);
  $("pp-trades").textContent = String(state.trades.length);
  $("pp-fees").textContent = fmtNum(fees, 2);
  $("paper-meta").textContent = trades.length ? `LAST EXIT ${timeAgo(trades[trades.length - 1].exit_time)}` : "";
}

/* ------------------------------------------------------------------ SYSTEM */
async function loadSystem(sb) {
  const [qs, counts] = await Promise.all([queueStats(sb), recordCounts(sb)]);
  state.counts = counts;
  renderQueueChips(qs);
  renderSysCounts();
  renderRecordsTotal();
}

function renderQueueChips(qs) {
  const box = clear($("sys-chips"));
  const byState = {};
  for (const r of qs) byState[r.state] = (byState[r.state] || 0) + (Number(r.n) || 0);
  for (const s of ["queued", "leased", "completed", "dead_letter"]) {
    const chip = el("span", "chip static");
    chip.appendChild(document.createTextNode(`${s.toUpperCase()} `));
    const v = el("b", s === "dead_letter" && byState[s] ? "down" : "", fmtNum(byState[s] || 0, 0));
    v.style.fontWeight = "400";
    chip.appendChild(v);
    box.appendChild(chip);
  }
  if (!qs.length) box.appendChild(el("span", "micro dim", "QUEUE VIEW EMPTY"));
}

function renderSysCounts() {
  const tb = $("sys-table").tBodies[0];
  clear(tb);
  const rows = [...state.counts].sort((a, b) => Number(b.n) - Number(a.n)).slice(0, 12);
  for (const r of rows) {
    const tr = el("tr");
    tr.appendChild(el("td", "", r.kind));
    tr.appendChild(el("td", "num cy", fmtNum(r.n, 0)));
    tb.appendChild(tr);
  }
  if (state.lastEventUs)
    $("sys-last").textContent = `LAST EVENT ${fmtUtc(usToDate(state.lastEventUs))}Z`;
  else if (rows.length)
    $("sys-last").textContent = `${fmtNum(rows.reduce((s, r) => s + Number(r.n), 0), 0)} TOTAL RECORDS`;
}

function renderRecordsTotal() {
  const tot = state.counts.reduce((s, r) => s + Number(r.n || 0), 0);
  $("sb-recs").textContent = fmtNum(tot, 0);
}
