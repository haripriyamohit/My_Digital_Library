// Original cover art: one small illustration per topic, varied per book with a seeded random,
// drawn in the book's own two colours. No outside pictures are used.
import { rng } from "./books.js";

function mix(hex, toward, f) {
  const a = parseInt(hex.slice(1), 16), b = parseInt(toward.slice(1), 16);
  const ch = (n, s) => (n >> s) & 255;
  const m = s => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * f);
  return `rgb(${m(16)},${m(8)},${m(0)})`;
}

const TOPIC_KEYS = [
  ["mind", mind], ["money", money], ["history", history], ["ai", ai], ["science", science],
  ["research", research], ["india", india], ["geopolitics", geopolitics], ["philosophy", philosophy], ["writing", writing],
];
function pick(topic = "") {
  const t = topic.toLowerCase();
  for (const [k, fn] of TOPIC_KEYS) if (k === "ai" ? /^ai\b/.test(t) : t.startsWith(k)) return fn;
  return writing;
}

// x, y, w, h: the panel on the cover. shape: {cover, ink}.
export function drawTopicArt(ctx, x, y, w, h, essay, shape) {
  const r = rng((essay.id || 1) * 97 + 13);
  const ink = shape.ink, paper = shape.cover;
  const c = {
    ink, paper,
    soft: mix(paper, ink, 0.18), mid: mix(paper, ink, 0.45), strong: mix(paper, ink, 0.75),
    light: mix(paper, "#ffffff", 0.35),
  };
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = c.soft; ctx.fillRect(x, y, w, h);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  pick(essay.topic)(ctx, { x, y, w, h, cx: x + w / 2, cy: y + h / 2, s: Math.min(w, h) }, c, r);
  ctx.restore();
}

// ---- one drawing per topic ----

function mind(g, b, c, r) { // a head in profile with a looping thought line
  const s = b.s * 0.42, hx = b.cx - s * 0.15, hy = b.cy + s * 0.1;
  g.fillStyle = c.mid; g.beginPath();
  g.moveTo(hx - s * 0.55, hy + s * 0.95);
  g.bezierCurveTo(hx - s * 0.6, hy + s * 0.4, hx - s * 0.75, hy - s * 0.2, hx - s * 0.5, hy - s * 0.6);
  g.bezierCurveTo(hx - s * 0.2, hy - s * 1.0, hx + s * 0.55, hy - s * 0.95, hx + s * 0.7, hy - s * 0.35);
  g.bezierCurveTo(hx + s * 0.78, hy - s * 0.1, hx + s * 0.72, hy + s * 0.05, hx + s * 0.88, hy + s * 0.25);
  g.lineTo(hx + s * 0.7, hy + s * 0.32);
  g.bezierCurveTo(hx + s * 0.72, hy + s * 0.55, hx + s * 0.55, hy + s * 0.62, hx + s * 0.3, hy + s * 0.6);
  g.lineTo(hx + s * 0.3, hy + s * 0.95); g.closePath(); g.fill();
  // looping line inside the head
  g.strokeStyle = c.light; g.lineWidth = s * 0.05; g.beginPath();
  const loops = 3 + Math.floor(r() * 3);
  for (let i = 0; i <= 120; i++) {
    const t = i / 120, a = t * Math.PI * 2 * loops;
    const px = hx - s * 0.35 + t * s * 0.75 + Math.cos(a) * s * 0.14;
    const py = hy - s * 0.35 + Math.sin(a) * s * 0.16 + Math.sin(t * 3) * s * 0.05;
    i ? g.lineTo(px, py) : g.moveTo(px, py);
  }
  g.stroke();
  dots(g, b, c, r, 5);
}

function money(g, b, c, r) { // stacked coins and a rising line
  const n = 3 + Math.floor(r() * 3), cw = b.w / (n + 1.5), base = b.y + b.h * 0.86;
  for (let i = 0; i < n; i++) {
    const cx = b.x + cw * (i + 1), stack = 2 + Math.floor(r() * 6) + i;
    for (let k = 0; k < stack; k++) {
      const yy = base - k * cw * 0.16;
      g.fillStyle = k % 2 ? c.mid : c.strong;
      g.beginPath(); g.ellipse(cx, yy, cw * 0.38, cw * 0.12, 0, 0, Math.PI * 2); g.fill();
    }
  }
  g.strokeStyle = c.ink; g.lineWidth = b.s * 0.025; g.beginPath();
  let py = b.y + b.h * 0.6;
  g.moveTo(b.x + b.w * 0.08, py);
  for (let i = 1; i <= 6; i++) { py -= b.h * (0.02 + r() * 0.07) * (r() < 0.25 ? -1 : 1); g.lineTo(b.x + b.w * (0.08 + i * 0.14), Math.max(b.y + b.h * 0.12, py)); }
  g.stroke();
}

function history(g, b, c, r) { // a row of columns under a pediment, with a low sun
  const n = 4 + Math.floor(r() * 3), left = b.x + b.w * 0.12, right = b.x + b.w * 0.88;
  const top = b.y + b.h * 0.38, bot = b.y + b.h * 0.86, step = (right - left) / (n - 1);
  g.fillStyle = c.light; g.beginPath(); g.arc(b.x + b.w * (0.25 + r() * 0.5), b.y + b.h * 0.22, b.s * 0.12, 0, Math.PI * 2); g.fill();
  g.fillStyle = c.strong;
  g.beginPath(); g.moveTo(left - step * 0.4, top); g.lineTo(b.cx, top - b.h * 0.14); g.lineTo(right + step * 0.4, top); g.closePath(); g.fill();
  g.fillRect(left - step * 0.4, top, right - left + step * 0.8, b.h * 0.04);
  for (let i = 0; i < n; i++) {
    const cx = left + i * step, cw = step * 0.32;
    g.fillStyle = c.mid; g.fillRect(cx - cw / 2, top + b.h * 0.05, cw, bot - top - b.h * 0.07);
    g.fillStyle = c.strong; g.fillRect(cx - cw * 0.7, bot - b.h * 0.03, cw * 1.4, b.h * 0.03);
  }
  g.fillStyle = c.strong; g.fillRect(b.x, bot, b.w, b.h * 0.05);
}

function ai(g, b, c, r) { // a network of nodes and links
  const pts = [], cols = 4, rows = 4;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++)
    pts.push([b.x + b.w * (0.15 + i * 0.233 + (r() - 0.5) * 0.08), b.y + b.h * (0.15 + j * 0.233 + (r() - 0.5) * 0.08)]);
  g.strokeStyle = c.mid; g.lineWidth = b.s * 0.012;
  for (let i = 0; i < pts.length; i++) for (let k = i + 1; k < pts.length; k++) {
    const d = Math.hypot(pts[i][0] - pts[k][0], pts[i][1] - pts[k][1]);
    if (d < b.s * 0.36 && r() < 0.7) { g.beginPath(); g.moveTo(...pts[i]); g.lineTo(...pts[k]); g.stroke(); }
  }
  for (const [px, py] of pts) {
    const big = r() < 0.25;
    g.fillStyle = big ? c.ink : c.strong; g.beginPath(); g.arc(px, py, b.s * (big ? 0.045 : 0.028), 0, Math.PI * 2); g.fill();
    if (big) { g.fillStyle = c.light; g.beginPath(); g.arc(px, py, b.s * 0.018, 0, Math.PI * 2); g.fill(); }
  }
}

function science(g, b, c, r) { // a double helix
  const turns = 1.6 + r() * 0.8, amp = b.w * 0.22, top = b.y + b.h * 0.08, len = b.h * 0.84;
  for (let i = 0; i <= 22; i++) {
    const t = i / 22, yy = top + t * len, a = t * Math.PI * 2 * turns;
    const x1 = b.cx + Math.sin(a) * amp, x2 = b.cx - Math.sin(a) * amp;
    g.strokeStyle = c.mid; g.lineWidth = b.s * 0.018; g.beginPath(); g.moveTo(x1, yy); g.lineTo(x2, yy); g.stroke();
  }
  for (const sgn of [1, -1]) {
    g.strokeStyle = sgn > 0 ? c.ink : c.strong; g.lineWidth = b.s * 0.04; g.beginPath();
    for (let i = 0; i <= 100; i++) {
      const t = i / 100, yy = top + t * len, xx = b.cx + sgn * Math.sin(t * Math.PI * 2 * turns) * amp;
      i ? g.lineTo(xx, yy) : g.moveTo(xx, yy);
    }
    g.stroke();
  }
}

function research(g, b, c, r) { // a stack of books and a flask
  const bw = b.w * 0.5, bx = b.x + b.w * 0.1; let yy = b.y + b.h * 0.88;
  const n = 3 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const h = b.h * (0.07 + r() * 0.04), off = (r() - 0.5) * b.w * 0.06;
    yy -= h; g.fillStyle = i % 2 ? c.mid : c.strong; g.fillRect(bx + off, yy, bw, h);
    g.fillStyle = c.light; g.fillRect(bx + off + bw * 0.08, yy + h * 0.35, bw * 0.5, h * 0.12);
  }
  const fx = b.x + b.w * 0.78, fb = b.y + b.h * 0.88, fw = b.w * 0.32, fh = b.h * 0.5;
  g.fillStyle = c.mid; g.beginPath();
  g.moveTo(fx - fw * 0.12, fb - fh); g.lineTo(fx + fw * 0.12, fb - fh); g.lineTo(fx + fw * 0.12, fb - fh * 0.6);
  g.lineTo(fx + fw * 0.5, fb); g.lineTo(fx - fw * 0.5, fb); g.lineTo(fx - fw * 0.12, fb - fh * 0.6); g.closePath(); g.fill();
  g.fillStyle = c.ink; g.beginPath();
  g.moveTo(fx - fw * 0.33, fb - fh * 0.25); g.lineTo(fx + fw * 0.33, fb - fh * 0.25); g.lineTo(fx + fw * 0.5, fb); g.lineTo(fx - fw * 0.5, fb); g.closePath(); g.fill();
  for (let i = 0; i < 3; i++) { g.fillStyle = c.light; g.beginPath(); g.arc(fx + (r() - 0.5) * fw * 0.3, fb - fh * (0.75 + i * 0.12) - b.h * 0.05, b.s * (0.015 + r() * 0.02), 0, Math.PI * 2); g.fill(); }
}

function india(g, b, c, r) { // a lattice (jaali) of interlocking circles
  const n = 3 + Math.floor(r() * 2), cell = b.w / n, rad = cell * 0.5;
  g.strokeStyle = c.strong; g.lineWidth = b.s * 0.02;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= Math.ceil(b.h / cell); j++) {
    const px = b.x + i * cell, py = b.y + j * cell;
    g.beginPath(); g.arc(px, py, rad, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(px + cell / 2, py + cell / 2, rad, 0, Math.PI * 2); g.stroke();
  }
  g.fillStyle = c.paper; g.beginPath(); g.arc(b.cx, b.cy, b.s * 0.2, 0, Math.PI * 2); g.fill();
  const petals = 8; g.fillStyle = c.ink;
  for (let k = 0; k < petals; k++) {
    const a = k / petals * Math.PI * 2;
    g.save(); g.translate(b.cx, b.cy); g.rotate(a);
    g.beginPath(); g.ellipse(0, -b.s * 0.1, b.s * 0.035, b.s * 0.08, 0, 0, Math.PI * 2); g.fill(); g.restore();
  }
  g.fillStyle = c.light; g.beginPath(); g.arc(b.cx, b.cy, b.s * 0.04, 0, Math.PI * 2); g.fill();
}

function geopolitics(g, b, c, r) { // a globe with meridians and a few routes
  const R = b.s * 0.36, tilt = (r() - 0.5) * 0.5;
  g.fillStyle = c.mid; g.beginPath(); g.arc(b.cx, b.cy, R, 0, Math.PI * 2); g.fill();
  g.save(); g.translate(b.cx, b.cy); g.rotate(tilt);
  g.strokeStyle = c.light; g.lineWidth = b.s * 0.012;
  for (let k = -2; k <= 2; k++) { g.beginPath(); g.ellipse(0, 0, Math.abs(k) * R / 2.5 || 1, R, 0, 0, Math.PI * 2); g.stroke(); }
  for (let k = -2; k <= 2; k++) { const yy = k * R / 3, hw = Math.sqrt(R * R - yy * yy); g.beginPath(); g.moveTo(-hw, yy); g.lineTo(hw, yy); g.stroke(); }
  g.restore();
  g.strokeStyle = c.ink; g.lineWidth = b.s * 0.02; g.setLineDash([b.s * 0.03, b.s * 0.025]);
  for (let i = 0; i < 2; i++) {
    const a1 = r() * Math.PI * 2, a2 = a1 + 1 + r() * 2;
    const p1 = [b.cx + Math.cos(a1) * R * 0.7, b.cy + Math.sin(a1) * R * 0.7], p2 = [b.cx + Math.cos(a2) * R * 0.7, b.cy + Math.sin(a2) * R * 0.7];
    g.beginPath(); g.moveTo(...p1); g.quadraticCurveTo(b.cx, b.cy - R * 1.1, ...p2); g.stroke();
    g.fillStyle = c.ink; for (const p of [p1, p2]) { g.beginPath(); g.arc(p[0], p[1], b.s * 0.022, 0, Math.PI * 2); g.fill(); }
  }
  g.setLineDash([]);
}

function philosophy(g, b, c, r) { // a sun over a hill with a single tree
  const sy = b.y + b.h * (0.3 + r() * 0.1), sx = b.x + b.w * (0.3 + r() * 0.4);
  g.strokeStyle = c.mid; g.lineWidth = b.s * 0.015;
  for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2; g.beginPath(); g.moveTo(sx + Math.cos(a) * b.s * 0.15, sy + Math.sin(a) * b.s * 0.15); g.lineTo(sx + Math.cos(a) * b.s * 0.22, sy + Math.sin(a) * b.s * 0.22); g.stroke(); }
  g.fillStyle = c.light; g.beginPath(); g.arc(sx, sy, b.s * 0.12, 0, Math.PI * 2); g.fill();
  g.fillStyle = c.strong; g.beginPath(); g.moveTo(b.x, b.y + b.h);
  g.quadraticCurveTo(b.cx, b.y + b.h * 0.5, b.x + b.w, b.y + b.h * 0.85); g.lineTo(b.x + b.w, b.y + b.h); g.closePath(); g.fill();
  const tx = b.x + b.w * (r() < 0.5 ? 0.3 : 0.65), ty = b.y + b.h * 0.74;
  g.strokeStyle = c.ink; g.lineWidth = b.s * 0.025; g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx, ty - b.h * 0.18); g.stroke();
  g.fillStyle = c.ink; g.beginPath(); g.arc(tx, ty - b.h * 0.22, b.s * 0.09, 0, Math.PI * 2); g.fill();
}

function writing(g, b, c, r) { // a pen nib over ruled lines
  g.strokeStyle = c.mid; g.lineWidth = b.s * 0.012;
  for (let yy = b.y + b.h * 0.15; yy < b.y + b.h * 0.95; yy += b.h * 0.1) {
    g.beginPath(); g.moveTo(b.x + b.w * 0.08, yy); g.lineTo(b.x + b.w * (0.5 + r() * 0.42), yy); g.stroke();
  }
  g.save(); g.translate(b.cx + b.w * 0.05, b.cy); g.rotate(-0.6 + (r() - 0.5) * 0.3);
  const L = b.s * 0.5, W = b.s * 0.16;
  g.fillStyle = c.ink; g.beginPath();
  g.moveTo(0, L * 0.55); g.lineTo(-W, -L * 0.05); g.lineTo(-W * 0.8, -L * 0.45); g.lineTo(W * 0.8, -L * 0.45); g.lineTo(W, -L * 0.05); g.closePath(); g.fill();
  g.fillStyle = c.light; g.beginPath(); g.arc(0, -L * 0.05, W * 0.18, 0, Math.PI * 2); g.fill();
  g.strokeStyle = c.light; g.lineWidth = b.s * 0.01; g.beginPath(); g.moveTo(0, -L * 0.02); g.lineTo(0, L * 0.5); g.stroke();
  g.fillStyle = c.strong; g.fillRect(-W * 0.9, -L * 0.75, W * 1.8, L * 0.3);
  g.restore();
}

function dots(g, b, c, r, n) {
  g.fillStyle = c.strong;
  for (let i = 0; i < n; i++) { g.beginPath(); g.arc(b.x + b.w * (0.72 + r() * 0.22), b.y + b.h * (0.08 + r() * 0.3), b.s * (0.012 + r() * 0.02), 0, Math.PI * 2); g.fill(); }
}
