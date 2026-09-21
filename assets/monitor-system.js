// K1 ▸ SYSTEM — queue depth, jobs, queue events, control failures, ping.
import {
  initTerminal, loadRecords, subscribeInserts, subscribeChanges, parseRecordRow,
  recordCounts, queueStats, dbPing,
  fmtNum, fmtUtc, usToDate, shortId, el, clear, badge,
} from "./core.js";

let jobs = [];
let qevents = [];
let cfails = [];
let counts = [];
let refreshTimer = 0;

initTerminal({ title: "SYSTEM", onAuth: start }).catch(e => console.error(e));

async function start(sb) {
  ping(sb);
  setInterval(() => ping(sb), 10000);
  await Promise.allSettled([
    loadJobs(sb), loadQEvents(sb), loadCFails(sb), loadCounts(sb), loadQueue(sb),
  ]);
  subscribeChanges(sb, "k1_jobs", "*", () => debounced(() => loadJobs(sb)));
  subscribeInserts(sb, "k1_queue_events", p => {
    if (p && p.new) { qevents.unshift(p.new); qevents = qevents.slice(0, 50); renderQEvents(); }
  });
  subscribeInserts(sb, "k1_records", p => {
    const r = p && p.new ? parseRecordRow(p.new) : null;
    if (!r) return;
    if (r._kind === "ControlFailure") { cfails.unshift(r); renderCFails(); }
    const c = counts.find(x => x.kind === r._kind);
    if (c) c.n = Number(c.n) + 1; else counts.push({ kind: r._kind, n: 1 });
    renderCounts();
  });
}

function debounced(fn) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(fn, 400);
}

async function ping(sb) {
  const ms = await dbPing(sb);
  const e = document.getElementById("ping");
  e.textContent = ms >= 0 ? `PING ${ms}ms` : "PING FAIL";
  e.style.color = ms < 0 ? "var(--down)" : ms > 800 ? "var(--amber)" : "var(--up)";
}

/* ------------------------------------------------------------------ queue */
async function loadQueue(sb) {
  const qs = await queueStats(sb);
  const bar = clear(document.getElementById("qchips"));
  bar.appendChild(el("span", "micro", "QUEUE ▸"));
  const byKey = {};
  for (const r of qs) {
    const k = `${r.state}|${r.workload || ""}`;
    byKey[k] = (byKey[k] || 0) + (Number(r.n) || 0);
  }
  if (!qs.length) { bar.appendChild(el("span", "micro dim", "NO QUEUE DATA YET — the scheduler has not published stats")); return; }
  const tot = {};
  for (const r of qs) tot[r.state] = (tot[r.state] || 0) + (Number(r.n) || 0);
  const stateTips = {
    queued: "waiting to be picked up",
    leased: "claimed by a worker, running now",
    completed: "finished",
    dead_letter: "failed after all retries — needs review",
  };
  for (const s of ["queued", "leased", "completed", "dead_letter"]) {
    const chip = el("span", "chip static");
    chip.appendChild(document.createTextNode(`${s.toUpperCase()} `));
    chip.appendChild(el("b", s === "dead_letter" && tot[s] ? "down" : "cy", fmtNum(tot[s] || 0, 0)));
    chip.querySelector("b").style.fontWeight = "400";
    chip.title = `${s} — ${stateTips[s]}`;
    bar.appendChild(chip);
  }
  bar.appendChild(el("span", "dim", "|"));
  for (const [k, n] of Object.entries(byKey).sort()) {
    const [st, wl] = k.split("|");
    bar.appendChild(el("span", "micro dim", `${st}/${wl || "-"} ${fmtNum(n, 0)}`));
  }
}

/* ------------------------------------------------------------------- jobs */
async function loadJobs(sb) {
  const { data, error } = await sb.from("k1_jobs").select("*")
    .order("created_us", { ascending: false }).limit(100);
  if (!error && data) jobs = data;
  renderJobs();
}

function jobRole(payload) {
  try {
    const p = JSON.parse(payload);
    return p.role || p.kind || p.type || "—";
  } catch { return "—"; }
}

function renderJobs() {
  const tb = document.getElementById("jobs").tBodies[0];
  clear(tb);
  document.getElementById("jobs-empty").classList.toggle("hidden", jobs.length > 0);
  for (const j of jobs) {
    const tr = el("tr");
    tr.appendChild(el("td", "dim", fmtUtc(usToDate(j.created_us))));
    tr.appendChild(el("td", "", shortId(j.id, 14)));
    tr.appendChild(el("td", "cy", jobRole(j.payload)));
    tr.appendChild(el("td", "dim", j.workload || ""));
    tr.appendChild(el("td", "dim", j.priority ?? ""));
    const st = el("td"); st.appendChild(badge(j.state || "?")); tr.appendChild(st);
    tr.appendChild(el("td", "num", `${j.attempts ?? 0}/${j.max_attempts ?? "?"}`));
    tr.appendChild(el("td", "dim", shortId(j.worker_id || "—", 12)));
    const er = el("td", j.last_error ? "down wrap" : "dim", (j.last_error || "").slice(0, 80) || "—");
    if (j.last_error) er.title = j.last_error;
    tr.appendChild(er);
    tb.appendChild(tr);
  }
}

/* ------------------------------------------------------------- queue evts */
async function loadQEvents(sb) {
  const { data, error } = await sb.from("k1_queue_events").select("*")
    .order("sequence", { ascending: false }).limit(50);
  if (!error && data) qevents = data;
  renderQEvents();
}

function renderQEvents() {
  const tb = document.getElementById("qevents").tBodies[0];
  clear(tb);
  document.getElementById("qe-n").textContent = `${qevents.length} EVENTS`;
  for (const e of qevents) {
    const tr = el("tr");
    tr.appendChild(el("td", "num dim", fmtNum(e.sequence, 0)));
    tr.appendChild(el("td", "dim", fmtUtc(usToDate(e.at_us))));
    tr.appendChild(el("td", "", shortId(e.job_id, 12)));
    tr.appendChild(el("td", "cy", String(e.event || "").toUpperCase()));
    tr.appendChild(el("td", "dim", shortId(e.worker_id || "—", 10)));
    const d = el("td", "dim wrap", (e.details || "").slice(0, 90));
    if (e.details && e.details.length > 90) d.title = e.details;
    tr.appendChild(d);
    tb.appendChild(tr);
  }
}

/* -------------------------------------------------------- control failures */
async function loadCFails(sb) {
  cfails = await loadRecords(sb, "ControlFailure", { limit: 50 });
  renderCFails();
}

function renderCFails() {
  const tb = document.getElementById("cfail").tBodies[0];
  clear(tb);
  if (!cfails.length) {
    const tr = el("tr");
    const td = el("td", "dim", "NONE");
    td.colSpan = 6;
    tr.appendChild(td);
    tb.appendChild(tr);
    return;
  }
  for (const f of cfails) {
    const tr = el("tr");
    tr.appendChild(el("td", "dim", fmtUtc(usToDate(f._available_us))));
    tr.appendChild(el("td", "amb", f.stage || "?"));
    tr.appendChild(el("td", "", shortId(f.target_id, 14)));
    tr.appendChild(el("td", "num", fmtNum(f.attempt, 0)));
    tr.appendChild(el("td", "down", f.error_code || "?"));
    const bd = el("td"); bd.appendChild(badge(f.blocked ? "BLOCKED" : "OK")); tr.appendChild(bd);
    tb.appendChild(tr);
  }
}

/* ---------------------------------------------------------- record counts */
async function loadCounts(sb) {
  counts = await recordCounts(sb);
  renderCounts();
}

function renderCounts() {
  const tb = document.getElementById("rcounts").tBodies[0];
  clear(tb);
  const rows = [...counts].sort((a, b) => Number(b.n) - Number(a.n));
  let tot = 0;
  for (const r of rows) {
    tot += Number(r.n) || 0;
    const tr = el("tr");
    tr.appendChild(el("td", "", r.kind));
    tr.appendChild(el("td", "num cy", fmtNum(r.n, 0)));
    tb.appendChild(tr);
  }
  document.getElementById("rc-tot").textContent = `${fmtNum(tot, 0)} TOTAL`;
}
