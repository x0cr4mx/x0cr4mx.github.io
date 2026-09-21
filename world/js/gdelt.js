/* ============ WORLD WATCHER — GDELT client ============
   DOC 2.0 API: gratis, no-key, CORS * — ma rate limit severo per IP.
   Strategia: coda serializzata (>=8s), cache localStorage 15min,
   backoff esponenziale su 429/risposte testuali. */
const Gdelt = (() => {
  const q = [];
  let busy = false;
  let lastReq = 0;
  let cooldownUntil = 0;   // esteso quando arriva 429
  let statusCb = () => {};

  const onStatus = (fn) => (statusCb = fn);
  const setStatus = (s) => statusCb(s);

  function enqueue(fn, key) {
    return new Promise((resolve) => {
      q.push({ fn, key, resolve });
      setStatus({ queue: q.length });
      pump();
    });
  }

  async function pump() {
    if (busy) return;
    const job = q.shift();
    if (!job) return setStatus({ queue: 0 });
    busy = true;
    const wait = Math.max(
      WW_CONFIG.REQ_GAP_MS - (Date.now() - lastReq),
      cooldownUntil - Date.now(),
      0
    );
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastReq = Date.now();
    try {
      const res = await job.fn();
      job.resolve(res);
    } catch (e) {
      console.warn("[gdelt] job failed:", e.message);
      job.resolve({ error: e.message });
    } finally {
      busy = false;
      setStatus({ queue: q.length });
      setTimeout(pump, 50);
    }
  }

  async function fetchJSON(url, attempt = 0) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), WW_CONFIG.REQ_TIMEOUT_MS);
    let res, text;
    try {
      res = await wwApiFetch(url, { signal: ctl.signal });
      text = await res.text();
    } catch (e) {
      // Fetch-level failure (network drop, or a 429/503 whose response the
      // browser hides because it lacks ACAO headers). Treat it like a
      // throttle and retry with backoff instead of giving up immediately.
      if (attempt < WW_CONFIG.MAX_RETRIES) {
        cooldownUntil = Date.now() + 15000 * (attempt + 1);
        await new Promise((r) => setTimeout(r, 15000 * (attempt + 1)));
        return fetchJSON(url, attempt + 1);
      }
      throw e;
    } finally {
      clearTimeout(to);
    }
    // GDELT risponde a volte 200-con-testo o 429 plaintext quando throttla
    if (res.status === 429 || /limit requests to/i.test(text || "")) {
      cooldownUntil = Date.now() + 60000 + attempt * 30000;
      if (attempt < WW_CONFIG.MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 65000));
        return fetchJSON(url, attempt + 1);
      }
      throw new Error("GDELT rate-limited (429)");
    }
    if (!res.ok) {
      if (res.status >= 500 && attempt < WW_CONFIG.MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 15000));
        return fetchJSON(url, attempt + 1);
      }
      throw new Error(`HTTP ${res.status}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`non-JSON response: ${(text || "").slice(0, 80)}`);
    }
  }

  function cacheGet(key) {
    try {
      const raw = localStorage.getItem("ww:" + key);
      if (!raw) return null;
      const { t, v } = JSON.parse(raw);
      if (Date.now() - t > WW_CONFIG.CACHE_TTL_MS) return null;
      return v;
    } catch { return null; }
  }
  function cacheSet(key, v) {
    try { localStorage.setItem("ww:" + key, JSON.stringify({ t: Date.now(), v })); } catch {}
  }

  function req(params, key, transform) {
    const cached = cacheGet(key);
    if (cached) return Promise.resolve({ ...cached, cached: true });
    const qs = new URLSearchParams(params);
    const url = `${WW_CONFIG.GDELT_DOC}?${qs}`;
    return enqueue(async () => {
      let data;
      try {
        data = await fetchJSON(url);
      } catch (e) {
        // Direct GDELT failed for good (rate limit / CORS-blocked throttle).
        // One last attempt through the server-side proxy (auth-gated edge
        // function, or same-origin /api on Vercel) — server egress is not
        // bound by the browser's per-IP CORS/rate-limit view.
        const proxy = `${WW_API_BASE || "/api"}/gdelt?${qs}`;
        const res = await fetchJSON(proxy);
        if (res && res.error) throw new Error(res.error);
        data = res;
      }
      const out = transform ? transform(data) : data;
      cacheSet(key, out);
      return out;
    }, key);
  }

  /* ---- API ---- */

  // mode=artlist -> {articles:[...]}
  const artlist = (query, extra = {}) =>
    req(
      {
        query, mode: "artlist", format: "json",
        maxrecords: String(extra.maxrecords || WW_CONFIG.MAX_RECORDS),
        timespan: extra.timespan || WW_CONFIG.TIMESPAN,
        sort: extra.sort || "hybridrel",
        ...(extra.params || {}),
      },
      `art:${hash(query + JSON.stringify(extra))}`,
      (d) => ({ articles: d.articles || [] })
    );

  /* NOTA antagonista: format=geojson NON esiste sulla DOC API (era della GEO
     API, oggi 404). I punti conflitto arrivano da /api/events (server.py,
     export CAMEO GDELT) oppure dallo snapshot vendored. */
  const events = async () => {
    try {
      const res = await wwApiFetch("events", { signal: AbortSignal.timeout(95000) });
      if (!res.ok) return null;
      const d = await res.json();
      return d.error ? null : d;
    } catch { return null; }
  };

  // mode=timelinesourcecountry -> breakdown % copertura per paese-fonte
  const timelineSourceCountry = (query, extra = {}) =>
    req(
      {
        query, mode: "timelinesourcecountry", format: "json",
        timespan: extra.timespan || "7d",
      },
      `tsc:${hash(query)}${extra.timespan || ""}`,
      (d) => d
    );

  // mode=timelinetone -> serie tono medio
  const timelineTone = (query, extra = {}) =>
    req(
      {
        query, mode: "timelinetone", format: "json",
        timespan: extra.timespan || "7d",
      },
      `ttn:${hash(query)}${extra.timespan || ""}`,
      (d) => d
    );

  // per-paese via domini curati
  const domainArticles = (domains, extra = {}) => {
    const dq = domains.slice(0, 4).map((d) => `domain:${d}`).join(" OR ");
    return artlist(`(${dq})`, { maxrecords: extra.maxrecords || 40, sort: "datedesc", timespan: extra.timespan || "72h" });
  };

  function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
    return (h >>> 0).toString(36);
  }

  return { artlist, events, timelineSourceCountry, timelineTone, domainArticles, onStatus, cacheGet, cacheSet };
})();
