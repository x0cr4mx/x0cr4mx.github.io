// /api/gnews — proxy Google News RSS per edizione paese (CORS-free).
// Port di server.py:gnews_proxy (FastAPI) -> Vercel function.
// Params: gl, hl, ceid, q (q -> /rss/search?q=...)

const GNEWS = "https://news.google.com/rss";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=1200");
  try {
    const url = new URL(req.url, "http://localhost");
    const gl = url.searchParams.get("gl") || "US";
    const hl = url.searchParams.get("hl") || "en";
    const ceid = url.searchParams.get("ceid") || "US:en";
    const q = url.searchParams.get("q");

    // server.py: base = GNEWS + ("/search?q=" + quote(q) if q else "")
    const base = GNEWS + (q ? `/search?q=${encodeURIComponent(q)}` : "");
    const sep = base.includes("?") ? "&" : "?";
    const upstream =
      `${base}${sep}hl=${encodeURIComponent(hl)}` +
      `&gl=${encodeURIComponent(gl)}&ceid=${encodeURIComponent(ceid)}`;

    const r = await fetch(upstream, {
      headers: { "User-Agent": "Mozilla/5.0 world-watcher/1.0" },
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) {
      return res.status(502).json({ error: `upstream HTTP ${r.status}` });
    }
    // bytes pass-through (server.py: PlainTextResponse(body, application/rss+xml))
    const body = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
    return res.status(200).send(body);
  } catch (e) {
    return res.status(502).json({ error: String(e) });
  }
}
