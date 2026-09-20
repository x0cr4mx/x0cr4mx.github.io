// K1 ▸ DECISIONS — scrolling ledger of decisions, forecasts, assessments.
import {
  initTerminal, loadRecords, subscribeInserts, parseRecordRow,
  fmtNum, fmtPct, fmtUtc, usToDate, el, clear, badge, dirClass,
} from "./core.js";

const KINDS = [
  "TradingDecision", "Forecast", "RiskAssessment", "TechnicalAssessment",
  "JudgeAssessment", "HistoricalAssessment", "EventAssessment", "ExpertOpinion",
];
const rows = [];               // merged payloads, newest first
const openDetail = new Set();  // expanded row ids
const filter = { dir: null, sym: null };
let flashId = null;

initTerminal({ title: "DECISIONS", onAuth: start }).catch(e => console.error(e));

async function start(sb) {
  const lists = await Promise.all(KINDS.map(k => loadRecords(sb, k, { limit: 100 })));
  for (const l of lists) rows.push(...l);
  rows.sort((a, b) => (b._available_us || 0) - (a._available_us || 0));
  buildFilters();
  render();

  subscribeInserts(sb, "k1_records", p => {
    const r = p && p.new ? parseRecordRow(p.new) : null;
    if (!r || !KINDS.includes(r._kind)) return;
    rows.unshift(r);
    rows.sort((a, b) => (b._available_us || 0) - (a._available_us || 0));
    flashId = r._id;
    buildFilters();
    render();
  });
}

/* ------------------------------------------------------------ filters */
function chip(label, on, fn) {
  const c = el("span", `chip${on ? " on" : ""}`, label);
  c.addEventListener("click", fn);
  return c;
}

function buildFilters() {
  const bar = clear(document.getElementById("filters"));
  bar.appendChild(el("span", "micro", "FILTER ▸"));
  const dirs = ["LONG", "SHORT", "NO_TRADE", "ABSTAIN"];
  for (const d of dirs) {
    bar.appendChild(chip(d, filter.dir === d, () => {
      filter.dir = filter.dir === d ? null : d;
      buildFilters(); render();
    }));
  }
  bar.appendChild(el("span", "dim", "|"));
  const syms = [...new Set(rows.map(r => r.symbol).filter(Boolean))].sort();
  for (const s of syms.slice(0, 12)) {
    bar.appendChild(chip(s, filter.sym === s, () => {
      filter.sym = filter.sym === s ? null : s;
      buildFilters(); render();
    }));
  }
  bar.appendChild(el("span", "flex-sp"));
  bar.appendChild(el("span", "micro dim", `${rows.length} RECORDS`));
}

/* ------------------------------------------------------------ render */
function dirOf(r) {
  return r.action || r.direction || (r.approved === true ? "APPROVED" : r.approved === false ? "REJECTED" : "—");
}

function passes(r) {
  if (filter.dir && String(dirOf(r)).toUpperCase() !== filter.dir) return false;
  if (filter.sym && r.symbol !== filter.sym) return false;
  return true;
}

function summaryOf(r) {
  switch (r._kind) {
    case "TradingDecision":
      return r.rationale || "";
    case "Forecast":
      return r.rationale || "";
    case "RiskAssessment": {
      const bits = [];
      if (r.entry != null) bits.push(`entry ${fmtNum(r.entry, 4)}`);
      if (r.stop_loss != null) bits.push(`sl ${fmtNum(r.stop_loss, 4)}`);
      if (r.take_profit != null) bits.push(`tp ${fmtNum(r.take_profit, 4)}`);
      if (r.max_loss != null) bits.push(`maxloss ${fmtNum(r.max_loss, 2)}`);
      return (r.reasons || []).join("; ") + (bits.length ? ` — ${bits.join(" · ")}` : "");
    }
    default:
      return r.rationale || (r.note || "");
  }
}

function metricOf(r) {
  if (r._kind === "Forecast" && r.probability != null) return fmtPct(r.probability, 0);
  if (r._kind === "RiskAssessment" && r.quantity != null) return fmtNum(r.quantity, 4);
  return "—";
}

function render() {
  const tb = document.getElementById("ledger").tBodies[0];
  clear(tb);
  const list = rows.filter(passes).slice(0, 400);
  document.getElementById("empty").classList.toggle("hidden", list.length > 0);
  document.getElementById("foot").textContent =
    `${list.length}/${rows.length} SHOWN · ${filter.dir || "ALL DIR"} · ${filter.sym || "ALL SYM"}`;
  for (const r of list) {
    const tr = el("tr", "clickable");
    if (r._id === flashId) tr.classList.add("flash");
    tr.appendChild(el("td", "dim", fmtUtc(usToDate(r._available_us))));
    const KL = { TradingDecision: "DECISION", Forecast: "FORECAST", RiskAssessment: "RISK",
      TechnicalAssessment: "TECHNICAL", JudgeAssessment: "JUDGE", HistoricalAssessment: "HISTORICAL",
      EventAssessment: "EVENT", ExpertOpinion: "EXPERT" };
    const kc = { TradingDecision: "amb", Forecast: "cy" };
    const kd = el("td"); const kb = badge(KL[r._kind] || r._kind.toUpperCase());
    if (kc[r._kind]) kb.classList.add(kc[r._kind]);
    kd.appendChild(kb); tr.appendChild(kd);
    tr.appendChild(el("td", "", r.symbol || "—"));
    tr.appendChild(el("td", "dim", r.timeframe || ""));
    const dd = el("td"); const db = badge(dirOf(r));
    const dc = dirClass(dirOf(r)); if (dc) db.classList.add(dc);
    dd.appendChild(db); tr.appendChild(dd);
    tr.appendChild(el("td", "num cy", metricOf(r)));
    const sm = el("td", "dim wrap", "");
    const txt = summaryOf(r);
    sm.textContent = txt.length > 140 ? txt.slice(0, 140) + "…" : txt;
    tr.appendChild(sm);
    tr.addEventListener("click", () => {
      if (openDetail.has(r._id)) openDetail.delete(r._id); else openDetail.add(r._id);
      render();
    });
    tb.appendChild(tr);
    if (openDetail.has(r._id)) tb.appendChild(detailRow(r));
  }
  flashId = null;
}

function detailRow(r) {
  const tr = el("tr", "detail");
  const td = el("td");
  td.colSpan = 7;
  const bits = [];
  bits.push(`<b>ID</b> ${r._id}`);
  if (r.forecast_id) bits.push(`<b>FORECAST</b> ${r.forecast_id}`);
  if (r.decision_id) bits.push(`<b>DECISION</b> ${r.decision_id}`);
  if (r.event_id) bits.push(`<b>EVENT</b> ${r.event_id}`);
  if (r.expert_id) bits.push(`<b>EXPERT</b> ${r.expert_id}`);
  if (r.model) bits.push(`<b>MODEL</b> ${r.model}`);
  if (Array.isArray(r.evidence_ids) && r.evidence_ids.length)
    bits.push(`<b>EVIDENCE</b> ${r.evidence_ids.length} refs`);
  const rationale = r.rationale ? `<div class="mt4"><b>RATIONALE</b><br>${esc(r.rationale)}</div>` : "";
  const inv = Array.isArray(r.invalidations) && r.invalidations.length
    ? `<div class="mt4"><b>INVALIDATIONS</b><br>${r.invalidations.map(esc).join("<br>")}</div>` : "";
  const reasons = Array.isArray(r.reasons) && r.reasons.length
    ? `<div class="mt4"><b>REASONS</b><br>${r.reasons.map(esc).join("<br>")}</div>` : "";
  td.innerHTML = `${bits.join(" · ")}${rationale}${inv}${reasons}`;
  tr.appendChild(td);
  return tr;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
