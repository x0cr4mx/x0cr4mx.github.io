// /api/events — GDELT v2 events export (CAMEO, update ogni 15 min).
// Port 1:1 di server.py:_fetch_events (FastAPI) -> Vercel function.
//
// Scarica lastupdate.txt, trova l'URL *.export.CSV.zip piu' recente,
// scarica quello + le N-1 finestre da 15 min precedenti (N=8, env
// WW_EVENT_WINDOWS), unzippa con fflate e parsa i TSV:
//   EventRootCode=col28, QuadClass=col29 ("4"=Material Conflict->points),
//   NumMentions=col31, AvgTone=col34, ActionGeo_Fullname=col52,
//   ActionGeo_CountryCode=col53 (FIPS 10-4), ActionGeo_Lat=col56, Long=col57.
// Output: {updated, windows, source, points(top 250), countries, escalation}.

import { unzipSync } from "fflate";

const LASTUPDATE = "http://data.gdeltproject.org/gdeltv2/lastupdate.txt";
const UA = { "User-Agent": "Mozilla/5.0 world-watcher/1.0" };

// Codici paese: GDELT 2.0 usa FIPS 10-4 nei campi *Geo_CountryCode e
// CAMEO 3-letter negli Actor*CountryCode. Mappa dei codici divergenti.
const CAMEO_DIVERGENT = {
    "FRG": "DEU", "UK": "GBR", "AUL": "AUS", "SAF": "ZAF", "DEN": "DNK",
    "NTH": "NLD", "SWD": "SWE", "SWZ": "CHE", "SPN": "ESP", "POR": "PRT",
    "ICE": "ISL", "IRE": "IRL", "LAT": "LVA", "LIT": "LTU", "MLD": "MDA",
    "ROM": "ROU", "BUL": "BGR", "SER": "SRB", "CRO": "HRV", "SLO": "SVN",
    "SLV": "SVK", "BOS": "BIH", "MNT": "MNE", "MAC": "MKD", "ALG": "DZA",
    "MOR": "MAR", "LIB": "LBY", "LEB": "LBN", "PAL": "PSE", "UAE": "ARE",
    "KUW": "KWT", "BAH": "BHR", "OMA": "OMN", "QAT": "QAT", "YEM": "YEM",
    "SUD": "SDN", "SSD": "SSD", "ETM": "TLS", "BRU": "BRN", "CHN": "CHN",
    "HKG": "HKG", "TAW": "TWN", "ROK": "KOR", "PRK": "PRK", "JPN": "JPN",
    "MYA": "MMR", "SIN": "SGP", "MAL": "MYS", "THI": "THA", "VIE": "VNM",
    "PHI": "PHL", "INS": "IDN", "PNG": "PNG", "NEW": "NZL", "FIJ": "FJI",
    "MEX": "MEX", "CUB": "CUB", "HAI": "HTI", "DOM": "DOM", "GUA": "GTM",
    "HON": "HND", "ELS": "SLV", "NIC": "NIC", "COS": "CRI", "PAN": "PAN",
    "COL": "COL", "VEN": "VEN", "ECU": "ECU", "PER": "PER", "BOL": "BOL",
    "BRA": "BRA", "PAR": "PRY", "CHL": "CHL", "ARG": "ARG", "URU": "URY",
    "GUY": "GUY", "SUR": "SUR", "USA": "USA", "CAN": "CAN", "RUS": "RUS",
    "UKR": "UKR", "BLR": "BLR", "KZK": "KAZ", "UZB": "UZB", "TKM": "TKM",
    "KGZ": "KGZ", "TAJ": "TJK", "AFG": "AFG", "PAK": "PAK", "IND": "IND",
    "BNG": "BGD", "SRI": "LKA", "NEP": "NPL", "BHU": "BTN", "MDV": "MDV",
    "ISR": "ISR", "JOR": "JOR", "SYR": "SYR", "IRQ": "IRQ", "IRN": "IRN",
    "SAU": "SAU", "TUR": "TUR", "EGY": "EGY", "CYP": "CYP", "GEO": "GEO",
    "ARM": "ARM", "AZE": "AZE", "MNG": "MNG", "LAO": "LAO", "CAM": "KHM",
    "ETH": "ETH", "SOM": "SOM", "KEN": "KEN", "UGA": "UGA", "TAN": "TZA",
    "RWA": "RWA", "BDI": "BDI", "ZAM": "ZMB", "ZIM": "ZWE", "MAA": "MRT",
    "MLI": "MLI", "NIR": "NER", "NIG": "NGA", "CHA": "TCD", "CAF": "CAF",
    "SEN": "SEN", "GAM": "GMB", "GUI": "GIN", "SIE": "SLE", "LIB?": "LBR",
    "CDI": "CIV", "BFO": "BFA", "GHA": "GHA", "TOG": "TGO", "BEN": "BEN",
    "CMR": "CMR", "EQG": "GNQ", "GAB": "GAB", "CON": "COG", "DRC": "COD",
    "ANG": "AGO", "NAM": "NAM", "BOT": "BWA", "MZM": "MOZ", "MAD": "MDG",
    "ERI": "ERI", "DJI": "DJI", "LIT?": "LTU", "EST": "EST", "POL": "POL",
    "HUN": "HUN", "AUT": "AUT", "FRA": "FRA", "BEL": "BEL", "LUX": "LUX",
    "SWI": "CHE", "ITA": "ITA", "MLT": "MLT", "ALB": "ALB", "GRG": "GEO",
    "CAP": "CPV", "GNB": "GNB", "LES": "LSO", "COM": "COM", "SEY": "SYC",
    "MAU": "MUS", "MOR?": "MAR", "WSM": "WSM", "TON": "TON", "VAN": "VUT",
    "SOL": "SLB", "KIR": "KIR", "PAL?": "PLW", "MON": "MNG",
};
// FIPS 2-letter -> ISO3 per i campi Geo_CountryCode
const FIPS2 = {
    "AF":"AFG","AL":"ALB","AG":"DZA","AO":"AGO","AR":"ARG","AM":"ARM",
    "AS":"AUS","AU":"AUT","AJ":"AZE","BA":"BHR","BG":"BGD","BO":"BLR",
    "BE":"BEL","BH":"BLZ","BN":"BEN","BT":"BTN","BL":"BOL","BK":"BIH",
    "BC":"BWA","BR":"BRA","BX":"BRN","BU":"BGR","UV":"BFA","BM":"MMR",
    "BY":"BDI","CB":"KHM","CM":"CMR","CA":"CAN","CV":"CPV","CT":"CAF",
    "CD":"TCD","CI":"CHL","CH":"CHN","CO":"COL","CN":"COM","CG":"COD",
    "CF":"COG","CS":"CRI","IV":"CIV","HR":"HRV","CU":"CUB","CY":"CYP",
    "EZ":"CZE","DA":"DNK","DJ":"DJI","DR":"DOM","TT":"TLS","EC":"ECU",
    "EG":"EGY","ES":"SLV","EK":"GNQ","ER":"ERI","EN":"EST","ET":"ETH",
    "FJ":"FJI","FI":"FIN","FR":"FRA","GB":"GAB","GA":"GMB","GZ":"PSE",
    "GG":"GEO","GM":"DEU","GH":"GHA","GR":"GRC","GT":"GTM","GV":"GIN",
    "PU":"GNB","GY":"GUY","HA":"HTI","HO":"HND","HU":"HUN","IC":"ISL",
    "IN":"IND","ID":"IDN","IR":"IRN","IZ":"IRQ","EI":"IRL","IS":"ISR",
    "IT":"ITA","JM":"JAM","JA":"JPN","JO":"JOR","KZ":"KAZ","KE":"KEN",
    "KN":"PRK","KS":"KOR","KV":"KOS","KU":"KWT","KG":"KGZ","LA":"LAO",
    "LG":"LVA","LE":"LBN","LT":"LSO","LI":"LBR","LY":"LBY","LH":"LTU",
    "LU":"LUX","MK":"MKD","MA":"MDG","MI":"MWI","MY":"MYS","MV":"MDV",
    "ML":"MLI","MT":"MLT","MR":"MRT","MP":"MUS","MX":"MEX","MD":"MDA",
    "MG":"MNG","MJ":"MNE","MO":"MAR","MZ":"MOZ","WA":"NAM","NP":"NPL",
    "NL":"NLD","NZ":"NZL","NU":"NIC","NG":"NER","NI":"NGA","NO":"NOR",
    "MU":"OMN","PK":"PAK","PM":"PAN","PP":"PNG","PA":"PRY","PE":"PER",
    "RP":"PHL","PL":"POL","PO":"PRT","QA":"QAT","RO":"ROU","RS":"RUS",
    "RW":"RWA","SA":"SAU","SG":"SEN","RI":"SRB","SE":"SYC","SL":"SLE",
    "SN":"SGP","LO":"SVK","SI":"SVN","BP":"SLB","SO":"SOM","SF":"ZAF",
    "OD":"SSD","SP":"ESP","CE":"LKA","SU":"SDN","NS":"SUR","WZ":"SWZ",
    "SW":"SWE","SZ":"CHE","SY":"SYR","TW":"TWN","TI":"TJK","TZ":"TZA",
    "TH":"THA","TO":"TGO","TD":"TTO","TS":"TUN","TU":"TUR","TX":"TKM",
    "UG":"UGA","UP":"UKR","AE":"ARE","UK":"GBR","US":"USA","UY":"URY",
    "UZ":"UZB","NH":"VUT","VE":"VEN","VM":"VNM","WE":"PSE","WI":"ESH",
    "YM":"YEM","ZA":"ZMB","ZI":"ZWE"};

function cameoToIso3(code) {
  if (!code) return null;
  code = code.trim().toUpperCase();
  if (code.length === 2) return FIPS2[code] ?? null;
  return CAMEO_DIVERGENT[code] ?? (code.length === 3 ? code : null);
}

async function throttledGet(url, timeout = 50000) {
  // niente throttle lato serverless: ogni invocazione e' isolata e il
  // rate-limit e' delegato alla cache CDN (s-maxage)
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r;
}

function tsOf(u) {
  // datetime.strptime(part[:14], "%Y%m%d%H%M%S") sul primo segmento a 14 cifre
  for (const part of u.split("/")) {
    const s = part.slice(0, 14);
    if (/^\d{14}$/.test(s)) {
      return new Date(Date.UTC(
        +s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8),
        +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14)));
    }
  }
  return null;
}

// "%Y%m%d%H%M%S" in UTC
const fmtTs = (d) => d.toISOString().replace(/[-:T]/g, "").slice(0, 14);

async function fetchEvents() {
  const r0 = await throttledGet(LASTUPDATE);
  const txt = await r0.text();
  let url = null;
  for (const line of txt.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 3 && parts[2].endsWith(".export.CSV.zip")) url = parts[2];
  }
  if (!url) throw new Error("no export url in lastupdate.txt");

  // scarica le ultime N finestre da 15 min (ogni export ~40KB)
  const N_WIN = parseInt(process.env.WW_EVENT_WINDOWS || "8", 10) || 8;
  const t0 = tsOf(url);
  const urls = [url];
  if (t0) {
    const base = url.slice(0, url.lastIndexOf("/"));
    for (let i = 1; i < N_WIN; i++) {
      const t = new Date(t0.getTime() - 15 * i * 60000);
      urls.push(`${base}/${fmtTs(t)}.export.CSV.zip`);
    }
  }

  const pts = new Map();
  const countries = {};
  const escalation = {};
  const ESC_ROOTS = new Set(["13", "14", "15", "16", "17"]);
  let fetched = 0;

  for (const u of urls) {
    let csv;
    try {
      const r = await throttledGet(u, 180000);
      const files = unzipSync(new Uint8Array(await r.arrayBuffer()));
      const name = Object.keys(files)[0];
      if (!name) continue;
      csv = files[name];
    } catch {
      continue;
    }
    fetched += 1;
    const text = new TextDecoder("utf-8").decode(csv);
    for (const rawLine of text.split("\n")) {
      const row = rawLine.split("\t");
      if (row.length < 58) continue;
      const latS = row[56], lonS = row[57];
      if (latS === undefined || lonS === undefined ||
          latS.trim() === "" || lonS.trim() === "") continue;
      const lat = Number(latS), lon = Number(lonS);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (lat === 0 && lon === 0) continue;
      const iso = cameoToIso3(row[53]);
      // int(row[31]) / float(row[34]) con fallback come in server.py
      const nmen = /^[+-]?\d+$/.test((row[31] || "").trim())
        ? parseInt(row[31], 10) : 1;
      const tv = Number(row[34]);
      const tone = Number.isFinite(tv) ? tv : 0.0;
      if (row[29] === "4") {           // QuadClass=Material Conflict
        const key = `${Math.round(lat * 10) / 10}|${Math.round(lon * 10) / 10}`;
        let p = pts.get(key);
        if (!p) {
          p = {
            lat, lng: lon, name: (row[52] || "").slice(0, 70),
            iso, count: 0, tone: 0.0, n: 0,
          };
          pts.set(key, p);
        }
        p.count += nmen; p.tone += tone; p.n += 1;
        if (iso) countries[iso] = (countries[iso] || 0) + nmen;
      } else if (ESC_ROOTS.has(row[28])) {  // threaten/protest/coerce...
        if (iso) escalation[iso] = (escalation[iso] || 0) + nmen;
      }
    }
  }

  const points = [...pts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 250);
  for (const p of points) {
    p.tone = Math.round((p.tone / Math.max(1, p.n)) * 100) / 100;
  }
  return {
    updated: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    windows: fetched, source: url, points, countries, escalation,
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
  try {
    const data = await fetchEvents();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: String(e) });
  }
}
