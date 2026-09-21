// K1 ▸ TOP 9 — best pattern-bot detections (chart PNG + SemIf judgment).
// No realtime publication on `detections` -> poll every 60s + manual button.
import {
  initTerminal, setConnState,
  fmtNum, fmtPx, fmtSigned, fmtClock, timeAgo, shortId,
  el, clear, badge, dirClass,
} from "./core.js";
import {
  detSymbol, fetchDetectionPng, loadTopDetections, rankDetections, semifLabel,
} from "./top9-data.js";

const POLL_MS = 60000;
const FETCH_N = 60;      // rows pulled per poll; the top-9 pick re-ranks them
const TOP_N = 9;

let _sb = null;
let _rows = [];
let _err = null;
let _lastLoad = null;
let _urls = [];          // PNG object URLs alive in the current render

initTerminal({ title: "TOP 9", onAuth: start }).catch(e => console.error(e));

async function start(sb) {
  _sb = sb;
  await refresh();
  setInterval(refresh, POLL_MS);
}

async function refresh() {
  try {
    _rows = await loadTopDetections(_sb, FETCH_N);
    _err = null;
    _lastLoad = new Date();
    setConnState("live");
  } catch (e) {
    _err = e;
    setConnState("down");
  }
  render();
}

/* ------------------------------------------------------------------ view */
function statChip(label, n, cls) {
  const c = el("span", "chip static");
  c.appendChild(document.createTextNode(`${label} `));
  const v = el("b", cls, String(n));
  v.style.fontWeight = "400";
  c.appendChild(v);
  return c;
}

function render() {
  const bar = clear(document.getElementById("t9-bar"));
  const grid = clear(document.getElementById("grid"));
  for (const u of _urls) URL.revokeObjectURL(u);   // release stale PNG blobs
  _urls = [];

  bar.appendChild(el("span", "micro", "TOP 9 ▸"));
  const cnt = st =>
    _rows.filter(d => String(d.status || "").toUpperCase() === st).length;
  bar.appendChild(statChip("NEW", cnt("NEW"), "amb"));
  bar.appendChild(statChip("ANALYZED", cnt("ANALYZED"), "up"));
  if (cnt("ERROR")) bar.appendChild(statChip("ERROR", cnt("ERROR"), "down"));
  bar.appendChild(el("span", "micro dim", `${_rows.length} ROWS`));
  if (_err) {
    const msg = (_err && (_err.message || _err.error_description)) || "query failed";
    bar.appendChild(el("span", "badge down", `DATA UNAVAILABLE — ${msg}`));
  }
  bar.appendChild(el("span", "flex-sp"));
  bar.appendChild(el("span", "micro dim",
    _lastLoad ? `UPD ${fmtClock(_lastLoad)}Z` : "—"));
  const btn = el("button", "btn", "↻ REFRESH");
  btn.id = "t9-refresh";
  btn.addEventListener("click", () => refresh());
  bar.appendChild(btn);

  const meta = document.getElementById("t9-meta");
  const top = rankDetections(_rows, TOP_N);
  if (meta) {
    meta.textContent = _rows.length
      ? `${top.length} SHOWN OF ${_rows.length} · POLL 60S` : "";
  }

  if (!top.length) {
    grid.appendChild(el("div", "empty", _err
      ? "DATA UNAVAILABLE — detections could not be loaded, retrying automatically"
      : "NO DETECTIONS YET — the pattern bot has not published anything"));
    return;
  }
  for (const d of top) grid.appendChild(detCard(d));
}

function detCard(d) {
  const meta = d.meta && typeof d.meta === "object" ? d.meta : {};
  const card = el("div", "setup");

  // header: symbol tf dir | score q freshness status
  const h = el("div", "su-h");
  h.appendChild(el("span", "s", detSymbol(d)));
  h.appendChild(el("span", "tf", d.timeframe || ""));
  h.appendChild(badge(d.direction || "?"));
  h.appendChild(el("span", "flex-sp"));
  h.appendChild(el("span", `micro ${dirClass(d.direction)}`,
    `SCORE ${fmtSigned(d.score, 2)}`));
  const qChip = el("span", "micro amb", `Q ${fmtNum(d.quality, 2)}`);
  qChip.title = "Q — bot quality score for this pattern (higher is better)";
  h.appendChild(qChip);
  h.appendChild(el("span", "micro dim", timeAgo(d.ts)));
  const sf = semifLabel(d);
  const sfChip = el("span", `badge ${sf.cls}`, sf.text);
  sfChip.title = "SEMIF — the bot's second-pass review of this pattern: VALID means it confirmed the signal, IMPOSTOR means it rejected it";
  h.appendChild(sfChip);
  card.appendChild(h);

  const body = el("div", "su-b");

  // chart PNG — fetched with Authorization (img can't send headers)
  const cw = el("div", "su-chart");
  const loading = el("div", "nobars");
  loading.appendChild(el("span", "micro", "loading…"));
  cw.appendChild(loading);
  body.appendChild(cw);
  fillChart(d, cw);

  const info = el("div", "su-info");

  // WHAT THE BOT SEES — plain description + up to 3 why lines
  info.appendChild(el("div", "micro dim", "WHAT THE BOT SEES"));
  const desc = d.description || meta.description_it || "";
  const whys = Array.isArray(meta.why) ? meta.why : [];
  if (desc) info.appendChild(el("div", "t9-note", desc));
  if (whys.length) {
    const why = el("div", "why");
    for (const ln of whys.slice(0, 3)) why.appendChild(el("div", "", ln));
    info.appendChild(why);
  }
  if (!desc && !whys.length) info.appendChild(el("div", "micro dim", "—"));

  // SUGGESTED LEVELS (PAPER ONLY) — the bot's levels, explicitly non-actionable
  info.appendChild(el("div", "micro dim", "SUGGESTED LEVELS (PAPER ONLY)"));
  const kv = el("div", "kv");
  for (const [k, v, cls, tip] of [
    ["ENTRY", fmtPx(d.entry), "", "Price where the bot would open the trade"],
    ["INVALIDATION", fmtPx(d.stop), "down", "Price that proves the idea wrong (stop)"],
    ["TARGET", fmtPx(d.target), "up", "Price where the bot would take profit"],
    ["RR", fmtNum(d.rr, 1), "cy", "RR — reward/risk ratio: target distance divided by stop distance"],
    ["LAST", fmtPx(d.last_close), "", "Most recent observed price"],
  ]) {
    const cell = el("div");
    const kk = el("div", "kk", k);
    kk.title = tip;
    cell.appendChild(kk);
    cell.appendChild(el("div", `vv ${cls}`, v));
    kv.appendChild(cell);
  }
  info.appendChild(kv);
  info.appendChild(el("div", "micro dim",
    "paper trading only — nothing is executed on a real account"));

  // technique slug + top-3 detector signals as static chips
  const pats = el("div", "pats");
  if (d.technique) {
    const t = el("span", "chip static");
    const b = el("b", "amb", String(d.technique));
    b.style.fontWeight = "400";
    t.appendChild(b);
    pats.appendChild(t);
  }
  const sigs = Array.isArray(meta.signals) ? meta.signals : [];
  for (const s of sigs.slice(0, 3)) {
    const p = el("span", "chip static");
    p.appendChild(document.createTextNode(
      `${String(s.pattern || "?").replace(/_/g, "-")} `));
    const b = el("b", dirClass(s.direction), fmtNum(s.confidence, 2));
    b.style.fontWeight = "400";
    p.appendChild(b);
    pats.appendChild(p);
  }
  if (pats.children.length) info.appendChild(pats);

  body.appendChild(info);
  card.appendChild(body);

  // footer: det id · technique · age since created_at
  const f = el("div", "t9-foot");
  f.appendChild(el("span", "micro dim", shortId(d.id, 20)));
  f.appendChild(el("span", "micro dim", d.technique || ""));
  f.appendChild(el("span", "flex-sp"));
  f.appendChild(el("span", "micro dim",
    d.created_at ? `CREATED ${timeAgo(d.created_at)}` : ""));
  card.appendChild(f);
  return card;
}

async function fillChart(d, cw) {
  const url = await fetchDetectionPng(_sb, d.id);
  if (!cw.isConnected) {                    // card re-rendered meanwhile
    if (url) URL.revokeObjectURL(url);
    return;
  }
  clear(cw);
  if (!url) {
    console.debug("top9: chart png unavailable for", d.id);
    cw.appendChild(el("div", "nobars", "chart unavailable"));
    return;
  }
  _urls.push(url);
  const img = el("img", "t9-img");
  img.alt = `${detSymbol(d)} ${d.timeframe || ""}`;
  img.src = url;
  cw.appendChild(img);
}
