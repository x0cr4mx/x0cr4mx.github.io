// K1 ▸ TOP 9 — shared data layer for `detections` (home panel + monitor page).
//
// Ranking: the query returns rows ordered by quality desc; the top-9 pick
// re-scores each row with a SemIf-judgment boost —
//   key = quality + 0.10·(judgment_label === 'valid')
//               − 0.10·(judgment_label === 'impostor')
// then ts desc as tie-break — so analyzed-and-validated detections outrank
// raw-quality peers and impostors sink. Poll-based: detections has no
// realtime publication, callers refresh on a 60s timer.

// Same-origin route served by k1-api behind Caddy in the private deploy.
// Static hosts (GitHub Pages / python http.server) have no /api layer —
// override via window.K1_ENV.DETECTIONS_API. A single shared probe on
// /api/summary decides once per page whether the layer exists at all, so
// nine cards never fan out into nine guaranteed 404s.
const API_DETECTIONS =
  (window.K1_ENV && window.K1_ENV.DETECTIONS_API) || "/api/detections";
const API_PROBE = API_DETECTIONS.replace(/\/detections\/?$/, "/summary");
let _pngApiProbe = null;   // Promise<boolean>|null — resolved once

function _apiUp(tok) {
  if (!_pngApiProbe) {
    // GitHub Pages is always a static host: skip the probe entirely so the
    // console stays clean (an explicit DETECTIONS_API override re-enables it).
    const onPages = /(^|\.)github\.io$/.test(location.hostname);
    if (onPages && !(window.K1_ENV && window.K1_ENV.DETECTIONS_API)) {
      _pngApiProbe = Promise.resolve(false);
    } else {
      _pngApiProbe = fetch(API_PROBE, { headers: { Authorization: `Bearer ${tok}` } })
        // any answer except 404 means the /api layer is alive (401/500 still
        // prove the route exists); 404 or a network error = static host
        .then(r => r.status !== 404)
        .catch(() => false);
    }
  }
  return _pngApiProbe;
}

export async function loadTopDetections(sb, limit = 60) {
  const { data, error } = await sb.from("detections")
    .select("*")
    .order("quality", { ascending: false })
    .order("ts", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

function _ts(d) {
  const t = new Date(d && d.ts).getTime();
  return isFinite(t) ? t : 0;
}

function _rankScore(d) {
  const q = Number(d && d.quality) || 0;
  const lbl = String(d && d.judgment_label || "");
  return q + (lbl === "valid" ? 0.10 : 0) - (lbl === "impostor" ? 0.10 : 0);
}

export function rankDetections(rows, n = 9) {
  return [...(rows || [])]
    .map(d => ({ d, k: _rankScore(d) }))
    .sort((a, b) => (b.k - a.k) || (_ts(b.d) - _ts(a.d)))
    .slice(0, n)
    .map(x => x.d);
}

// detections.symbol is the raw feed symbol; meta.symbol_k1 (when the writer
// provides it) is the normalized k1 label — prefer it for display.
export function detSymbol(d) {
  const m = d && d.meta;
  return (m && typeof m === "object" && m.symbol_k1) || (d && d.symbol) || "—";
}

// GET /api/detections/<id>/chart.png needs an Authorization header that
// <img> cannot send -> fetch as blob and hand out an object URL (caller
// revokes it). Any 401/404/network/non-image answer -> null (e.g. GitHub
// Pages has no /api — the shared probe short-circuits before any request
// is fired, so a static host produces zero chart 404s).
export async function fetchDetectionPng(sb, id) {
  try {
    const { data } = await sb.auth.getSession();
    const tok = data && data.session && data.session.access_token;
    if (!tok) return null;
    if (!(await _apiUp(tok))) return null;
    const r = await fetch(
      `${API_DETECTIONS}/${encodeURIComponent(id)}/chart.png`,
      { headers: { Authorization: `Bearer ${tok}` } });
    if (!r.ok) return null;
    const blob = await r.blob();
    const type = (blob && blob.type) || "";
    if (!type.startsWith("image/")) return null;
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

// status -> SemIf chip {text, cls}. NEW rows are still queued for the local
// SemIf analyzer; ANALYZED carries the judgment label + probability.
export function semifLabel(d) {
  const st = String(d && d.status || "").toUpperCase();
  if (st === "ANALYZED") {
    const lbl = String(d.judgment_label || "?").toUpperCase();
    const p = Number(d.judgment_prob);
    const prob = d.judgment_prob != null && isFinite(p)
      ? ` ${p.toFixed(2)}` : "";
    return {
      text: `SEMIF ${lbl}${prob}`,
      cls: lbl === "VALID" ? "up" : lbl === "IMPOSTOR" ? "down" : "amb",
    };
  }
  if (st === "ERROR") return { text: "SEMIF ERROR", cls: "down" };
  if (st === "SKIPPED") return { text: "SEMIF N/A", cls: "amb" };
  return { text: "SEMIF QUEUED", cls: "amb" };
}
