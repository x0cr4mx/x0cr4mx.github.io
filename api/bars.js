// /api/bars — market data fallback per i chart (Binance public klines).
// GET /api/bars?symbol=BINANCE:BTCUSDT&tf=60&n=140
//   -> https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=140
// Output: {symbol, timeframe, interval, t[ms], o, h, l, c, v} (array di numeri).

const BINANCE = "https://api.binance.com/api/v3/klines";
const TF = {
  "1": "1m", "5": "5m", "15": "15m", "60": "1h",
  "240": "4h", "1D": "1d", "1W": "1w",
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
  try {
    const url = new URL(req.url, "http://localhost");
    let symbol = (url.searchParams.get("symbol") || "").trim().toUpperCase();
    const tf = url.searchParams.get("tf") || "60";
    const nRaw = parseInt(url.searchParams.get("n") || "140", 10);
    const n = Math.min(Math.max(Number.isFinite(nRaw) ? nRaw : 140, 1), 1500);

    const interval = TF[tf];
    if (!interval) {
      return res.status(400).json({ error: `unsupported tf: ${tf}` });
    }
    if (symbol.startsWith("BINANCE:")) {
      symbol = symbol.slice("BINANCE:".length);
    } else if (symbol.includes(":")) {
      // exchange diverso da Binance: non servibile qui
      return res.status(404).json({ error: `non-binance symbol: ${symbol}` });
    }
    if (!/^[A-Z0-9]{2,24}$/.test(symbol)) {
      return res.status(400).json({ error: `bad symbol: ${symbol}` });
    }

    const u = `${BINANCE}?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${n}`;
    const r = await fetch(u, {
      headers: { "User-Agent": "k1-terminal/1.0" },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
      return res.status(502).json({ error: `binance HTTP ${r.status}` });
    }
    const k = await r.json();
    if (!Array.isArray(k)) {
      return res.status(502).json({ error: "unexpected binance payload" });
    }
    // klines: [openTime, open, high, low, close, volume, closeTime, ...]
    const t = [], o = [], h = [], l = [], c = [], v = [];
    for (const row of k) {
      t.push(Number(row[0]));
      o.push(Number(row[1]));
      h.push(Number(row[2]));
      l.push(Number(row[3]));
      c.push(Number(row[4]));
      v.push(Number(row[5]));
    }
    return res.status(200).json({ symbol, timeframe: tf, interval, t, o, h, l, c, v });
  } catch (e) {
    return res.status(502).json({ error: String(e) });
  }
}
