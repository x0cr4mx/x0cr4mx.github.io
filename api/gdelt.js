// /api/gdelt — proxy server-side verso GDELT DOC 2.0 API.
// Port di server.py:gdelt_proxy (FastAPI) -> Vercel function.
// Whitelist parametri: query, mode, format, maxrecords, timespan, sort.

const GDELT = "https://api.gdeltproject.org/api/v2/doc/doc";
const ALLOWED = ["query", "mode", "format", "maxrecords", "timespan", "sort"];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
  try {
    const url = new URL(req.url, "http://localhost");
    // stessi default della route FastAPI
    const params = new URLSearchParams({
      mode: "artlist",
      format: "json",
      maxrecords: "100",
      timespan: "24h",
      sort: "hybridrel",
    });
    for (const k of ALLOWED) {
      const v = url.searchParams.get(k);
      if (v !== null) params.set(k, v);
    }
    if (!params.get("query")) {
      return res.status(400).json({ error: "missing required param: query" });
    }

    const upstream = await fetch(`${GDELT}?${params.toString()}`, {
      headers: { "User-Agent": "Mozilla/5.0 world-watcher/1.0" },
      signal: AbortSignal.timeout(50000),
    });
    const body = await upstream.text();
    if (!upstream.ok) {
      return res.status(502).json({ error: `upstream HTTP ${upstream.status}` });
    }
    // server.py fa json.loads(body): upstream non-JSON (rate-limit text) -> 502
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return res.status(502).json({ error: `upstream non-JSON: ${body.slice(0, 120)}` });
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: String(e) });
  }
}
