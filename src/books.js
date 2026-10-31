// Book factory: turns one essay into a three.js paperback (spine, covers, cream page edges).
import * as THREE from "three";
import { drawTopicArt } from "./art.js";

export const PALETTE = [
  // [cover, ink] — candy-shop colours, ink chosen for contrast
  ["#ff5fa2", "#2a0f1e"], ["#3ee6b0", "#0d2a22"], ["#ffd93d", "#2b2105"], ["#ff8a3d", "#2a1405"],
  ["#9b5cff", "#fff4e6"], ["#ff3d5a", "#fff4e6"], ["#3db8ff", "#081c2a"], ["#a6e22e", "#17220a"],
  ["#ffb38a", "#2a150a"], ["#2ee6e6", "#062626"], ["#ff9ad5", "#2a0f1e"], ["#4d6bff", "#fff4e6"],
];

// Deterministic per-book randomness, so a book always looks the same.
export function rng(seed) {
  let a = seed * 2654435761 >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const colourMemo = new Map();
// Seeded pick per book, never the same colour as the book before it on the shelf.
export function colourIndex(id) {
  if (colourMemo.has(id)) return colourMemo.get(id);
  let i = Math.floor(rng(id * 31 + 7)() * PALETTE.length);
  if (id > 1) { const prev = colourIndex(id - 1); if (i === prev) i = (i + 1 + (id % 5)) % PALETTE.length; }
  colourMemo.set(id, i); return i;
}

export function bookShape(essay) {
  const r = rng(essay.id + 17);
  const [cover, ink] = PALETTE[colourIndex(essay.id)];
  return {
    cover, ink,
    height: 18 + r() * 8,        // cm
    thickness: 1.3 + r() * 2.4,  // cm
    width: 12 + r() * 3,         // cm (cover width = depth on the shelf)
    lean: r() < 0.22 ? (r() < 0.5 ? -1 : 1) * (3 + r() * 4) : 0, // degrees, some books lean
  };
}

const FONT_TITLE = '"Playfair Display", Georgia, serif';
const FONT_BODY = '"Source Serif 4", Georgia, serif';
const FONT_MONO = '"IBM Plex Mono", ui-monospace, monospace';

function wrap(ctx, text, maxW) {
  const words = text.split(/\s+/); const lines = []; let line = "";
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, n >> 8 & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(v * f))));
  return `rgb(${c.join(",")})`;
}

const issue = id => "No. " + String(id).padStart(3, "0");

// Front cover: band with INTERESTING READS + issue number, serif title, image panel, author at the foot.
export function coverCanvas(essay, shape, image, scale = 1) {
  const W = Math.round(512 * scale), H = Math.round(W * shape.height / shape.width);
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d"); const u = W / 512;
  x.fillStyle = shape.cover; x.fillRect(0, 0, W, H);
  // top band
  const bandH = 64 * u;
  x.fillStyle = shape.ink; x.fillRect(0, 0, W, bandH);
  x.fillStyle = shape.cover; x.textBaseline = "middle";
  x.font = `500 ${19 * u}px ${FONT_MONO}`;
  x.letterSpacing = `${3 * u}px`;
  x.fillText("INTERESTING READS", 28 * u, bandH / 2);
  x.textAlign = "right"; x.fillText(issue(essay.id), W - 28 * u, bandH / 2);
  x.textAlign = "left"; x.letterSpacing = "0px";
  // title, auto-sized to fit three or four lines
  let size = 54 * u, lines;
  do { x.font = `700 ${size}px ${FONT_TITLE}`; lines = wrap(x, essay.title, W - 56 * u); size -= 2 * u; }
  while ((lines.length > 4 || lines.length * size * 1.15 > H * 0.3) && size > 22 * u);
  size += 2 * u;
  x.fillStyle = shape.ink; x.textBaseline = "top";
  let y = bandH + 30 * u;
  for (const l of lines) { x.fillText(l, 28 * u, y); y += size * 1.12; }
  // image panel (left empty when there is no cover image)
  const panelTop = y + 18 * u, footH = 78 * u, panelH = H - panelTop - footH;
  x.fillStyle = shade(shape.cover, 0.88);
  x.fillRect(28 * u, panelTop, W - 56 * u, panelH);
  if (image) {
    const pw = W - 56 * u, s = Math.max(pw / image.width, panelH / image.height);
    const iw = image.width * s, ih = image.height * s;
    x.save(); x.beginPath(); x.rect(28 * u, panelTop, pw, panelH); x.clip();
    x.drawImage(image, 28 * u + (pw - iw) / 2, panelTop + (panelH - ih) / 2, iw, ih); x.restore();
  } else if (panelH > 20 * u) {
    drawTopicArt(x, 28 * u, panelTop, W - 56 * u, panelH, essay, shape);
  }
  // author at the foot
  x.fillStyle = shape.ink; x.textBaseline = "middle";
  x.font = `italic 400 ${26 * u}px ${FONT_BODY}`;
  const author = essay.author || essay.publication || "";
  x.fillText(author, 28 * u, H - footH / 2, W - 56 * u);
  return c;
}

export function spineCanvas(essay, shape, scale = 1) {
  const H = Math.round(768 * scale), W = Math.max(24, Math.round(H * shape.thickness / shape.height));
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d");
  x.fillStyle = shape.cover; x.fillRect(0, 0, W, H);
  const bandH = H * 0.09;
  x.fillStyle = shape.ink; x.fillRect(0, 0, W, bandH);
  x.fillStyle = shape.cover; x.textAlign = "center"; x.textBaseline = "middle";
  x.font = `500 ${Math.min(W * 0.32, H * 0.024)}px ${FONT_MONO}`;
  x.fillText(String(essay.id).padStart(3, "0"), W / 2, bandH / 2);
  // title runs top to bottom
  x.save(); x.translate(W / 2, bandH + 14 * scale); x.rotate(Math.PI / 2);
  x.fillStyle = shape.ink; x.textAlign = "left";
  let size = Math.min(W * 0.5, H * 0.045);
  x.font = `700 ${size}px ${FONT_TITLE}`;
  const avail = H * 0.66;
  while (x.measureText(essay.title).width > avail && size > W * 0.22) { size -= 1; x.font = `700 ${size}px ${FONT_TITLE}`; }
  let t = essay.title;
  while (x.measureText(t).width > avail && t.length > 4) t = t.slice(0, -2);
  if (t !== essay.title) t = t.trimEnd() + "…";
  x.fillText(t, 0, 0);
  x.restore();
  // author at the foot
  const author = (essay.author || essay.publication || "").split(/,| and /)[0];
  x.save(); x.translate(W / 2, H - 14 * scale); x.rotate(-Math.PI / 2);
  x.fillStyle = shape.ink; x.textAlign = "left";
  x.font = `italic 400 ${Math.min(W * 0.36, H * 0.026)}px ${FONT_BODY}`;
  x.fillText(author, 0, 0, H * 0.2);
  x.restore();
  return c;
}

let pageTex, backCache = new Map();
function pagesTexture() {
  if (pageTex) return pageTex;
  const c = document.createElement("canvas"); c.width = 64; c.height = 256;
  const x = c.getContext("2d"); x.fillStyle = "#f1e7cf"; x.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 64; i += 2) { x.fillStyle = i % 4 ? "rgba(120,95,60,.10)" : "rgba(120,95,60,.05)"; x.fillRect(i, 0, 1, 256); }
  pageTex = new THREE.CanvasTexture(c); pageTex.colorSpace = THREE.SRGBColorSpace;
  return pageTex;
}

function tex(canvas, anisotropy) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = anisotropy; t.generateMipmaps = true;
  return t;
}

// Returns a Group; the mesh's origin sits at the bottom centre of the book.
let pagesMat;
// Returns a Group; the mesh's origin sits at the bottom centre of the book.
// lazyCover: the front cover starts as a plain board in the cover colour and gets its
// full printed texture from ensureCover() the first time it is seen up close.
export function makeBook(essay, { image = null, anisotropy = 4, scale = 1, lazyCover = false, spineScale = 1, atlas = null } = {}) {
  const shape = bookShape(essay);
  const s = 0.01; // cm → metres
  const geo = new THREE.BoxGeometry(shape.thickness * s, shape.height * s, shape.width * s);
  geo.translate(0, shape.height * s / 2, 0);
  pagesMat ||= new THREE.MeshStandardMaterial({ map: pagesTexture(), roughness: 0.95 });
  let back = backCache.get(shape.cover);
  if (!back) { back = new THREE.MeshStandardMaterial({ color: shape.cover, roughness: 0.6 }); backCache.set(shape.cover, back); }
  const coverMat = lazyCover ? back
    : new THREE.MeshStandardMaterial({ map: tex(coverCanvas(essay, shape, image, scale), anisotropy), roughness: 0.42 });
  let spineMat;
  if (atlas) { // reuse the shelf's packed spine texture: point the spine face at this book's patch
    const [u0, v0, u1, v1] = atlas.uv.get(essay.id), uv = geo.attributes.uv;
    for (let i = 16; i < 20; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    spineMat = atlas.material || (atlas.material = new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.4 }));
  } else spineMat = new THREE.MeshStandardMaterial({ map: tex(spineCanvas(essay, shape, spineScale), anisotropy), roughness: 0.4 });
  // face order: +x front cover, -x back cover, +y top pages, -y bottom pages, +z spine, -z fore-edge
  const mesh = new THREE.Mesh(geo, [coverMat, back, pagesMat, pagesMat, spineMat, pagesMat]);
  mesh.castShadow = true; mesh.receiveShadow = true;
  const g = new THREE.Group(); g.add(mesh);
  g.userData = { essay, shape, mesh, hasCover: !lazyCover, image, anisotropy };
  return g;
}

export function ensureCover(g) {
  const u = g.userData;
  if (u.hasCover) return;
  u.mesh.material[0] = new THREE.MeshStandardMaterial({ map: tex(coverCanvas(u.essay, u.shape, u.image, 1), u.anisotropy), roughness: 0.42 });
  u.hasCover = true;
}

// All spines packed into one texture so the whole shelf can be drawn in a single call.
// Built in small batches, yielding between them, so the page never blocks for long.
export async function buildSpineAtlas(essays, { size = 2048, spineH = 320, batch = 12 } = {}) {
  // pick the smallest height that holds every spine, so the shelf can keep growing
  let need = 0, rx = 0, rows = 1;
  for (const e of essays) { const sh = bookShape(e), w = Math.max(24, Math.round(spineH * sh.thickness / sh.height)); if (rx + w > size) { rx = 0; rows++; } rx += w + 2; }
  need = rows * (spineH + 2);
  const height = need <= 1024 ? 1024 : need <= 2048 ? 2048 : 4096;
  const c = document.createElement("canvas"); c.width = size; c.height = height;
  const x = c.getContext("2d");
  const uv = new Map(); let px = 0, py = 0, pad = 2;
  for (let i = 0; i < essays.length; i++) {
    const e = essays[i], shape = bookShape(e);
    const s = spineCanvas(e, shape, spineH / 768);
    if (px + s.width > size) { px = 0; py += spineH + pad; }
    x.drawImage(s, px, py);
    if (py + s.height > height) throw new Error('spine atlas too small');
    uv.set(e.id, [px / size, 1 - (py + s.height) / height, (px + s.width) / size, 1 - py / height]);
    px += s.width + pad;
    if (i % batch === batch - 1) await new Promise(r => setTimeout(r, 0));
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return { texture: t, uv };
}

export function pagesMap() { return pagesTexture(); }
