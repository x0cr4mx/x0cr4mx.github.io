// K1 ▸ PAPER — equity curve, closed trades, open positions, per-symbol chips.
import {
  initTerminal, loadRecords, subscribeInserts, parseRecordRow,
  drawLine, fmtNum, fmtPx, fmtPct, fmtSigned, fmtUtc, usToDate, el, clear, badge,
} from "./core.js";

const trades = [];               // PaperTrade payloads
const positions = new Map();     // order_id -> latest PaperPosition

initTerminal({ title: "PAPER", onAuth: start }).catch(e => console.error(e));

async function start(sb) {
  const [t, p] = await Promise.all([
    loadRecords(sb, "PaperTrade", { limit: 1000 }),
    loadRecords(sb, "PaperPosition", { limit: 1000 }),
  ]);
  trades.push(...t);
  for (const x of p) upsertPosition(x);
  render();

  subscribeInserts(sb, "k1_records", pr => {
    const r = pr && pr.new ? parseRecordRow(pr.new) : null;
    if (!r) return;
    if (r._kind === "PaperTrade") { trades.push(r); render(); }
    else if (r._kind === "PaperPosition") { upsertPosition(r); render(); }
  });
}

function upsertPosition(p) {
  const cur = positions.get(p.order_id);
  if (!cur || (p._available_us || 0) >= (cur._available_us || 0)) positions.set(p.order_id, p);
}

function fmtDur(s) {
  s = Number(s) || 0;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}

function render() {
  const sorted = [...trades].sort((a, b) => new Date(a.exit_time) - new Date(b.exit_time));
  let cum = 0, peak = 0, maxdd = 0, wins = 0, fees = 0;
  const curve = [];
  const bySym = new Map();
  for (const t of sorted) {
    const pnl = Number(t.pnl) || 0;
    cum += pnl;
    fees += Number(t.fees) || 0;
    if (pnl > 0) wins++;
    peak = Math.max(peak, cum);
    maxdd = Math.max(maxdd, peak - cum);
    curve.push({ x: new Date(t.exit_time).getTime(), y: cum });
    bySym.set(t.symbol, (bySym.get(t.symbol) || 0) + pnl);
  }
  drawLine(document.getElementById("curve"), curve);

  const open = [...positions.values()].filter(p => p.status === "OPEN");
  const unr = open.reduce((s, p) => s + (Number(p.unrealized_pnl) || 0), 0);
  const n = sorted.length;

  document.getElementById("s-trades").textContent = String(n);
  document.getElementById("s-win").textContent = n ? fmtPct(wins / n, 0) : "—";
  const avg = document.getElementById("s-avg");
  avg.textContent = n ? fmtSigned(cum / n, 2) : "—";
  avg.className = `v ${cum / (n || 1) >= 0 ? "up" : "down"}`;
  const pv = document.getElementById("s-pnl");
  pv.textContent = fmtSigned(cum, 2);
  pv.className = `v ${cum >= 0 ? "up" : "down"}`;
  const uv = document.getElementById("s-unr");
  uv.textContent = fmtSigned(unr, 2);
  uv.className = `v ${unr >= 0 ? "up" : "down"}`;
  document.getElementById("s-fees").textContent = fmtNum(fees, 2);
  document.getElementById("s-dd").textContent = fmtNum(-maxdd, 2);
  document.getElementById("s-open").textContent = String(open.length);

  // per-symbol chips
  const box = clear(document.getElementById("syms"));
  for (const [sym, pnl] of [...bySym.entries()].sort((a, b) => b[1] - a[1])) {
    const c = el("span", "chip static");
    c.appendChild(document.createTextNode(`${sym} `));
    c.appendChild(el("b", pnl >= 0 ? "up" : "down", fmtSigned(pnl, 1)));
    c.querySelector("b").style.fontWeight = "400";
    box.appendChild(c);
  }

  // closed trades table (newest first)
  const cb = document.getElementById("closed").tBodies[0];
  clear(cb);
  document.getElementById("closed-empty").classList.toggle("hidden", n > 0);
  for (const t of [...sorted].reverse().slice(0, 500)) {
    const tr = el("tr");
    tr.appendChild(el("td", "dim", fmtUtc(t.exit_time)));
    tr.appendChild(el("td", "", t.symbol));
    const sd = el("td"); sd.appendChild(badge(t.side)); tr.appendChild(sd);
    tr.appendChild(el("td", "num", fmtNum(t.quantity, 4)));
    tr.appendChild(el("td", "num", fmtPx(t.entry_fill)));
    tr.appendChild(el("td", "num", fmtPx(t.exit_fill)));
    const pnl = Number(t.pnl) || 0;
    tr.appendChild(el("td", `num ${pnl >= 0 ? "up" : "down"}`, fmtSigned(pnl, 2)));
    tr.appendChild(el("td", "num dim", fmtNum(t.fees, 2)));
    tr.appendChild(el("td", "num dim", fmtDur(t.duration_seconds)));
    tr.appendChild(el("td", "dim", String(t.exit_reason || "").toUpperCase()));
    cb.appendChild(tr);
  }

  // open positions table
  const ob = document.getElementById("open").tBodies[0];
  clear(ob);
  document.getElementById("open-empty").classList.toggle("hidden", open.length > 0);
  for (const p of open.sort((a, b) => (b._available_us || 0) - (a._available_us || 0))) {
    const tr = el("tr");
    tr.appendChild(el("td", "", p.symbol));
    const sd = el("td"); sd.appendChild(badge(p.side)); tr.appendChild(sd);
    tr.appendChild(el("td", "num", fmtNum(p.quantity, 4)));
    tr.appendChild(el("td", "num", fmtPx(p.entry_fill)));
    tr.appendChild(el("td", "num cy", fmtPx(p.mark_price)));
    const u = Number(p.unrealized_pnl) || 0;
    tr.appendChild(el("td", `num ${u >= 0 ? "up" : "down"}`, fmtSigned(u, 2)));
    tr.appendChild(el("td", "num dim", fmtNum(p.bars_held, 0)));
    tr.appendChild(el("td", "num down", fmtNum(-Math.abs(Number(p.mae) || 0), 2)));
    tr.appendChild(el("td", "num up", fmtNum(p.mfe, 2)));
    ob.appendChild(tr);
  }
}
