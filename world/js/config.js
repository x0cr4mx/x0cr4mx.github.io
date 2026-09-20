/* ============ WORLD WATCHER — config ============ */
// Supabase Edge Functions base (da /config.js -> window.K1_ENV.API_BASE).
// Le proxy function verificano il session token dell'utente: wwApiFetch lo
// allega leggendo la sessione supabase-js da localStorage (stessa origine).
const K1ENV = window.K1_ENV || {};
const WW_API_BASE = (K1ENV.API_BASE || "").replace(/\/+$/, "");

function wwSessionToken() {
  try {
    const ref = new URL(K1ENV.SUPABASE_URL).host.split(".")[0];
    const raw = localStorage.getItem(`sb-${ref}-auth-token`);
    const sess = raw ? JSON.parse(raw) : null;
    return (sess && sess.access_token) || "";
  } catch { return ""; }
}

// fetch() che allega Authorization+apikey quando l'URL punta alle edge
// function; per ogni altro URL si comporta come fetch() standard.
function wwApiFetch(pathOrUrl, opts = {}) {
  const url = /^https?:/i.test(pathOrUrl)
    ? pathOrUrl
    : `${WW_API_BASE}/${String(pathOrUrl).replace(/^\/+/, "")}`;
  const headers = { ...(opts.headers || {}) };
  if (WW_API_BASE && url.startsWith(WW_API_BASE)) {
    const tok = wwSessionToken();
    if (tok) {
      headers.Authorization = `Bearer ${tok}`;
      headers.apikey = K1ENV.SUPABASE_KEY || "";
    }
  }
  return fetch(url, { ...opts, headers });
}

const WW_CONFIG = {
  // DOC 2.0 diretto dal browser: GDELT limita per-IP e l'egress Supabase e'
  // condiviso (429 cronico); l'IP del browser ha un budget dedicato.
  // La edge function /gdelt resta deployata come fallback server-side.
  GDELT_DOC: "https://api.gdeltproject.org/api/v2/doc/doc",
  // GDELT GEO 2.0 API attualmente risponde 404 (migrazione Spanner, apr 2026):
  // i punti conflitto arrivano da /api/events (server.py -> export CAMEO 15-min)
  // o dallo snapshot vendored.
  REQ_GAP_MS: 8000,          // spacing tra richieste GDELT (rate limit ~1/5s, teniamo margine)
  REQ_TIMEOUT_MS: 45000,
  MAX_RETRIES: 2,
  CACHE_TTL_MS: 15 * 60e3,   // GDELT aggiorna ogni 15 min
  REFRESH_MS: 5 * 60e3,      // ciclo di refresh UI
  MAX_RECORDS: 250,
  TIMESPAN: "24h",

  // ---- query packs (sintassi DOC 2.0) ----
  Q_CONFLICT:
    'theme:ARMEDCONFLICT OR theme:TERROR OR "airstrike" OR "missile strike" OR invasion OR offensive OR artillery OR dronestrike OR "drone strike" OR battlefield',
  Q_MAJOR:
    'theme:LEADER OR theme:ELECTION OR theme:SANCTIONS OR theme:CEASEFIRE OR president OR "prime minister" OR summit OR "trade deal" OR treaty OR protest OR referendum',
  Q_WAR_TERMS:
    'war OR airstrike OR missile OR invasion OR offensive OR troops OR artillery OR drone OR killed OR ceasefire OR battlefield OR bombing OR shelling',

  // keyword bag per classificazione lato client
  CLS: {
    war: ["war","airstrike","missile","invasion","offensive","troops","soldier","artillery","drone","killed","casualt","bomb","shell","ceasefire","frontline","militia","insurgen","hostage","airstrik","ballistic","warship","airspace","military operation","armed forces","escalat","strike on","strikes on","attack on","attacks on","warplane","combat","armed clash"],
    politics: ["president","election","parliament","minister","vote","referendum","government","coalition","resign","impeach","diplomat","ambassador","summit","sanction","treaty","nato","un security","foreign minister","prime minister","policy","coup","protest","demonstration"],
    econ: ["trade","tariff","deal","economy","inflation","central bank","oil","gas","sanctions","export","import","market","currency","debt","imf","opec","pipeline","agreement","investment","embargo"],
    speech: ["speech","address","said","statement","announced","declared","vowed","pledged","warned","told reporters","remarks"]
  },

  // livelli rischio
  RISK_LEVELS: [
    { min: 75, key: "crit", label: "CRITICAL", color: "#ff2d2d" },
    { min: 50, key: "high", label: "HIGH",     color: "#ff6a00" },
    { min: 30, key: "elev", label: "ELEVATED", color: "#ffb000" },
    { min: 12, key: "low",  label: "GUARDED",  color: "#4d7a3d" },
    { min: 0,  key: "calm", label: "CALM",     color: "#1e2b38" },
  ],

  // pesi composito war-risk (0-100)
  W: { conflictShare: 0.40, conflictPoints: 0.25, baseline: 0.25, tone: 0.10 },

  // Google News RSS per edizione paese via proxy CORS
  GNEWS: (gl, ceid, hl, q) => {
    const base = q
      ? `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&`
      : `https://news.google.com/rss?`;
    return `${base}hl=${hl}&gl=${gl}&ceid=${ceid}`;
  },
  // proxy via edge function (auth-gated, CORS gestito); con API_BASE vuoto
  // ricade su /api/* same-origin (hosting con proprio layer API).
  GNEWS_LOCAL: (gl, ceid, hl, q) =>
    `${WW_API_BASE ? `${WW_API_BASE}/gnews` : "/api/gnews"}?gl=${gl}&hl=${hl}&ceid=${encodeURIComponent(ceid)}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
  PROXIES: [
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  ],

  UMBRELLA_FALLBACK_REGION: {
    Europe: "WORLD", Asia: "WORLD", "Middle East": "MIDEAST",
    Africa: "AFRICA", Americas: "LATAM", Oceania: "PACIFIC",
  },
};

/* baseline risk editoriale (0-100): sintesi pubblica GPI/FSI/INFORM.
   Non live: pesa 25% sullo score composito; il resto è live GDELT. */
const WW_BASELINE_FALLBACK = {
  AFG:85,SYR:82,UKR:88,RUS:70,ISR:72,PSE:88,YEM:84,SDN:82,SSD:80,SOM:78,ETH:70,MMR:76,HTI:74,LBY:68,IRQ:66,MLI:72,BFA:74,NER:68,TCD:66,COD:72,CAF:74,CMR:55,NGA:60,PRK:62,IRN:60,LBN:64,VEN:58,COL:48,MEX:45,PAK:58,IND:45,CHN:40,TWN:52,KOR:30,USA:22,BRA:35,TUR:45,SAU:42,QAT:20,ARE:18,EGY:50,JOR:38,ARM:55,AZE:55,GEO:40,BLR:52,MDA:42,SRB:38,KOS:42,BIH:35,CYP:28,GRC:22,PHL:42,THA:35,KHM:38,IDN:32,BGD:42,LKA:40,NPL:35,KAZ:38,UZB:35,TKM:48,KGZ:40,TJK:44,MNG:22,MOZ:55,ZWE:50,ZAF:38,KEN:40,UGA:45,RWA:38,BDI:45,TZA:32,DZA:45,TUN:40,MAR:30,ESH:55,NIC:50,CUB:45,GTM:42,HND:44,SLV:35,ECU:45,PER:35,BOL:35,PRY:25,JAM:38,DOM:28,TTO:32,GUY:25,PNG:40,FJI:22,SLB:30
};
