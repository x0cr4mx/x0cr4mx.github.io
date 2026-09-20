// K1 ▸ MARKETS — one candle chart per symbol×timeframe, anomalies strip.
import {
  initTerminal, loadRecords, subscribeInserts, parseRecordRow,
  drawCandles, fmtPx, fmtPct, fmtClock, usToDate, el, clear,
} from "./core.js";

const TF_ORDER = ["1m", "5m", "15m", "1h", "4h", "1d"];
const series = new Map();   // "SYM|TF" -> Map(open_time -> candle)
const cards = new Map();    // "SYM|TF" -> {card, canvas, px, chg}
const anomalies = [];

initTerminal({ title: "MARKETS", onAuth: start }).catch(e => console.error(e));

async function start(sb) {
  const [candles, anoms] = await Promise.all([
    loadRecords(sb, "Candle", { limit: 3000 }),
    loadRecords(sb, "MarketAnomaly", { limit: 300 }),
  ]);
  for (const c of candles) addCandle(c);
  for (const a of anoms) anomalies.push(a);
  renderAll();
  renderAnoms();

  subscribeInserts(sb, "k1_records", p => {
    const r = p && p.new ? parseRecordRow(p.new) : null;
    if (!r) return;
    if (r._kind === "Candle") {
      addCandle(r);
      const key = `${r.symbol}|${r.timeframe}`;
      if (!cards.has(key)) renderAll(); else renderCard(key);
    }
    else if (r._kind === "MarketAnomaly") { anomalies.unshift(r); renderAnoms(); }
  });
}

function addCandle(c) {
  const key = `${c.symbol}|${c.timeframe}`;
  let m = series.get(key);
  if (!m) { m = new Map(); series.set(key, m); }
  const ex = m.get(c.open_time);
  if (!ex || (c.revision || 1) >= (ex.revision || 1)) m.set(c.open_time, c);
}

function barsOf(m) {
  const arr = [...m.values()].sort((a, b) => new Date(a.open_time) - new Date(b.open_time));
  return {
    t: arr.map(c => c.open_time), o: arr.map(c => c.open), h: arr.map(c => c.high),
    l: arr.map(c => c.low), c: arr.map(c => c.close), v: arr.map(c => c.volume || 0), arr,
  };
}

function sortKeys() {
  return [...series.keys()].sort((a, b) => {
    const [sa, ta] = a.split("|"), [sb, tb] = b.split("|");
    if (sa !== sb) return sa < sb ? -1 : 1;
    return TF_ORDER.indexOf(ta) - TF_ORDER.indexOf(tb);
  });
}

function renderAll() {
  const grid = clear(document.getElementById("grid"));
  const keys = sortKeys();
  if (!keys.length) { grid.appendChild(el("div", "empty", "NO DATA — awaiting workers")); return; }
  for (const k of keys) {
    const [sym, tf] = k.split("|");
    const card = el("div", "chart-card");
    const h = el("div", "cc-h");
    h.appendChild(el("span", "s", sym));
    h.appendChild(el("span", "tf", tf));
    const px = el("span", "p", "—");
    const chg = el("span", "c", "");
    h.appendChild(px); h.appendChild(chg);
    card.appendChild(h);
    const cv = el("canvas");
    card.appendChild(cv);
    grid.appendChild(card);
    cards.set(k, { card, canvas: cv, px, chg });
    renderCard(k);
  }
}

function renderCard(key) {
  const entry = cards.get(key);
  const m = series.get(key);
  if (!entry || !m) return;
  const b = barsOf(m);
  drawCandles(entry.canvas, b);
  if (b.arr.length) {
    const last = b.arr[b.arr.length - 1], first = b.arr[0];
    const chg = last.close / first.open - 1;
    entry.px.textContent = fmtPx(last.close);
    entry.chg.textContent = fmtPct(chg);
    entry.chg.className = `c ${chg >= 0 ? "up" : "down"}`;
  }
}

function renderAnoms() {
  const strip = clear(document.getElementById("anoms"));
  strip.appendChild(el("span", "micro", "ANOMALIES ▸"));
  if (!anomalies.length) { strip.appendChild(el("span", "micro dim", "NONE")); return; }
  for (const a of anomalies.slice(0, 40)) {
    const n = el("span", "anom");
    n.appendChild(el("span", "", `${a.symbol} ${a.timeframe}`));
    n.appendChild(el("span", "amb", String(a.kind || "?").toUpperCase()));
    n.appendChild(el("span", a.direction === "SHORT" ? "down" : a.direction === "LONG" ? "up" : "dim",
      `${a.direction || "?"} ${Number(a.score ?? 0).toFixed(2)}`));
    n.title = fmtClock(usToDate(a._available_us || 0)) + "Z";
    strip.appendChild(n);
  }
}
