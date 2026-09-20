/* ============ WORLD WATCHER — geo utils ============
   Reverse-geocoding client-side: dato [lon,lat] trova l'ISO3 del paese.
   Bbox prefilter + ray-casting sui poligoni del GeoJSON. */
const GeoUtil = (() => {
  let features = [];
  let bboxes = [];

  function init(geojson) {
    features = geojson.features;
    bboxes = features.map((f) => {
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      const polys = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates];
      for (const poly of polys)
        for (const ring of poly)
          for (const [x, y] of ring) {
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
      return { minX, minY, maxX, maxY };
    });
  }

  // antimeridian-safe: paesi che attraversano 180 (RU, FJ, US via Aleutine)
  const WRAP = new Set(["RUS", "FJI", "USA", "NZL"]);

  function pointInRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function pointInPoly(x, y, poly) {
    if (!pointInRing(x, y, poly[0])) return false;
    for (let h = 1; h < poly.length; h++) if (pointInRing(x, y, poly[h])) return false;
    return true;
  }

  function normLon(lon) { while (lon > 180) lon -= 360; while (lon < -180) lon += 360; return lon; }

  // ritorna feature.id (ISO3-ish) o null
  function locate(lon, lat) {
    lon = normLon(lon);
    for (let i = 0; i < features.length; i++) {
      const b = bboxes[i];
      const id = features[i].id;
      const inX = WRAP.has(id)
        ? lon >= b.minX || lon <= b.maxX
        : lon >= b.minX && lon <= b.maxX;
      if (!inX || lat < b.minY || lat > b.maxY) continue;
      const geom = features[i].geometry;
      const polys = geom.type === "MultiPolygon" ? geom.coordinates : [geom.coordinates];
      for (const poly of polys) if (pointInPoly(lon, lat, poly)) return id;
    }
    return null;
  }

  return { init, locate };
})();
