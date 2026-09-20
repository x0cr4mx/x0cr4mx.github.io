/* ============ WORLD WATCHER — micro charts (canvas, no deps) ============ */
const Charts = (() => {
  const C = { amber: "#ffb000", red: "#ff2d2d", orange: "#ff6a00", green: "#28c76f", cyan: "#39c2d7", dim: "#5a5a66", grid: "#1c1c24", text: "#b8b8c0" };

  function ctx(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 300, h = canvas.clientHeight || +canvas.getAttribute("height") || 150;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.height = h + "px";
    const c = canvas.getContext("2d");
    c.scale(dpr, dpr);
    c.font = "9px " + getComputedStyle(document.body).fontFamily;
    return { c, w, h };
  }

  /* horizontal bars: items = [{label, value, color?}] */
  function bars(canvas, items, { maxLabel = 14, fmt = (v) => v } = {}) {
    const { c, w, h } = ctx(canvas);
    c.clearRect(0, 0, w, h);
    if (!items.length) { c.fillStyle = C.dim; c.fillText("no data", 8, 14); return; }
    const max = Math.max(...items.map((i) => i.value), 1e-9);
    const labelW = 92, valW = 40, barW = w - labelW - valW - 16;
    const rh = Math.min(18, (h - 8) / items.length);
    items.forEach((it, i) => {
      const y = 4 + i * rh;
      c.fillStyle = C.text;
      const lab = it.label.length > maxLabel ? it.label.slice(0, maxLabel - 1) + "…" : it.label;
      c.fillText(lab, 0, y + rh * 0.68);
      const bw = Math.max(1.5, (it.value / max) * barW);
      c.fillStyle = it.color || C.amber;
      c.fillRect(labelW, y + 1, bw, rh - 4);
      c.fillStyle = "rgba(255,255,255,.08)";
      c.fillRect(labelW + bw, y + 1, barW - bw, rh - 4);
      c.fillStyle = C.text;
      c.fillText(fmt(it.value), labelW + barW + 6, y + rh * 0.68);
    });
  }

  /* line: series = [{date|x, value}] */
  function line(canvas, series, { fmt = (v) => v.toFixed(1), zeroLine = true } = {}) {
    const { c, w, h } = ctx(canvas);
    c.clearRect(0, 0, w, h);
    const pts = series.map((p) => (typeof p === "number" ? p : p.value));
    if (!pts.length) { c.fillStyle = C.dim; c.fillText("no data", 8, 14); return; }
    const min = Math.min(...pts), max = Math.max(...pts);
    const pad = (max - min) * 0.12 || 1;
    const lo = min - pad, hi = max + pad;
    const X = (i) => 6 + (i / Math.max(1, pts.length - 1)) * (w - 12);
    const Y = (v) => h - 16 - ((v - lo) / (hi - lo)) * (h - 26);
    // gridlines
    c.strokeStyle = C.grid; c.fillStyle = C.dim;
    for (let g = 0; g <= 3; g++) {
      const v = lo + ((hi - lo) * g) / 3, y = Y(v);
      c.beginPath(); c.moveTo(6, y); c.lineTo(w - 6, y); c.stroke();
      c.fillText(fmt(v), 4, y - 2);
    }
    if (zeroLine && lo < 0 && hi > 0) {
      c.strokeStyle = "#333340";
      c.beginPath(); c.moveTo(6, Y(0)); c.lineTo(w - 6, Y(0)); c.stroke();
    }
    // area+line
    c.beginPath();
    pts.forEach((v, i) => (i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v))));
    c.strokeStyle = C.cyan; c.lineWidth = 1.4; c.stroke();
    c.lineTo(X(pts.length - 1), h - 16); c.lineTo(X(0), h - 16); c.closePath();
    c.fillStyle = "rgba(57,194,215,.12)"; c.fill();
    // last value marker
    c.fillStyle = C.amber;
    c.beginPath(); c.arc(X(pts.length - 1), Y(pts.at(-1)), 2.5, 0, 7); c.fill();
    c.fillText(fmt(pts.at(-1)), Math.min(X(pts.length - 1) + 5, w - 34), Y(pts.at(-1)) - 4);
  }

  /* donut semplice per distribution */
  function gauge(canvas, value, max, color) {
    const { c, w, h } = ctx(canvas);
    c.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 6;
    c.lineWidth = 6;
    c.strokeStyle = "#1c1c24";
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = color || C.amber;
    c.beginPath(); c.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (value / max) * Math.PI * 2); c.stroke();
    c.fillStyle = "#fff"; c.font = "bold 16px " + getComputedStyle(document.body).fontFamily;
    c.textAlign = "center"; c.fillText(String(Math.round(value)), cx, cy + 5); c.textAlign = "left";
  }

  return { bars, line, gauge };
})();
