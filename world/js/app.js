/* ============ WORLD WATCHER — app orchestrator ============ */
(() => {
"use strict";

const S = {
  meta: {}, sources: {}, geojson: null,
  countryState: {},          // iso3 -> {score, level, share, points, base, tone, articles[], flashUntil, flashColor}
  feed: [], feedFilter: "all",
  selected: null,
  globe: null,
  live: false, lastUpdate: null,
  conflictPoints: [],        // [{lat,lng,r,color,name}]
  countryShare: {},          // iso3 -> % conflict coverage
  countryPts: {},            // iso3 -> menzioni conflitto (CAMEO export)
  countryEsc: {},            // iso3 -> menzioni escalation (proteste/coercion)
  prevEventTotals: null,     // iso3 -> totale menzioni all'ultimo ingest eventi
  toneSeries: [],
  dataMode: "boot",
};

const $ = (id) => document.getElementById(id);
const esc = (s) => (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ================= BOOT ================= */
async function boot() {
  const [geo, meta, src] = await Promise.all([
    fetch("data/countries.geojson").then((r) => r.json()),
    fetch("data/country-meta.json").then((r) => r.json()),
    fetch("data/sources.json").then((r) => r.json()),
  ]);
  S.geojson = geo; S.meta = meta; S.sources = src;
  // normalizza id non-ISO del geojson (verifica antagonista: CS-KM/-99)
  for (const f of geo.features) {
    if (f.id === "CS-KM") f.id = "KOS";
    else if (f.id === "-99") {
      const n = f.properties?.name;
      if (n === "Somaliland") f.id = "SOL";
      else if (n === "Northern Cyprus") f.id = "XNC";
    }
  }
  GeoUtil.init(geo);
  Analytics.initMaps(meta);
  for (const iso3 of Object.keys(meta))
    S.countryState[iso3] = { score: 0, level: WW_CONFIG.RISK_LEVELS.at(-1), share: 0, points: 0, base: WW_BASELINE_FALLBACK[iso3] ?? 15, tone: 0, articles: [], flashUntil: 0, flashColor: "#ffb000", seen: new Set() };

  initGlobe();
  initUI();
  // baseline immediata: colora i paesi col rischio editoriale prima del primo fetch
  recomputeRisk();
  renderAll();

  try {
    const snap = await fetch("data/snapshot.json").then((r) => (r.ok ? r.json() : null));
    if (snap && snap.articles && snap.articles.length) {
      ingestArticles(snap.articles, { silent: true });
      if (snap.share) applyShare(snap.share);
      if (snap.tone) S.toneSeries = snap.tone;
      const snapEv = snap.events
        || (snap.conflict_points && snap.conflict_points.length
          ? {
              points: snap.conflict_points.map((p) => ({ lat: p.lat, lng: p.lon, name: p.name || "", count: p.count || 1 })),
              countries: snap.countries || {},
              escalation: snap.escalation || {},
            }
          : null);
      if (snapEv && (snapEv.points?.length || Object.keys(snapEv.countries || {}).length))
        ingestEvents(snapEv);
      for (const st of Object.values(S.countryState)) st.flashUntil = 0; // niente flash su snapshot
      renderAll();
      S.dataMode = "snapshot";
      // keep the status bar truthful before the first live refresh lands:
      // without this it stays "ARTICLES: 0 · LAST: —" while the snapshot
      // feed is already on screen
      setFeedChip("warn", "CACHED");
      updateStatusBar();
    }
  } catch {}

  refresh();
  setInterval(refresh, WW_CONFIG.REFRESH_MS);
  setInterval(flashTick, 450);
}

/* ================= GLOBE ================= */
function initGlobe() {
  const el = $("globe");
  const g = Globe()(el)
    .width(el.clientWidth).height(el.clientHeight)
    .backgroundColor("rgba(0,0,0,0)")
    .globeImageUrl("img/earth-night.jpg")
    .showAtmosphere(true).atmosphereColor("#3a4a6b").atmosphereAltitude(0.16);

  g.polygonsData(S.geojson.features)
    .polygonCapColor((f) => capColor(f))
    .polygonSideColor(() => "rgba(15,17,24,0.65)")
    .polygonStrokeColor(() => "rgba(140,150,170,0.35)")
    .polygonAltitude((f) => (S.countryState[f.id]?.level.key === "crit" ? 0.028 : 0.008))
    .polygonsTransitionDuration(300)
    .onPolygonClick((f) => f && selectCountry(f.id))
    .onPolygonHover((f, prev) => hoverCountry(f, prev))
    .polygonLabel(() => "");

  // punti conflitto
  g.pointsData(S.conflictPoints)
    .pointLat("lat").pointLng("lng")
    .pointColor("color").pointAltitude("alt").pointRadius("r");

  // anelli pulsanti per breaking news
  g.ringsData([])
    .ringLat("lat").ringLng("lng")
    .ringColor((r) => (t) => r.color.replace("ALPHA", String(1 - t)))
    .ringMaxRadius(5).ringPropagationSpeed(1.6).ringRepeatPeriod(1400);

  // stelle di sfondo leggere
  g.customLayerData([]);
  const ctrl = g.controls();
  ctrl.autoRotate = true; ctrl.autoRotateSpeed = 0.55;
  ctrl.enableZoom = true; ctrl.minDistance = 140; ctrl.maxDistance = 500;
  g.pointOfView({ lat: 25, lng: 15, altitude: 2.3 });
  S.globe = g;

  new ResizeObserver(() => { const b = el.getBoundingClientRect(); g.width(b.width).height(b.height); }).observe(el);
}

// hex "#rrggbb" -> "rgba(r,g,b,a)" — i cap semi-trasparenti lasciano
// vedere la texture terrestre sotto i paesi (globo leggibile)
const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

function capColor(f) {
  const st = S.countryState[f.id];
  if (!st) return "rgba(16,16,24,0.5)";
  if (st.flashUntil > performance.now()) {
    const t = (st.flashUntil - performance.now()) / 1000;
    return Math.floor(t * 6) % 2 === 0 ? rgba(st.flashColor, 0.92) : "rgba(26,26,34,0.55)";
  }
  return rgba(st.level.color, 0.8);
}

let flashActive = false;
function flashTick() {
  const now = performance.now();
  let active = false;
  for (const st of Object.values(S.countryState)) if (st.flashUntil > now) { active = true; break; }
  // re-apply anche all'ultimo tick: globe.gl valuta gli accessor solo quando
  // vengono re-impostati — senza, i poligoni restano congelati sul colore
  // del flash fino al prossimo refresh
  if (active || flashActive) S.globe.polygonCapColor(capColor);
  flashActive = active;
}

function hoverCountry(f) {
  const tip = $("tooltip");
  if (!f) { tip.classList.add("hidden"); return; }
  const st = S.countryState[f.id], m = S.meta[f.id];
  if (!st || !m) return;
  const warArts = (st.articles || []).filter((a) => a.tags.includes("war")).length;
  tip.innerHTML =
    `<div class="tt-name">${esc(m.name)} <span style="color:${st.level.color}">■</span></div>` +
    `<div class="tt-risk">RISK <b style="color:${st.level.color}">${st.score}</b> · ${st.level.label}` +
    (st.hasData ? "" : ` <span style="color:#777">· baseline only</span>`) +
    (st.share ? ` · conflict coverage ${st.share.toFixed(1)}%` : "") + `</div>` +
    `<div class="tt-news">${st.articles.length} live articles` + (warArts ? ` · <span style="color:#ff6b6b">${warArts} conflict</span>` : "") + `</div>`;
  tip.classList.remove("hidden");
}
document.addEventListener("mousemove", (e) => {
  const tip = $("tooltip");
  if (tip.classList.contains("hidden")) return;
  const r = $("globe-wrap").getBoundingClientRect();
  tip.style.left = Math.min(e.clientX - r.left + 14, r.width - 270) + "px";
  tip.style.top = (e.clientY - r.top + 10) + "px";
});

/* ================= DATA PIPELINE ================= */
function ingestArticles(articles, { silent = false } = {}) {
  const now = performance.now();
  // dedup dentro il batch stesso (GDELT può ripetere URL)
  const inBatch = new Set();
  articles = articles.filter((a) => a.url && !inBatch.has(a.url) && inBatch.add(a.url));
  for (const a of articles) {
    a.tags = Analytics.classify(a.title || "");
    a.ts = parseSeen(a.seendate);
  }
  // merge nel feed (dedup su url)
  const have = new Set(S.feed.map((a) => a.url));
  const fresh = articles.filter((a) => !have.has(a.url));
  S.feed = S.feed.concat(fresh).sort((x, y) => (y.ts || 0) - (x.ts || 0)).slice(0, 400);

  // distribuisci ai paesi per sourcecountry
  const byC = Analytics.bySourceCountry(articles);
  for (const [iso3, arts] of Object.entries(byC)) {
    const st = S.countryState[iso3];
    if (!st) continue;
    const fresh = arts.filter((a) => !st.seen.has(a.url));
    for (const a of fresh) { st.seen.add(a.url); st.articles.push(a); }
    st.articles.sort((x, y) => (y.ts || 0) - (x.ts || 0));
    st.articles = st.articles.slice(0, 30);
    // bound memoria: seen tiene gli ultimi ~120 url per paese
    if (st.seen.size > 120) st.seen = new Set([...st.seen].slice(-80));
    // flash SOLO su articoli davvero nuovi (fix antagonista #14)
    if (!silent && fresh.length) {
      const important = fresh.find((a) => a.tags.includes("war")) || fresh.find((a) => a.tags.includes("politics") || a.tags.includes("econ"));
      if (important) {
        const isWar = important.tags.includes("war");
        if (isWar || st.score >= 30) triggerFlash(iso3, isWar ? "#ff2d2d" : "#ffb000", 10, important);
      }
    }
  }
}

function triggerFlash(iso3, color, secs, article) {
  const st = S.countryState[iso3];
  if (!st) return;
  st.flashUntil = Math.max(st.flashUntil || 0, performance.now() + secs * 1000);
  st.flashColor = color;
  const m = S.meta[iso3];
  if (m && color === "#ff2d2d") {
    // anello pulsante sul paese per news di guerra
    const rings = S.globe.ringsData();
    rings.push({ lat: m.centroid[1], lng: m.centroid[0], color: "rgba(255,45,45,ALPHA)", t0: Date.now() });
    S.globe.ringsData(rings.filter((r) => Date.now() - r.t0 < 30000));
  }
}

function parseSeen(s) {
  // seendate "20260920T081500Z" (GDELT) o RFC 822 pubDate (Google News)
  if (!s) return 0;
  const m = s.match(/(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  const d = Date.parse(s);
  return isNaN(d) ? 0 : d;
}

let refreshing = false;
async function refresh() {
  if (refreshing) return;          // fix antagonista #13: no overlap
  refreshing = true;
  try {
    await _refresh();
  } finally {
    refreshing = false;
  }
}

async function _refresh() {
  setFeedChip("warn", "UPDATING");
  let ok = false;      // any data at all (live or cache)
  let liveOk = false;  // at least one branch returned fresh (non-cached) data

  // 1) eventi conflitto CAMEO via server.py /api/events (export GDELT 15-min)
  const ev = await Gdelt.events();
  if (ev && (ev.points?.length || ev.countries)) {
    ok = true; liveOk = true;   // server-side fetch, always fresh
    ingestEvents(ev);
  }

  // 2) feed globale major news
  const feed = await Gdelt.artlist(WW_CONFIG.Q_MAJOR, { maxrecords: 250, timespan: "24h", sort: "hybridrel" });
  if (feed && feed.articles && !feed.error) {
    ok = true;
    if (!feed.cached) liveOk = true;
    ingestArticles(feed.articles);
  }

  // 3) share di copertura conflitto per paese-fonte
  const tsc = await Gdelt.timelineSourceCountry(WW_CONFIG.Q_CONFLICT, { timespan: "7d" });
  if (tsc && !tsc.error) {
    const share = parseTimelineSourceCountry(tsc);
    if (share) {
      applyShare(share); applyShareFallbackPoints();
      ok = true;
      if (!tsc.cached) liveOk = true;
    }
  }

  // 4) tono globale conflitto
  const tt = await Gdelt.timelineTone(WW_CONFIG.Q_CONFLICT, { timespan: "7d" });
  if (tt && !tt.error) {
    const ser = parseTimeline(tt);
    if (ser && ser.length) {
      S.toneSeries = ser; ok = true;
      if (!tt.cached) liveOk = true;
    }
  }

  // 5) se paese selezionato, refresh headline nazionali
  if (S.selected) await loadCountryNews(S.selected, { bg: true });

  recomputeRisk();
  // ri-applica gli accessor del globo (colori, altitudini, punti)
  S.globe.polygonCapColor(capColor);
  S.globe.polygonAltitude((f) => (S.countryState[f.id]?.level.key === "crit" ? 0.028 : 0.008));
  S.globe.pointsData(S.conflictPoints);
  renderAll();
  if (ok) {
    S.live = true;
    S.dataMode = liveOk ? "live" : "snapshot";
    S.lastUpdate = new Date();
    // truthful chip: only claim LIVE when something actually came down the
    // wire this cycle — cache hits are CACHED, not live
    setFeedChip(liveOk ? "on" : "warn", liveOk ? "LIVE" : "CACHED");
  } else {
    setFeedChip("err", S.dataMode === "snapshot" ? "CACHED" : "OFFLINE");
  }
  updateStatusBar();
}

/* eventi CAMEO dal server: {points:[{lat,lng,name,iso,count,tone}],
   countries:{iso3:mentions}, escalation:{iso3:mentions}} */
function ingestEvents(ev) {
  S.conflictPoints = (ev.points || []).map((p) => ({
    lat: p.lat, lng: p.lng,
    r: 0.22 + Math.min(0.55, (p.count || 1) / 60),
    alt: 0.015, color: "#ff2d2d", name: p.name || "",
  }));
  S.countryPts = {};
  for (const [iso3, v] of Object.entries(ev.countries || {}))
    if (S.countryState[iso3]) S.countryPts[iso3] = v;
  // backfill: punti senza country-code → reverse-geocoding sui poligoni
  for (const p of ev.points || [])
    if (!p.iso) {
      const iso3 = GeoUtil.locate(p.lng, p.lat);
      if (iso3 && S.countryState[iso3])
        S.countryPts[iso3] = (S.countryPts[iso3] || 0) + (p.count || 1);
    }
  S.countryEsc = {};
  for (const [iso3, v] of Object.entries(ev.escalation || {}))
    if (S.countryState[iso3]) S.countryEsc[iso3] = v;
  const hit = new Set([...Object.keys(S.countryPts), ...Object.keys(S.countryEsc)]);
  // flash SOLO su escalation reale: paesi le cui menzioni crescono rispetto
  // all'ingest precedente (max 6) — altrimenti ogni refresh fa lampeggiare
  // mezzo mondo e la mappa resta rossa in permanenza
  const totals = {};
  for (const iso3 of hit) totals[iso3] = (S.countryPts[iso3] || 0) + (S.countryEsc[iso3] || 0);
  const prev = S.prevEventTotals;
  if (prev) {
    const grew = [...hit]
      .filter((i) => totals[i] > (prev[i] || 0))
      .sort((a, b) => totals[b] - totals[a])
      .slice(0, 6);
    for (const iso3 of grew) triggerFlash(iso3, "#ff2d2d", 12, null);
  }
  S.prevEventTotals = totals;
}

/* fallback senza server: punti pseudo dai centroidi, scalati per share */
function applyShareFallbackPoints() {
  if (S.conflictPoints.length) return;
  S.conflictPoints = Object.entries(S.countryShare)
    .filter(([iso3, v]) => v >= 15 && S.meta[iso3])
    .map(([iso3, v]) => ({
      lat: S.meta[iso3].centroid[1], lng: S.meta[iso3].centroid[0],
      r: 0.15 + Math.min(0.5, v / 80), alt: 0.012, color: "#ff6a00",
      name: S.meta[iso3].name,
    }));
}

/* timelinesourcecountry REALE (verifica antagonista):
   {timeline:[{series:"United States", data:[{date,value},...]}, ...]} */
function parseTimelineSourceCountry(d) {
  try {
    const out = {};
    for (const s of d.timeline || []) {
      const code = s.series || s.name;
      const rows = s.data || [];
      const last = rows[rows.length - 1];
      const v = +(last && (last.value ?? last.count));
      const iso3 = Analytics.countryToIso(code);
      if (iso3 && !isNaN(v)) out[iso3] = v;
    }
    return Object.keys(out).length ? out : null;
  } catch { return null; }
}
function applyShare(share) {
  S.countryShare = {};
  for (const [code, v] of Object.entries(share)) {
    const iso3 = S.meta[code] ? code : Analytics.countryToIso(code);
    if (!iso3 || !S.countryState[iso3]) continue;
    S.countryShare[iso3] = v;
    S.countryState[iso3].share = v;
  }
}

/* timelinetone REALE: {timeline:[{series:"...",data:[{date,value},...]}]} */
function parseTimeline(d) {
  try {
    const rows = (d.timeline && d.timeline[0] && d.timeline[0].data) || [];
    return rows.map((p) => ({ x: p.date, value: +p.value })).filter((p) => !isNaN(p.value));
  } catch { return null; }
}

function recomputeRisk() {
  for (const [iso3, st] of Object.entries(S.countryState)) {
    st.score = Analytics.warRiskScore({
      share: st.share || 0,
      points: (S.countryPts[iso3] || 0) + 0.4 * (S.countryEsc[iso3] || 0),
      base: st.base,
      tone: S.toneSeries.length ? S.toneSeries.at(-1).value : 0,
    });
    st.level = Analytics.riskLevel(st.score);
    // nessun segnale live -> score = solo baseline strutturale, va etichettato
    st.hasData = !!(st.share || S.countryPts[iso3] || S.countryEsc[iso3] || st.articles.length);
  }
}

/* ================= COUNTRY DETAIL ================= */
async function selectCountry(iso3) {
  S.selected = iso3;
  switchTab("country");
  const m = S.meta[iso3];
  if (!m) return;
  renderCountryBrief(iso3, { loading: true });
  await loadCountryNews(iso3);
  renderCountryBrief(iso3);
  // ferma autorotazione e punta il paese
  const g = S.globe; g.controls().autoRotate = false;
  g.pointOfView({ lat: m.centroid[1], lng: m.centroid[0], altitude: 1.5 }, 900);
  renderRiskList();
}

async function loadCountryNews(iso3, { bg = false } = {}) {
  const m = S.meta[iso3], st = S.countryState[iso3];
  if (!m) return;
  // via GDELT sourcecountry (paese dell'editore): FIPS, poi nome senza spazi
  // (antagonista: GDELT vuole il nome concatenato, es. "unitedarabemirates")
  if (m.fips || m.gdeltName) {
    const nameTerm = (m.gdeltName || m.name || "").replace(/[^a-z]/gi, "").toLowerCase();
    for (const term of [m.fips, nameTerm]) {
      if (!term) continue;
      const res = await Gdelt.artlist(`sourcecountry:${term}`, { maxrecords: 40, sort: "datedesc", timespan: "48h" });
      if (res && res.articles && res.articles.length) {
        for (const a of res.articles) { a.tags = Analytics.classify(a.title || ""); a.ts = parseSeen(a.seendate); }
        st.articles = mergeDedup(res.articles, st.articles).slice(0, 30);
        st.national = true;
        return;
      }
    }
  }
  // fallback: domini curati
  const src = S.sources[iso3];
  const domains = (src && src.s && src.s.length ? src.s : S.sources._meta.umbrella[WW_CONFIG.UMBRELLA_FALLBACK_REGION[m.region]] || S.sources._meta.umbrella.WORLD);
  const res2 = await Gdelt.domainArticles(domains, { maxrecords: 40 });
  if (res2 && res2.articles && res2.articles.length) {
    for (const a of res2.articles) { a.tags = Analytics.classify(a.title || ""); a.ts = parseSeen(a.seendate); }
    st.articles = mergeDedup(res2.articles, st.articles).slice(0, 30);
    return;
  }
  // fallback 2: Google News RSS edizione paese via proxy CORS
  if (src && src.g) {
    const garts = await gnewsArticles(src.g[0], src.g[2], src.g[1]);
    if (garts.length) {
      st.articles = mergeDedup(garts, st.articles).slice(0, 30);
      st.viaGnews = true;
    }
  }
}

/* Google News RSS -> articoli (titolo, link redirect Google, fonte, data) */
async function gnewsArticles(gl, ceid, hl, q) {
  const remote = WW_CONFIG.GNEWS(gl, ceid, hl, q);
  const urls = [WW_CONFIG.GNEWS_LOCAL(gl, ceid, hl, q), ...WW_CONFIG.PROXIES.map((p) => p(remote))];
  for (const u of urls) {
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 12000);
      const res = await wwApiFetch(u, { signal: ctl.signal });
      clearTimeout(to);
      if (!res.ok) continue;
      const xml = new DOMParser().parseFromString(await res.text(), "text/xml");
      const items = [...xml.querySelectorAll("item")].slice(0, 30);
      if (!items.length) continue;
      return items.map((it) => ({
        url: it.querySelector("link")?.textContent || "",
        title: it.querySelector("title")?.textContent || "",
        domain: it.querySelector("source")?.textContent || "",
        seendate: it.querySelector("pubDate")?.textContent || "",
        ts: Date.parse(it.querySelector("pubDate")?.textContent || "") || 0,
        tags: Analytics.classify(it.querySelector("title")?.textContent || ""),
        sourcecountry: "", gnews: true,
      }));
    } catch { /* prova proxy successivo */ }
  }
  return [];
}

function mergeDedup(a, b) {
  const seen = new Set();
  return a.concat(b).filter((x) => (seen.has(x.url) ? false : (seen.add(x.url), true)))
    .sort((x, y) => (y.ts || 0) - (x.ts || 0));
}

/* ================= RENDER ================= */
function renderAll() { renderRiskList(); renderCountryList(); renderFeed(); renderTicker(); renderOverlayStats(); renderAnalytics(); if (S.selected) renderCountryBrief(S.selected); }

function renderRiskList() {
  const rows = Object.entries(S.countryState)
    .map(([iso3, st]) => ({ iso3, st, name: S.meta[iso3]?.name || iso3 }))
    .sort((a, b) => b.st.score - a.st.score)
    .slice(0, 25);
  $("risk-count").textContent = `${rows.filter((r) => r.st.score >= 50).length} ≥50`;
  $("risk-list").innerHTML = rows.map(({ iso3, st, name }) =>
    `<div class="risk-row ${S.selected === iso3 ? "sel" : ""}" data-iso="${iso3}">
       <div class="risk-bar" style="background:${st.level.color}"></div>
       <div class="risk-name">${esc(name)}</div>
       <div class="risk-score" style="color:${st.level.color}">${st.score}</div>
       <div class="risk-sub">${st.share ? `conflict cov. ${st.share.toFixed(1)}%` : ""}${S.countryPts[iso3] ? ` · ${S.countryPts[iso3]} conflict pts` : ""}</div>
     </div>`).join("");
  $("risk-list").querySelectorAll(".risk-row").forEach((r) =>
    r.addEventListener("click", () => selectCountry(r.dataset.iso)));
}

function renderCountryList(filter = "") {
  const f = filter.toLowerCase();
  const rows = Object.entries(S.meta)
    .filter(([iso3, m]) => !f || m.name.toLowerCase().includes(f) || iso3.toLowerCase().includes(f))
    .sort((a, b) => a[1].name.localeCompare(b[1].name));
  $("country-list").innerHTML = rows.map(([iso3, m]) =>
    `<div class="c-row" data-iso="${iso3}"><span>${esc(m.name)}</span><span class="c-region">${m.region}</span></div>`).join("");
  $("country-list").querySelectorAll(".c-row").forEach((r) =>
    r.addEventListener("click", () => selectCountry(r.dataset.iso)));
}

function renderFeed() {
  const f = S.feedFilter;
  const items = S.feed.filter((a) =>
    f === "all" ? true :
    f === "war" ? a.tags.includes("war") :
    f === "econ" ? a.tags.includes("econ") :
    f === "speech" ? a.tags.includes("speech") :
    a.tags.includes("politics"));
  $("feed-list").innerHTML = items.slice(0, 120).map((a) => newsItemHTML(a)).join("") ||
    `<div class="empty-state">WAITING FOR LIVE DATA…</div>`;
}

function newsItemHTML(a) {
  const war = a.tags.includes("war");
  const tag = war ? "war" : a.tags.includes("politics") ? "pol" : a.tags.includes("econ") ? "eco" : a.tags.includes("speech") ? "leader" : "";
  const iso3 = Analytics.countryToIso(a.sourcecountry);
  const cn = S.meta[iso3]?.name || a.sourcecountry || "";
  return `<div class="news-item ${war ? "war" : a.tags.length ? "imp" : ""}">
    <div class="n-head">
      ${tag ? `<span class="n-tag ${tag}">${tag.toUpperCase()}</span>` : ""}
      ${cn ? `<span class="n-tag crit">${esc(cn.toUpperCase())}</span>` : ""}
      <span>${timeAgo(a.ts)}</span>
    </div>
    <div class="n-title"><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a></div>
    <div class="n-meta"><span class="src">${esc(a.domain || "")}</span><span>${esc(a.language || "")}</span></div>
  </div>`;
}

function renderTicker() {
  const items = S.feed.slice(0, 40);
  if (!items.length) return;
  const html = items.map((a) => {
    const war = a.tags.includes("war");
    const iso3 = Analytics.countryToIso(a.sourcecountry);
    return `<span class="ticker-item ${war ? "war" : ""}"><a href="${esc(a.url)}" target="_blank" rel="noopener"><span class="tk-src">${esc((S.meta[iso3]?.name || a.domain || "").toUpperCase())}</span>${esc(a.title)}</a></span>`;
  }).join("");
  $("ticker").innerHTML = html + html; // duplicato per loop seamless
}

function renderOverlayStats() {
  const crit = Object.values(S.countryState).filter((s) => s.score >= 75).length;
  const high = Object.values(S.countryState).filter((s) => s.score >= 50 && s.score < 75).length;
  const wars = S.feed.filter((a) => a.tags.includes("war")).length;
  $("overlay-stats").innerHTML =
    `<b>${S.feed.length}</b> live articles · <b>${wars}</b> conflict-related<br>` +
    `<b style="color:#ff2d2d">${crit}</b> critical · <b style="color:#ff6a00">${high}</b> high-risk countries<br>` +
    `<span style="color:#555">${S.dataMode === "live" ? "GDELT live feed" : S.dataMode === "snapshot" ? "cached snapshot" : "connecting…"}</span>`;
}

function renderAnalytics() {
  // top-10 share conflitto
  const shareRows = Object.entries(S.countryShare)
    .map(([iso3, v]) => ({ label: S.meta[iso3]?.name || iso3, value: v, color: v >= 20 ? "#ff2d2d" : v >= 8 ? "#ff6a00" : "#ffb000" }))
    .sort((a, b) => b.value - a.value).slice(0, 10);
  Charts.bars($("chart-risk"), shareRows, { fmt: (v) => v.toFixed(1) + "%" });

  const topics = Analytics.extractTopics(S.feed, 12)
    .map(([label, value]) => ({ label, value }));
  Charts.bars($("chart-topics"), topics);

  Charts.line($("chart-tone"), S.toneSeries, { fmt: (v) => v.toFixed(1) });

  const regs = Analytics.byRegion(S.feed, S.meta);
  Charts.bars($("chart-regions"), Object.entries(regs).map(([label, value]) => ({ label, value, color: "#39c2d7" })).sort((a, b) => b.value - a.value));
}

function renderCountryBrief(iso3, { loading = false } = {}) {
  const m = S.meta[iso3], st = S.countryState[iso3];
  if (!m || !st) return;
  const src = S.sources[iso3];
  const warN = st.articles.filter((a) => a.tags.includes("war")).length;
  const badge = `<span class="cb-risk-badge badge-lv-${st.level.key}">${st.level.label}</span>`;
  $("country-brief").innerHTML = `
    <div class="cb-head">
      <div class="cb-name">${esc(m.name)}</div>
      <div class="cb-sub">${iso3} · ${m.region} · GDELT ${m.fips || "—"}</div>
      <div class="cb-risk">
        ${badge}
        <span class="cb-risk-score" style="color:${st.level.color}">${st.score}</span>
        <div class="cb-risk-bar"><div class="cb-risk-fill" style="width:${st.score}%;background:${st.level.color}"></div></div>
      </div>
      <div class="cb-sub" style="margin-top:4px">conflict coverage ${st.share?.toFixed(1) || "0"}% · ${(S.countryPts[iso3] || 0)} conflict mentions · ${(S.countryEsc[iso3] || 0)} escalation mentions · tone ${S.toneSeries.at(-1)?.value?.toFixed?.(1) ?? "—"}${st.hasData ? "" : " · <span style='color:#ff6a00'>NO LIVE SIGNAL — baseline score</span>"}</div>
      <div class="cb-sub" style="color:#555">risk = indice di attenzione media/eventi GDELT, non previsione</div>
    </div>
    ${src ? `<div class="cb-section"><div class="cb-section-title">NATIONAL SOURCES</div><div class="cb-sources">${src.s.map((d) => `<a class="cb-src" href="https://${d}" target="_blank" rel="noopener">${d}</a>`).join("")}</div></div>` : ""}
    <div class="cb-section" style="flex:1;min-height:0;overflow-y:auto">
      <div class="cb-section-title">LIVE NATIONAL FEED ${warN ? `<span style="color:#ff6b6b">· ${warN} conflict</span>` : ""}</div>
      ${loading ? `<div class="empty-state">FETCHING…</div>` : st.articles.length ? st.articles.map((a) => newsItemHTML(a)).join("") : `<div class="empty-state">NO LIVE ITEMS — TRY REFRESH<br/><span style="font-size:8px">rate limits may apply</span></div>`}
    </div>`;
}

/* ================= UI ================= */
function switchTab(t) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === t));
  document.querySelectorAll(".tabpane").forEach((p) => p.classList.toggle("active", p.id === "tab-" + t));
}

function initUI() {
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  document.querySelectorAll(".ff").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".ff").forEach((x) => x.classList.remove("active"));
    b.classList.add("active"); S.feedFilter = b.dataset.ff; renderFeed();
  }));
  $("country-search").addEventListener("input", (e) => renderCountryList(e.target.value));
  $("btn-refresh").addEventListener("click", async () => {
    const b = $("btn-refresh"); b.classList.add("spin");
    // invalida cache leggera per forzare re-fetch
    Object.keys(localStorage).filter((k) => k.startsWith("ww:")).forEach((k) => localStorage.removeItem(k));
    await refresh(); b.classList.remove("spin");
  });
  setInterval(() => {
    const d = new Date();
    $("clock").textContent = d.toISOString().slice(11, 19);
  }, 1000);
  Gdelt.onStatus(({ queue }) => { $("sb-queue").textContent = `Q: ${queue}`; });
}

function setFeedChip(cls, txt) {
  $("chip-feed").querySelector("i").className = cls;
  $("chip-feed-txt").textContent = txt;
}
function updateStatusBar() {
  const sb = $("sb-source");
  sb.textContent = `SRC: GDELT DOC 2.0 ${S.dataMode === "live" ? "· LIVE" : S.dataMode === "snapshot" ? "· SNAPSHOT" : ""}`;
  sb.className = S.dataMode === "live" ? "live" : S.dataMode === "snapshot" ? "cached" : "err";
  $("sb-updated").textContent = `LAST: ${S.lastUpdate ? S.lastUpdate.toISOString().slice(11, 16) + "Z" : "—"}`;
  $("sb-articles").textContent = `ARTICLES: ${S.feed.length}`;
  $("sb-countries").textContent = `COUNTRIES: ${Object.keys(S.meta).length}`;
}

function timeAgo(ts) {
  if (!ts) return "—";
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? `${m % 60}m` : ""}`;
}

boot().catch((e) => {
  console.error(e);
  $("ticker").innerHTML = `<span class="ticker-item war">BOOT ERROR: ${esc(e.message)}</span>`;
});
})();
