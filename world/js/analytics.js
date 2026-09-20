/* ============ WORLD WATCHER — analytics ============ */
const Analytics = (() => {

  /* ---- classificazione articolo ---- */
  const RX = {};
  for (const [k, words] of Object.entries(WW_CONFIG.CLS))
    RX[k] = new RegExp("\\b(" + words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "i");

  function classify(title) {
    const tags = [];
    if (RX.war.test(title)) tags.push("war");
    if (RX.econ.test(title)) tags.push("econ");
    if (RX.politics.test(title)) tags.push("politics");
    if (RX.speech.test(title)) tags.push("speech");
    return tags;
  }

  /* ---- FIPS / nome GDELT <-> ISO3 ----
     ATTENZIONE: il campo `sourcecountry` degli articoli contiene il NOME GDELT
     (es. "Ukraine", "United States"), mentre `sourcecountry:` nella query
     accetta il codice FIPS o il nome. `timelinesourcecountry` usa codici FIPS. */
  let fips2iso = {}, iso2fips = {}, name2iso = {};
  function initMaps(meta) {
    fips2iso = {}; iso2fips = {}; name2iso = {};
    for (const [iso3, m] of Object.entries(meta)) {
      if (m.fips) { fips2iso[m.fips] = iso3; iso2fips[iso3] = m.fips; }
      for (const n of [m.gdeltName, m.name, m.geojsonName])
        if (n) name2iso[n.toLowerCase()] = iso3;
    }
  }

  // risolve il campo sourcecountry di un articolo (nome GDELT) in ISO3
  function countryToIso(v) {
    if (!v) return null;
    if (fips2iso[v]) return fips2iso[v];
    const s = String(v).toLowerCase();
    if (name2iso[s]) return name2iso[s];
    // normalizzazioni note GDELT
    const FIX = {
      "congo, democratic republic": "COD", "democratic republic of the congo": "COD",
      "congo, republic of the": "COG", "republic of the congo": "COG",
      "vietnam, democratic republic of": "VNM", "bahamas, the": "BHS",
      "gambia, the": "GMB", "korea, north": "PRK", "korea, south": "KOR",
      "gaza strip": "PSE", "west bank": "PSE", "cote d'ivoire": "CIV",
      "ivory coast": "CIV", "czech republic": "CZE", "macedonia": "MKD",
      "swaziland": "SWZ", "east timor": "TLS", "burma": "MMR",
      "cape verde": "CPV", "vatican city": "VAT", "united states": "USA",
    };
    return FIX[s] || null;
  }

  /* ---- aggregazioni ---- */
  function bySourceCountry(articles) {
    const out = {};
    for (const a of articles) {
      const iso3 = countryToIso(a.sourcecountry);
      if (!iso3) continue;
      (out[iso3] = out[iso3] || []).push(a);
    }
    return out;
  }

  function byRegion(articles, meta) {
    const out = {};
    for (const a of articles) {
      const iso3 = countryToIso(a.sourcecountry);
      const r = (meta[iso3] && meta[iso3].region) || "Other";
      out[r] = (out[r] || 0) + 1;
    }
    return out;
  }

  /* ---- topics ricorrenti (n-gram su titoli) ---- */
  const STOP = new Set(("the a an and or of to in on for at by with from as is are was were be been it its his her their our your my we they he she not no that this these those will would can could has have had do does did said says new over after under more than into out about amid against between during latest update live video watch how what why who when where which while".split(" ")));
  function extractTopics(articles, topN = 12) {
    const uni = {}, bi = {};
    for (const a of articles) {
      const toks = (a.title || "")
        .toLowerCase().replace(/['’]/g, "").replace(/[^a-zà-öø-ÿ0-9\s-]/g, " ")
        .split(/\s+/).filter((t) => t.length > 3 && !STOP.has(t) && !/^\d+$/.test(t));
      const seen = new Set();
      toks.forEach((t, i) => {
        if (!seen.has(t)) { uni[t] = (uni[t] || 0) + 1; seen.add(t); }
        if (i < toks.length - 1) {
          const b = toks[i] + " " + toks[i + 1];
          if (!seen.has(b)) { bi[b] = (bi[b] || 0) + 1; seen.add(b); }
        }
      });
    }
    const minC = Math.max(2, Math.floor(articles.length * 0.02));
    const merged = Object.entries({ ...uni })
      .filter(([, c]) => c >= minC);
    for (const [b, c] of Object.entries(bi))
      if (c >= minC) merged.push([b, c * 1.6]); // boost bigrammi
    return merged.sort((a, b) => b[1] - a[1]).slice(0, topN);
  }

  /* ---- War Risk Score composito (0-100) ----
     input per paese:
       share   = % copertura nazionale che matcha query conflitto (timelinesourcecountry)
       points  = menzioni eventi CAMEO conflitto nel paese (export 15-min)
       base    = baseline editoriale 0-100 (config)
       tone    = tono medio GDELT (-10..+10, negativo = peggio)
  */
  function warRiskScore({ share = 0, points = 0, base = 15, tone = 0 }) {
    const shareN = Math.min(1, share / 40);          // 40%+ share = saturato
    const ptsN = Math.min(1, points / 30);           // 30+ punti conflitto = saturato
    const baseN = base / 100;
    const toneN = Math.max(0, Math.min(1, -tone / 10)); // tono -10 => 1
    const W = WW_CONFIG.W;
    const s = 100 * (W.conflictShare * shareN + W.conflictPoints * ptsN + W.baseline * baseN + W.tone * toneN);
    return Math.round(Math.max(0, Math.min(100, s)));
  }

  function riskLevel(score) {
    for (const l of WW_CONFIG.RISK_LEVELS) if (score >= l.min) return l;
    return WW_CONFIG.RISK_LEVELS.at(-1);
  }

  return { classify, initMaps, bySourceCountry, byRegion, extractTopics, warRiskScore, riskLevel, countryToIso, fips2iso: () => fips2iso, iso2fips: () => iso2fips };
})();
