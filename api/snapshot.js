// /api/snapshot — ultimo snapshot vendored (port di server.py:snapshot).
// Legge web/world/data/snapshot.json (project root = web/ su Vercel).

import { readFile } from "node:fs/promises";
import path from "node:path";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
  try {
    const p = path.join(process.cwd(), "world", "data", "snapshot.json");
    const raw = await readFile(p, "utf-8");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(200).send(raw);
  } catch (e) {
    if (e && e.code === "ENOENT") {
      return res.status(404).json({ error: "no snapshot" });
    }
    return res.status(502).json({ error: String(e) });
  }
}
