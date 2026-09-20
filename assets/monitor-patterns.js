// K1 ▸ PATTERN SCANNER — top-9 ranked setups from prb_latest.
import {
  initTerminal, subscribeChanges,
  drawCandles, fmtNum, fmtPx, fmtSigned, fmtUtc, timeAgo,
  el, clear, badge, dirClass,
} from "./core.js";

let scan = null;

initTerminal({ title: "PATTERNS", onAuth: start }).catch(e => console.error(e));

async function start(sb) {
  await load(sb);
  for (const ev of ["UPDATE", "INSERT"]) {
    subscribeChanges(sb, "prb_latest", ev, p => {
      const pl = p && p.new ? p.new.payload : null;
      const obj = typeof pl === "string" ? safeParse(pl) : pl;
      if (obj) { scan = obj; render(); }
    });
  }
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

async function load(sb) {
  try {
    const { data, error } = await sb.from("prb_latest").select("payload,updated_at").eq("id", 1).maybeSingle();
    if (!error && data) scan = typeof data.payload === "string" ? safeParse(data.payload) : data.payload;
  } catch { /* tolerate */ }
  render();
}

function render() {
  const bar = clear(document.getElementById("scan-bar"));
  const grid = clear(document.getElementById("grid"));
  bar.appendChild(el("span", "micro", "SCAN ▸"));

  if (!scan) {
    bar.appendChild(el("span", "micro dim", "NO SCAN DATA — awaiting pattern bot"));
    grid.appendChild(el("div", "empty", "NO DATA — awaiting pattern bot"));
    return;
  }

  // header chips
  bar.appendChild(el("span", "micro", `TS ${fmtUtc((scan.ts || 0) * 1000)}Z`));
  bar.appendChild(el("span", "micro", `SCANNED ${scan.scanned ?? "—"}`));
  const feeds = Object.entries(scan.feed_status || {});
  for (const [src, st] of feeds) {
    const c = el("span", "chip static");
    c.appendChild(document.createTextNode(`${src.toUpperCase()} `));
    c.appendChild(el("b", st === "ok" ? "up" : "down", String(st).toUpperCase()));
    c.querySelector("b").style.fontWeight = "400";
    bar.appendChild(c);
  }
  const nerr = scan.errors ? Object.keys(scan.errors).length : 0;
  if (nerr) {
    const c = el("span", "chip static");
    c.appendChild(document.createTextNode("ERR "));
    c.appendChild(el("b", "down", String(nerr)));
    c.querySelector("b").style.fontWeight = "400";
    c.title = Object.entries(scan.errors).map(([k, v]) => `${k}: ${v}`).join("\n");
    bar.appendChild(c);
  }
  bar.appendChild(el("span", "flex-sp"));
  bar.appendChild(el("span", "micro dim", `${(scan.setups || []).length} SETUPS`));
  const meta = document.getElementById("scan-meta");
  if (meta) meta.textContent = scan.ts ? `LAST SCAN ${timeAgo(scan.ts * 1000)}` : "";

  const setups = [...(scan.setups || [])].sort((a, b) => (b.quality || 0) - (a.quality || 0)).slice(0, 9);
  if (!setups.length) {
    grid.appendChild(el("div", "empty", "NO SETUPS ABOVE QUALITY THRESHOLD"));
    return;
  }
  for (const s of setups) grid.appendChild(setupCard(s));
}

function setupCard(s) {
  const card = el("div", "setup");

  // header
  const h = el("div", "su-h");
  h.appendChild(el("span", "s", s.symbol || "—"));
  h.appendChild(el("span", "tf", s.timeframe || ""));
  h.appendChild(badge(s.direction || "?"));
  h.appendChild(el("span", "flex-sp"));
  h.appendChild(el("span", `micro ${dirClass(s.direction)}`, `SCORE ${fmtSigned(s.score, 2)}`));
  h.appendChild(el("span", "micro amb", `Q ${fmtNum(s.quality, 2)}`));
  card.appendChild(h);

  // composite score bar -1..+1
  const sb_ = el("div", "bar neg");
  sb_.style.margin = "0";
  const mid = el("span", "mid"); sb_.appendChild(mid);
  const sc = Math.max(-1, Math.min(1, Number(s.score) || 0));
  const fill = el("i", sc >= 0 ? "pos" : "neg");
  if (sc >= 0) { fill.style.left = "50%"; fill.style.width = `${sc * 50}%`; }
  else { fill.style.left = `${50 + sc * 50}%`; fill.style.width = `${-sc * 50}%`; }
  sb_.appendChild(fill);
  card.appendChild(sb_);

  const body = el("div", "su-b");

  // mini chart from payload.bars["SYM|TF"]
  const cw = el("div", "su-chart");
  const key = `${s.symbol}|${s.timeframe}`;
  const bars = scan.bars && scan.bars[key];
  if (bars && Array.isArray(bars.c) && bars.c.length) {
    const cv = el("canvas");
    cw.appendChild(cv);
    requestAnimationFrame(() => drawCandles(cv, bars));
  } else {
    cw.appendChild(el("div", "nobars", "NO BARS"));
  }
  body.appendChild(cw);

  // info column
  const info = el("div", "su-info");

  // pattern chips
  const pats = el("div", "pats");
  for (const sig of (s.signals || []).slice(0, 6)) {
    const p = el("span", "chip static");
    p.appendChild(document.createTextNode(`${String(sig.pattern || "?").replace(/_/g, " ")} `));
    p.appendChild(el("b", dirClass(sig.direction), fmtNum(sig.confidence, 2)));
    p.querySelector("b").style.fontWeight = "400";
    p.title = `${sig.family || ""} · rr ${sig.rr ?? "—"}`;
    pats.appendChild(p);
  }
  if (!(s.signals || []).length) pats.appendChild(el("span", "micro dim", "NO SIGNALS"));
  info.appendChild(pats);

  // entry/stop/target/rr
  const kv = el("div", "kv");
  for (const [k, v, cls] of [
    ["ENTRY", fmtPx(s.entry), ""],
    ["STOP", fmtPx(s.stop), "down"],
    ["TARGET", fmtPx(s.target), "up"],
    ["RR", fmtNum(s.rr, 1), "cy"],
    ["LAST", fmtPx(s.last_close), ""],
    ["ATR%", s.atr_pct != null ? fmtNum(s.atr_pct * 100, 2) : "—", ""],
    ["UPDATED", s.updated_at ? timeAgo(s.updated_at * 1000) : "—", "dim"],
    ["DIR", s.direction || "—", dirClass(s.direction)],
  ]) {
    const cell = el("div");
    cell.appendChild(el("div", "kk", k));
    cell.appendChild(el("div", `vv ${cls}`, v));
    kv.appendChild(cell);
  }
  info.appendChild(kv);

  // expert votes as +/- bars
  const votes = el("div");
  for (const v of (s.votes || []).slice(0, 8)) {
    const row = el("div", "vote");
    row.appendChild(el("span", "vn", v.technique || v.expert || "?"));
    const vb = el("div", "vb bar neg");
    vb.appendChild(el("span", "mid"));
    const vs = Math.max(-1, Math.min(1, Number(v.score) || 0));
    const vf = el("i", vs >= 0 ? "pos" : "neg");
    if (vs >= 0) { vf.style.left = "50%"; vf.style.width = `${vs * 50}%`; }
    else { vf.style.left = `${50 + vs * 50}%`; vf.style.width = `${-vs * 50}%`; }
    vb.appendChild(vf);
    row.appendChild(vb);
    row.appendChild(el("span", `vs ${vs >= 0 ? "up" : "down"}`, fmtSigned(vs, 2)));
    row.title = v.note || "";
    votes.appendChild(row);
  }
  if (!(s.votes || []).length) votes.appendChild(el("div", "micro dim", "NO EXPERT VOTES"));
  info.appendChild(votes);

  // why
  const why = el("div", "why");
  for (const ln of (s.why || []).slice(0, 5)) why.appendChild(el("div", "", ln));
  info.appendChild(why);

  body.appendChild(info);
  card.appendChild(body);
  return card;
}
