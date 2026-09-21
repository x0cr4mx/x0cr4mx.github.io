// K1 TERMINAL — guided tour. Auto-starts once per page after auth
// (localStorage = source of truth); "?" restarts. Never blocks init/realtime.
import { createSb } from "./core.js";

const FLAG = "k1_tour_v1_done";   // index; other pages append .<page>
const AUTO_DELAY_MS = 600, GAP = 12, MARGIN = 8;
const gid = id => document.getElementById(id);
const qs = s => document.querySelector(s);

/* strings — all user-facing copy lives here (i18n-ready) */
const STRINGS = {
  ui: {
    tourButton: "?",
    tourButtonAria: "Open guided tour",
    stepLabel: "STEP {step}/{total}",
    back: "◂ BACK", next: "NEXT ▸", skip: "SKIP", done: "DONE ✓",
    backAria: "Back", nextAria: "Next step", skipAria: "Skip tour", doneAria: "Finish tour",
  },
  tours: {
    index: [
      { target: "body", placement: "center", title: "WELCOME TO K1",
        body: "Your mission control for a market AI. Everything here is a simulation — paper money only, nothing real, no investment advice." },
      { target: ".topbar", placement: "bottom", title: "STATUS BAR",
        body: "Green LIVE = streaming, amber CONN = connecting, red DOWN = offline. Clock is always UTC." },
      { target: ".tape", placement: "bottom", title: "PRICE TICKER",
        body: "Latest price and % change for every symbol the terminal watches." },
      { target: "#p-markets", placement: "auto", title: "MARKET CHART",
        body: "Each candle shows where the price went in one time block. Dropdowns switch symbol or timeframe." },
      { target: "#p-patterns", placement: "auto", title: "PATTERN SCANNER",
        body: "The bot's best chart-pattern finds. SCORE = strength, RR = reward vs risk, QUALITY = confidence." },
      { target: "#p-world", placement: "auto", title: "WORLD RISK",
        body: "Which countries make the most conflict news — big world events move markets, so the AI watches the globe." },
      { target: "#p-decisions", placement: "auto", title: "AI DECISIONS",
        body: "The AI's calls — buy, sell, or stay out — with its confidence. Simulated; it never touches real money." },
      { target: "#p-paper", placement: "auto", title: "PAPER TRADING",
        body: "The AI trading with fake money: profit, open trades, fees. A sandbox to learn in — never real gains or losses." },
      { target: "#p-top9", placement: "auto", title: "TOP 9 — YOU'RE SET",
        body: "The 9 best detections right now. Every POP OUT opens a full page. Replay this tour with the ? button — SIGN OUT is up top." },
    ],
    "monitor/markets": [
      { target: "#grid", placement: "auto", title: "EVERY CHART AT ONCE",
        body: "One small chart per market and timeframe — the full wall behind the MARKETS panel." },
      { target: "#anoms", placement: "top", title: "ANOMALY STRIP",
        body: "Flags unusual price moves — a spike, gap, or weird volume." },
      { target: ".topbar a.btn", placement: "bottom", title: "BACK TO BASE",
        body: "TERMINAL takes you back to the main dashboard." },
    ],
    "monitor/patterns": [
      { target: "#scan-bar", placement: "bottom", title: "SCAN STATUS",
        body: "When the last scan ran, how many markets were checked, and if the data feeds are healthy." },
      { target: "#grid", placement: "auto", title: "SETUP CARDS",
        body: "Each card is a pattern the bot spotted: mini chart, entry, stop, target, and why it flagged it. Paper only." },
      { target: ".topbar a.btn", placement: "bottom", title: "BACK TO BASE",
        body: "TERMINAL returns you to the main dashboard." },
    ],
    "monitor/decisions": [
      { target: "#filters", placement: "bottom", title: "FILTER CHIPS",
        body: "Tap a chip to narrow the list — by direction or symbol. Tap again to clear." },
      { target: "#ledger", placement: "auto", title: "DECISION LEDGER",
        body: "Every AI decision, newest first. Click a row for its reasoning. Simulated — no real trades." },
      { target: ".topbar a.btn", placement: "bottom", title: "BACK TO BASE",
        body: "TERMINAL returns you to the main dashboard." },
    ],
    "monitor/geo": [
      { target: "iframe", placement: "center", title: "THE GLOBE, EMBEDDED",
        body: "The whole World Watcher app lives in this frame — same globe, same feed, with the K1 bar on top." },
      { target: "#conn-dot", placement: "bottom", title: "A THIN SHELL",
        body: "Just a wrapper for /world/ — the globe has its own status in the frame." },
      { target: ".topbar a.btn", placement: "bottom", title: "BACK TO BASE",
        body: "TERMINAL returns you to the main dashboard." },
    ],
    "monitor/paper": [
      { target: ".stats", placement: "bottom", title: "SCOREBOARD",
        body: "The fake-money account at a glance: trades, win rate, profit, fees, worst losing streak." },
      { target: ".grow", placement: "auto", title: "EQUITY CURVE",
        body: "The running profit line. Up and to the right means the paper account is growing; dips are losing trades. Not real money." },
      { target: ".two-col", placement: "auto", title: "TRADE TABLES",
        body: "Left: every closed fake trade. Right: positions still open and how they're doing." },
      { target: ".topbar a.btn", placement: "bottom", title: "BACK TO BASE",
        body: "TERMINAL returns you to the main dashboard." },
    ],
    "monitor/system": [
      { target: "#qchips", placement: "bottom", title: "WORK QUEUE",
        body: "The AI's to-do list: QUEUED = waiting, LEASED = in progress, COMPLETED = done, DEAD_LETTER = failed." },
      { target: ".two-col", placement: "auto", title: "UNDER THE HOOD",
        body: "Left: jobs and errors. Right: queue events, failures, record counts. Diagnostics — safe to ignore." },
      { target: ".topbar a.btn", placement: "bottom", title: "BACK TO BASE",
        body: "TERMINAL returns you to the main dashboard." },
    ],
    "monitor/top9": [
      { target: "#t9-bar", placement: "bottom", title: "DETECTION STATUS",
        body: "New/analyzed counts, last update, and REFRESH — the page also re-checks every minute." },
      { target: "#grid", placement: "auto", title: "TOP 9 CARDS",
        body: "The 9 highest-rated patterns: chart snapshot, plain description, suggested entry, stop and target." },
      { target: ".disclaimer", placement: "top", title: "READ THIS LINE",
        body: "Paper trading only — nothing here executes real orders or is investment advice. It's a research tool." },
      { target: ".topbar a.btn", placement: "bottom", title: "BACK TO BASE",
        body: "TERMINAL returns you to the main dashboard." },
    ],
    world: [
      { target: "#left-panel", placement: "right", title: "RISK RANKING",
        body: "Countries scored by conflict news volume — red means critical. Search or click a country below." },
      { target: "#globe-wrap", placement: "auto", title: "THE GLOBE",
        body: "Drag to spin, scroll to zoom, click a country for its live feed. Colors match the risk scale; pulses = breaking news." },
      { target: "#right-panel", placement: "left", title: "NEWS & CHARTS",
        body: "Three tabs: LIVE FEED headlines you can filter, COUNTRY detail for what you clicked, ANALYTICS trend charts." },
      { target: "#statusbar", placement: "top", title: "DATA VITALS",
        body: "GDELT news data refreshed ~every 15 min, plus article/country counts. ← TERMINAL goes home." },
    ],
  },
};

/* detect page by DOM landmarks, not URL — safe under any deploy path */
const PAGE_DETECT = [
  ["index",            () => gid("p-markets") && gid("p-top9")],
  ["monitor/markets",  () => qs(".chart-grid")],
  ["monitor/patterns", () => gid("scan-bar")],
  ["monitor/decisions",() => gid("ledger")],
  ["monitor/geo",      () => qs('iframe[src*="/world"]')],
  ["monitor/paper",    () => gid("curve") && gid("closed")],
  ["monitor/system",   () => gid("qchips")],
  ["monitor/top9",     () => gid("t9-bar")],
  ["world",            () => gid("globe") && gid("risk-list")],
];
function detectPage() {
  for (const [p, test] of PAGE_DETECT) if (test()) return p;
  return null;
}
const flagKey = p => p === "index" ? FLAG : `${FLAG}.${p}`;

let _sb = null;   // supabase client from k1:authed

// /world/ has no auth gate → detect supabase-js session key directly
function hasLocalSession() {
  try {
    const ref = new URL((window.K1_ENV || {}).SUPABASE_URL).host.split(".")[0];
    const s = JSON.parse(localStorage.getItem(`sb-${ref}-auth-token`) || "null");
    return !!(s && s.access_token);
  } catch { return false; }
}

function markDone(page) {
  try { localStorage.setItem(flagKey(page), "1"); } catch {}
  try {   // best-effort remote marker; localStorage is source of truth
    (_sb || createSb()).auth.updateUser({ data: { k1_tour_seen: true } }).catch(() => {});
  } catch {}
}

let _tour = null; // { page, steps, i, prevFocus } + DOM refs from buildDom

function resolveTarget(step) {
  const el = step.target === "body" ? document.body : qs(step.target);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0 ? el : null;   // hidden = missing
}

function buildDom() {
  const d = document.createElement("div");
  const back = d.cloneNode(), spot = d.cloneNode(), tip = d.cloneNode();
  back.className = "k1tour-back";
  spot.className = "k1tour-spot";
  tip.className = "k1tour-tip";
  tip.tabIndex = -1;
  tip.setAttribute("role", "dialog");
  tip.setAttribute("aria-modal", "true");
  tip.setAttribute("aria-labelledby", "k1tour-title");
  tip.setAttribute("aria-describedby", "k1tour-body");
  tip.innerHTML = // static markup only — copy goes in via textContent
    `<div class="k1tour-h" aria-live="polite"><span class="k1tour-step"></span>` +
    `<span class="k1tour-title" id="k1tour-title"></span></div>` +
    `<div class="k1tour-b" id="k1tour-body"></div>` +
    `<div class="k1tour-f"><button type="button" class="k1tour-btn"></button>` +
    `<span class="sp"></span><button type="button" class="k1tour-btn"></button>` +
    `<button type="button" class="k1tour-btn primary"></button></div>`;
  const [backBtn, skipBtn, nextBtn] = tip.querySelectorAll(".k1tour-btn");
  backBtn.textContent = STRINGS.ui.back;
  skipBtn.textContent = STRINGS.ui.skip;
  backBtn.setAttribute("aria-label", STRINGS.ui.backAria);
  skipBtn.setAttribute("aria-label", STRINGS.ui.skipAria);
  backBtn.onclick = () => show(_tour.i - 1);
  skipBtn.onclick = () => endTour(true);
  nextBtn.onclick = () => _tour.i >= _tour.steps.length - 1 ? endTour(true) : show(_tour.i + 1);
  document.body.append(back, spot, tip);
  return {
    back, spot, tip, backBtn, nextBtn,
    stepEl: tip.querySelector(".k1tour-step"),
    titleEl: tip.querySelector(".k1tour-title"),
    bodyEl: tip.querySelector(".k1tour-b"),
  };
}

function placeTip(r, pref, W, H) {
  const vw = innerWidth, vh = innerHeight;
  const space = { top: r.top, bottom: vh - r.bottom, left: r.left, right: vw - r.right };
  const sides = ["bottom", "top", "right", "left"];
  const order = pref && pref !== "auto"
    ? [pref, ...sides.filter(s => s !== pref)]
    : [...sides].sort((a, b) => space[b] - space[a]);
  const xy = s =>
    s === "bottom" ? [r.left + r.width / 2 - W / 2, r.bottom + GAP] :
    s === "top"    ? [r.left + r.width / 2 - W / 2, r.top - H - GAP] :
    s === "right"  ? [r.right + GAP, r.top + r.height / 2 - H / 2] :
                     [r.left - W - GAP, r.top + r.height / 2 - H / 2];
  for (const s of order) {
    const [x, y] = xy(s);
    if (x >= MARGIN && x + W <= vw - MARGIN && y >= MARGIN && y + H <= vh - MARGIN) return { x, y };
  }
  const [x, y] = xy(order[0]);   // nothing fits → clamp to best side
  return {
    x: Math.min(Math.max(x, MARGIN), Math.max(MARGIN, vw - W - MARGIN)),
    y: Math.min(Math.max(y, MARGIN), Math.max(MARGIN, vh - H - MARGIN)),
  };
}

function layout() {
  const t = _tour;
  if (!t) return;
  const el = resolveTarget(t.steps[t.i]);
  const { tip, spot } = t;
  if (el && el !== document.body) {
    el.scrollIntoView({ block: "nearest" });
    const r = el.getBoundingClientRect();
    spot.classList.remove("free");
    spot.style.left = `${r.left - 4}px`;
    spot.style.top = `${r.top - 4}px`;
    spot.style.width = `${r.width + 8}px`;
    spot.style.height = `${r.height + 8}px`;
    const p = placeTip(r, t.steps[t.i].placement, tip.offsetWidth, tip.offsetHeight);
    tip.style.left = `${p.x}px`;
    tip.style.top = `${p.y}px`;
  } else {
    spot.classList.add("free");
    tip.style.left = `${Math.max(MARGIN, (innerWidth - tip.offsetWidth) / 2)}px`;
    tip.style.top = `${Math.max(MARGIN, (innerHeight - tip.offsetHeight) / 2)}px`;
  }
}

function show(i) {
  const t = _tour;
  if (!t) return;
  while (i < t.steps.length && !resolveTarget(t.steps[i])) i++;   // graceful skip
  if (i >= t.steps.length) return endTour(true);
  while (i >= 0 && !resolveTarget(t.steps[i])) i--;
  if (i < 0) return endTour(true);
  t.i = i;
  const s = t.steps[i];
  t.stepEl.textContent = STRINGS.ui.stepLabel
    .replace("{step}", String(i + 1)).replace("{total}", String(t.steps.length));
  t.titleEl.textContent = s.title;
  t.bodyEl.textContent = s.body;
  t.backBtn.disabled = i === 0;
  const last = i === t.steps.length - 1;
  t.nextBtn.textContent = last ? STRINGS.ui.done : STRINGS.ui.next;
  t.nextBtn.setAttribute("aria-label", last ? STRINGS.ui.doneAria : STRINGS.ui.nextAria);
  layout();
  requestAnimationFrame(() => { layout(); t.tip.focus({ preventScroll: true }); });
}

function onKey(e) {
  if (!_tour) return;
  if (e.key === "Escape") { e.preventDefault(); endTour(true); return; }
  if (e.key !== "Tab") return;
  const f = [..._tour.tip.querySelectorAll("button:not([disabled])")];
  if (!f.length) return;
  const a = document.activeElement;
  // membership test (not contains): the focused tip container must not escape
  if (!f.includes(a)) { (e.shiftKey ? f[f.length - 1] : f[0]).focus(); e.preventDefault(); return; }
  if (e.shiftKey && a === f[0]) { f[f.length - 1].focus(); e.preventDefault(); }
  else if (!e.shiftKey && a === f[f.length - 1]) { f[0].focus(); e.preventDefault(); }
}

function startTour(page) {
  const steps = STRINGS.tours[page];
  if (!steps || !steps.length) return;
  if (_tour) endTour(false);
  _tour = { page, steps, i: 0, prevFocus: document.activeElement, ...buildDom() };
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", layout);
  window.addEventListener("scroll", layout, true);
  show(0);
}

function endTour(done) {
  if (!_tour) return;
  const page = _tour.page, prev = _tour.prevFocus;
  document.removeEventListener("keydown", onKey, true);
  window.removeEventListener("resize", layout);
  window.removeEventListener("scroll", layout, true);
  for (const n of [_tour.back, _tour.spot, _tour.tip]) n.remove();
  _tour = null;
  if (prev && prev.isConnected) prev.focus({ preventScroll: true });
  if (done) markDone(page);
}

function maybeAutoStart() {
  const page = detectPage();
  if (!page || _tour) return;
  try { if (localStorage.getItem(flagKey(page))) return; } catch { return; }
  if (page === "world" && (window.top !== window.self || !hasLocalSession())) return;
  setTimeout(() => startTour(page), AUTO_DELAY_MS);
}

function installHelpButton() {
  const page = detectPage();
  if (!page || qs(".k1tour-help")) return;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn k1tour-help";
  b.textContent = STRINGS.ui.tourButton;
  b.setAttribute("aria-label", STRINGS.ui.tourButtonAria);
  b.onclick = () => startTour(page);
  const topbar = qs(".topbar");
  if (topbar) { topbar.insertBefore(b, gid("signout")); return; }
  const links = qs("#k1bar .k1-links");
  if (links) links.appendChild(b);
}

installHelpButton();   // module scripts deferred → DOM already parsed
// world/ has no auth gate; core pages fire k1:authed when initTerminal resolves
if (detectPage() === "world") maybeAutoStart();
window.addEventListener("k1:authed", e => { _sb = (e.detail || {}).sb || _sb; maybeAutoStart(); });
if (window.__k1Authed) { _sb = window.__k1Sb || _sb; maybeAutoStart(); }

// console hooks for the runbook: K1Tour.start() / .reset() / .stop()
window.K1Tour = {
  start: () => { const p = detectPage(); if (p) startTour(p); },
  reset: () => {
    for (const k of Object.keys(localStorage))
      if (k === FLAG || k.startsWith(`${FLAG}.`)) localStorage.removeItem(k);
    const p = detectPage();
    if (p) startTour(p);
  },
  stop: () => endTour(false),
};
