import * as THREE from "three";
import * as CANNON from "cannon-es";
import "./fonts.js";
import "./style.css";
import { makeBook, PALETTE, buildSpineAtlas, pagesMap, bookShape, coverCanvas } from "./books.js";
import { readFile, suggestDetails, plainDetails } from "./add.js";
import { makeRenderer, addLights, woodTexture, loadFonts } from "./scene-kit.js";

/* ---------- small helpers ---------- */
const qs = new URLSearchParams(location.search);
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches || qs.has("still");
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeIn = t => t * t * t;
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const TAU = Math.PI * 2;
const wrapPi = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const issue = id => String(id).padStart(3, "0");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const IR = window.__ir = { ready: false, firstFrame: 0, t0: performance.now(), marks: [] };
const mark = (n, t0) => IR.marks.push([n, Math.round(t0), Math.round(performance.now() - t0)]);

let DATA = [], TOPICS = [], byId = new Map(), coverImages = new Map();
let topic = null;                 // current topic filter (null = all)
let has3D = false;

/* ---------- boot ---------- */
init();
async function init() {
  DATA = await (await fetch("./essays.json")).json();
  TOPICS = [...new Set(DATA.map(e => e.topic))];
  DATA.forEach(e => byId.set(e.id, e));
  // covers: an item with "cover": "covers/091.jpg" gets that picture in the middle of its front cover
  for (const e of DATA) if (e.cover) { const img = new Image(); img.onload = () => coverImages.set(e.id, img); img.src = e.cover; }
  buildChips(); buildSrList(); buildPlainList(); setupSearch(); typeHeading();
  $("surprise").addEventListener("click", surprise);
  let ok = !qs.has("nogl");
  if (ok) { try { await start3D(); has3D = true; } catch (e) { console.error("3D failed", e); ok = false; } }
  if (!ok) showFallback();
  setupAdd(); setupOwner();
  await initStore();
  addEventListener("hashchange", handleHash);
  handleHash();
}

/* ---------- heading typed letter by letter (space is reserved, so nothing shifts) ---------- */
function typeHeading() {
  const text = "Welcome to Interesting Reads";
  const el = document.querySelector("#title .typed");
  if (REDUCED) { el.textContent = text; return; }
  let i = 0; const caret = '<span class="caret"></span>';
  const step = () => {
    el.innerHTML = esc(text.slice(0, i)) + caret;
    if (i++ < text.length) setTimeout(step, i === 1 ? 250 : 45 + Math.random() * 45);
    else setTimeout(() => { el.textContent = text; }, 1600);
  };
  step();
}

/* ---------- topic chips ---------- */
function buildChips() {
  const box = $("topics");
  const chip = (label, t, colour) =>
    `<button class="chip" type="button" data-topic="${esc(t ?? "")}" aria-pressed="${(topic ?? "") === (t ?? "")}" style="--chip:${colour}">${esc(label)}</button>`;
  if (!box.children.length) box.innerHTML = chip("All shelves", null, "#f3ecdc") +
    TOPICS.map((t, i) => chip(t, t, PALETTE[(i * 5) % PALETTE.length][0])).join("");
  box.addEventListener("click", ev => {
    const b = ev.target.closest(".chip"); if (!b) return;
    setTopic(b.dataset.topic || null);
  });
}
function syncChips() {
  for (const b of $("topics").children) b.setAttribute("aria-pressed", String((b.dataset.topic || null) === topic));
}

/* ---------- screen reader list and plain fallback list ---------- */
function buildSrList() {
  if (!$("srList").children.length) $("srList").innerHTML = DATA.map(e =>
    `<li><button type="button" tabindex="-1" data-id="${e.id}">Open ${esc(e.title)}${e.author ? ", by " + esc(e.author) : ""}</button></li>`).join("");
  $("srList").addEventListener("click", ev => { const b = ev.target.closest("button"); if (b) goToBook(+b.dataset.id); });
}
function buildPlainList() {
  if (!$("plainBody").children.length) $("plainBody").innerHTML = TOPICS.map(t => `<section data-topic="${esc(t)}"><h3>${esc(t)}</h3><ol>` +
    DATA.filter(e => e.topic === t).map(e => `<li id="p-${e.id}" tabindex="-1"><a href="${esc(e.link)}" target="_blank" rel="noopener">${esc(e.title)}</a>` +
      ` <span class="m">${esc([e.author, e.publication, e.year].filter(Boolean).join(" · "))}</span><br>${esc(e.description)}</li>`).join("") +
    `</ol></section>`).join("");
}
function showFallback() {
  $("stage").hidden = true; $("srList").hidden = true; $("list").hidden = false;
  if (qs.has("nogl")) $("plainNote").textContent = "Plain list view.";
  IR.ready = true; IR.firstFrame = performance.now(); document.body.dataset.ready = "1";
}
function filterPlain() {
  for (const s of $("plainBody").children) s.hidden = !!topic && s.dataset.topic !== topic;
}

/* ---------- search ---------- */
function setupSearch() {
  const q = $("q"), box = $("results"); let hits = [], sel = -1;
  const render = () => {
    const v = q.value.trim().toLowerCase();
    if (!v) { box.hidden = true; q.setAttribute("aria-expanded", "false"); return; }
    const words = v.split(/\s+/);
    hits = DATA.filter(e => { const h = [e.title, e.author, e.publication, e.description, e.topic, e.year].join(" ").toLowerCase(); return words.every(w => h.includes(w)); }).slice(0, 8);
    sel = hits.length ? 0 : -1;
    box.innerHTML = hits.length ? hits.map((e, i) => `<li role="option" id="opt-${e.id}" data-id="${e.id}" aria-selected="${i === sel}"><span class="r-t">${esc(e.title)}</span><span class="r-m">${esc([e.author, e.topic].filter(Boolean).join(" · "))}</span></li>`).join("")
      : `<li class="r-none" role="option" aria-disabled="true">Nothing found. Try an author or a topic.</li>`;
    box.hidden = false; q.setAttribute("aria-expanded", "true");
    q.setAttribute("aria-activedescendant", sel >= 0 ? "opt-" + hits[sel].id : "");
  };
  const mark = () => { [...box.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === sel))); q.setAttribute("aria-activedescendant", sel >= 0 ? "opt-" + hits[sel].id : ""); };
  const pick = id => { box.hidden = true; q.setAttribute("aria-expanded", "false"); goToBook(id); };
  q.addEventListener("input", render);
  q.addEventListener("keydown", ev => {
    if (ev.key === "ArrowDown" && hits.length) { sel = (sel + 1) % hits.length; mark(); ev.preventDefault(); }
    else if (ev.key === "ArrowUp" && hits.length) { sel = (sel - 1 + hits.length) % hits.length; mark(); ev.preventDefault(); }
    else if (ev.key === "Enter" && sel >= 0) { pick(hits[sel].id); ev.preventDefault(); }
    else if (ev.key === "Escape") { box.hidden = true; q.setAttribute("aria-expanded", "false"); }
  });
  box.addEventListener("pointerdown", ev => { const li = ev.target.closest("li[data-id]"); if (li) { ev.preventDefault(); pick(+li.dataset.id); } });
  q.addEventListener("blur", () => setTimeout(() => { box.hidden = true; q.setAttribute("aria-expanded", "false"); }, 120));
}

function announce(msg) { $("live").textContent = msg; }

/* ---------- share links ---------- */
function handleHash() {
  const m = /^#book-(\d{1,3})$/.exec(location.hash);
  if (m && byId.has(+m[1])) goToBook(+m[1], { fromHash: true });
}
function shareUrl(id) { return location.href.split("#")[0] + "#book-" + issue(id); }

/* =====================================================================
   3D shelf
   ===================================================================== */
const S = 0.01, GAP = 0.0028, DEPTH_IN = 0.08;
let renderer, scene, camera, shelf, books = [], R = 0.8, RS = 0.72;
let rot = 0, rotVel = 0, autoSpeed = 0.045;
let tableTop = -0.27, TABLE = { x: 0.65, z0: 0, z1: 0 };
let world = null, staticShelfBodies = [], floorBody, tableMesh = null;
let hovered = null, keySel = null, openB = null, busy = false, queuedTopic = undefined;
let pointerInside = false, touchHoldUntil = 0, dragging = false;
let viewOff = { x: 0, y: 0 }, viewOffTarget = { x: 0, y: 0 };
let W = 1, H = 1, narrow = false;
let dirty = true, running = true, anims = [];
const raycaster = new THREE.Raycaster(); const ndc = new THREE.Vector2(); let pointerMoved = false, pointerOnCanvas = false;

IR._programs = () => renderer.info.programs.map(p => p.id + ' ' + p.name + ' ' + p.usedTimes + ' ' + p.cacheKey.split(',').filter((x, i) => i < 3 || /true|Mipmap|Map|instanc|depth|shadow|fog|ton/i.test(x)).join(',').slice(0, 220));
IR.debug = () => { const c = {}; for (const b of books) c[b.mode] = (c[b.mode] || 0) + 1; return { modes: c, busy, topic, sample: books.slice(0, 6).map(b => [b.id, b.mode, +b.root.position.y.toFixed(2)]) }; };
async function start3D() {
  let T0 = performance.now(); await loadFonts(); mark('fonts', T0);
  const canvas = $("gl");
  renderer = makeRenderer(canvas, { quality: qs.get("q") || "high" });
  const gl = renderer.getContext(); if (!gl) throw new Error("no webgl");
  renderer.debug.checkShaderErrors = !!import.meta.env.DEV; // the check forces every shader build to stall the page
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "";
  IR.gpu = gpu;
  if (qs.has("fullres")) { pr = prMin = prMax = 1; }
  else if (/swiftshader|llvmpipe|software|basic render/i.test(gpu) || qs.has("low")) { pr = prMin = 0.6; prMax = 0.8; }
  else if ((navigator.hardwareConcurrency || 8) <= 4) { pr = Math.min(pr, 1.25); }
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(34, 1, 0.05, 12);

  let T = performance.now(); await buildShelf(); mark('atlas', T);
  const { key } = addLights(scene, { span: 0.95, shadowSize: qs.get("shadow") ? +qs.get("shadow") : 1024 });
  keyLight = key; placeLight(); scene.add(key.target);
  scene.fog = new THREE.Fog(0x000000, 1.6, 3.4);

  // events
  const stage = $("stage");
  new ResizeObserver(resize).observe(stage); resize();
  new IntersectionObserver(es => { running = es[0].isIntersecting; if (running) dirty = true; }).observe(stage);
  document.addEventListener("visibilitychange", () => { running = !document.hidden; lastT = performance.now(); });
  setupPointer(stage); setupKeys(stage);
  $("cardShelve").addEventListener("click", () => closeBook());
  $("cardPrev").addEventListener("click", () => stepBook(-1));
  $("cardNext").addEventListener("click", () => stepBook(1));
  $("cardShare").addEventListener("click", copyShare);

  T = performance.now(); await warmUp(); mark('warmUp', T); IR.marks.push(['loop start', Math.round(performance.now())]);
  requestAnimationFrame(frame);
}

/* ---------- build (or rebuild) the shelf from DATA ---------- */
let ringMesh, keyLight;
function placeLight() { keyLight.position.set(-1.1, 1.9, R + 1.1); keyLight.target.position.set(0, -0.1, R + 0.15); keyLight.target.updateMatrixWorld(); }
async function buildShelf() {
  // books: each book is a small transform chain (root > hover > tilt > proxy); all of them are drawn
  // together by one instanced mesh whose spines come from a single packed texture
  if (shelf) { // tear down the previous shelf
    for (const b of books) { if (b.root.parent) b.root.parent.remove(b.root); }
    shelf.remove(inst); inst.geometry.dispose(); inst.dispose(); atlas.texture.dispose();
    for (const m of prepared.values()) disposeReal(m); prepared.clear();
    world = null; ballistic.length = 0; staticShelfBodies = [];
  }
  books = []; hovered = null; keySel = null;
  atlas = await buildSpineAtlas(DATA);
  for (const e of DATA) {
    const shape = bookShape(e);
    const t = shape.thickness * S, h = shape.height * S, w = shape.width * S;
    const lean = THREE.MathUtils.degToRad(shape.lean);
    const over = Math.abs(Math.sin(lean)) * h;
    const root = new THREE.Group(), hover = new THREE.Group(), tilt = new THREE.Group(), proxy = new THREE.Object3D();
    tilt.add(proxy); hover.add(tilt); root.add(hover);
    const b = { id: e.id, i: books.length, essay: e, shape, root, hover, tilt, mesh: proxy, t, h, w, lean, over,
      ang: 0, mode: "shelf", hov: 0, body: null, visible: true, real: null };
    books.push(b);
  }
  inst = makeInstanced(atlas);
  let arc = 0; for (const b of books) arc += b.t + b.over + GAP;
  RS = arc / TAU; R = RS + DEPTH_IN;
  fullLayout().forEach((a, i) => { books[i].ang = a; });

  if (!shelf) { shelf = new THREE.Group(); scene.add(shelf); }
  shelf.add(inst);
  for (const b of books) { shelf.add(b.root); placeOnShelf(b); setLeanPivot(b, 1); }
  updateInstances();

  // shelf ring (a flat annulus with thickness): its size follows the number of books
  const ringShape = new THREE.Shape(); ringShape.absarc(0, 0, R + 0.1, 0, TAU, false);
  const hole = new THREE.Path(); hole.absarc(0, 0, R - 0.1, 0, TAU, true); ringShape.holes.push(hole);
  const ringGeo = new THREE.ExtrudeGeometry(ringShape, { depth: 0.03, bevelEnabled: false, curveSegments: 160 });
  ringGeo.rotateX(-Math.PI / 2); ringGeo.translate(0, -0.03, 0);
  if (!ringMesh) {
    const woodRing = woodTexture(); woodRing.repeat.set(1.4, 1.4); woodRing.needsUpdate = true;
    ringMesh = new THREE.Mesh(ringGeo, new THREE.MeshStandardMaterial({ map: woodRing, roughness: 0.72 }));
    ringMesh.receiveShadow = true; ringMesh.castShadow = true; scene.add(ringMesh);
  } else { ringMesh.geometry.dispose(); ringMesh.geometry = ringGeo; }

  // the reading table, which only appears while a book is open
  TABLE.z0 = R - 0.04; TABLE.z1 = R + 0.6;
  if (!tableMesh) {
    const tw = woodTexture(true); tw.repeat.set(1, 3);
    tableMesh = new THREE.Mesh(new THREE.BoxGeometry(TABLE.x * 2, 0.045, TABLE.z1 - TABLE.z0),
      new THREE.MeshStandardMaterial({ map: tw, roughness: 0.65 }));
    tableMesh.receiveShadow = true; tableMesh.material.transparent = true; tableMesh.material.opacity = 0; tableMesh.visible = false; // stays transparent: toggling it rebuilds the shader
    scene.add(tableMesh);
  }
  tableMesh.position.set(0, tableTop - 0.0225, (TABLE.z0 + TABLE.z1) / 2);
  if (keyLight) placeLight();
}

/* ---------- one draw call for the whole shelf ---------- */
let inst, atlas;
function makeInstanced(atlas) {
  const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
  const n = books.length;
  const cover = new Float32Array(n * 3), spine = new Float32Array(n * 4), col = new THREE.Color();
  books.forEach((b, i) => {
    col.set(b.shape.cover); cover.set([col.r, col.g, col.b], i * 3);
    spine.set(atlas.uv.get(b.id), i * 4);
  });
  geo.setAttribute("aCover", new THREE.InstancedBufferAttribute(cover, 3));
  geo.setAttribute("aSpine", new THREE.InstancedBufferAttribute(spine, 4));
  if (instMat) { instMat.map = atlas.texture; return finishInstanced(geo, instMat, n); }
  const mat = instMat = new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.5 });
  const pages = pagesMap();
  mat.onBeforeCompile = sh => {
    sh.uniforms.pagesMap = { value: pages };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 aCover; attribute vec4 aSpine; varying vec3 vCover; varying vec4 vSpine; varying vec3 vObjN; varying vec2 vBoxUv;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvCover = aCover; vSpine = aSpine; vObjN = normal; vBoxUv = uv;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D pagesMap; varying vec3 vCover; varying vec4 vSpine; varying vec3 vObjN; varying vec2 vBoxUv;")
      .replace("#include <map_fragment>", `
        vec4 texel;
        if (vObjN.z > 0.5) texel = texture2D(map, mix(vSpine.xy, vSpine.zw, vBoxUv));       // spine
        else if (abs(vObjN.x) > 0.5) texel = vec4(vCover, 1.0);                           // front and back boards
        else texel = texture2D(pagesMap, vBoxUv);                                        // cream page edges
        diffuseColor *= texel;`);
  };
  return finishInstanced(geo, mat, n);
}
let instMat = null;
function finishInstanced(geo, mat, n) {
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return m;
}
const _m = new THREE.Matrix4(), _s = new THREE.Matrix4(), _inv = new THREE.Matrix4(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
let instDirty = true;
function updateInstances() {
  shelf.updateWorldMatrix(true, false); _inv.copy(shelf.matrixWorld).invert();
  for (const b of books) {
    if (!b.root.visible || b.real) { inst.setMatrixAt(b.i, ZERO); continue; }
    b.root.updateMatrixWorld(true);
    _s.makeScale(b.t, b.h, b.w);
    if (b.root.parent === shelf) _m.copy(b.root.matrix).multiply(b.hover.matrix).multiply(b.tilt.matrix).multiply(b.mesh.matrix);
    else _m.multiplyMatrices(_inv, b.mesh.matrixWorld);
    inst.setMatrixAt(b.i, _m.multiply(_s));
  }
  inst.instanceMatrix.needsUpdate = true; instDirty = false;
}
// compile every shader and upload every texture before the first frame, one piece per task,
// so neither the first frame nor the first open has to do it all at once
async function warmUp() {
  const yieldTask = () => new Promise(r => setTimeout(r, 0));
  for (const t of [atlas.texture, pagesMap(), ...scene.children.filter(o => o.isMesh && o.material.map).map(o => o.material.map)]) { renderer.initTexture(t); await yieldTask(); }
  try { await renderer.compileAsync(scene, camera); } catch (_) { renderer.compile(scene, camera); }
  await yieldTask();
}
// After the shelf is on screen, and before it starts turning: give the table and a printed book their
// first draw, then draw the real frame in the same task so the warm-up frame is never shown.
let warmed = false;
async function warmExtras() {
  const T = performance.now();
  const temp = makeBook(DATA[0], { anisotropy: 4, atlas, scale: COVER_SCALE }); temp.position.set(0, tableTop, R + 0.3); scene.add(temp);
  tableMesh.visible = true;
  try { await renderer.compileAsync(scene, camera); } catch (_) { renderer.compile(scene, camera); }
  await new Promise(r => setTimeout(r, 0));
  renderer.render(scene, camera);
  tableMesh.visible = !!openB; scene.remove(temp);
  renderer.render(scene, camera);
  // keep its cover material alive: disposing it would delete the shader and rebuild it on the first open
  keepAlive.push(temp.userData.mesh.material[0]); temp.userData.mesh.material[0].map.dispose();
  warmed = true; dirty = true; mark('warmExtras', T);
}

/* ---------- prepare a printed book before it moves ---------- */
const COVER_SCALE = 0.75;
const keepAlive = [];
const prepared = new Map(); // id -> real mesh, at most three kept
function prepare(b) {
  if (b.real) return b.real;
  let m = prepared.get(b.id);
  if (!m) {
    const T = performance.now();
    m = makeBook(b.essay, { anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()), atlas, scale: COVER_SCALE, image: coverImages.get(b.id) || null }).userData.mesh;
    renderer.initTexture(m.material[0].map); // upload now, not in the middle of the slide
    prepared.set(b.id, m); mark('prepare', T);
    if (prepared.size > 3) { const [id, old] = prepared.entries().next().value; if (!books.find(x => x.id === id).real) disposeReal(old); prepared.delete(id); }
  } else { prepared.delete(b.id); prepared.set(b.id, m); }
  return m;
}
function disposeReal(m) { m.material[0].map && m.material[0].map.dispose(); m.material[0].dispose(); m.geometry.dispose(); }
let prepTimer = 0;
function prepareSoon(b) {
  clearTimeout(prepTimer);
  if (b) prepTimer = setTimeout(() => { if (!busy && !openB) (window.requestIdleCallback || setTimeout)(() => prepare(b)); }, 180);
}

/* ---------- layout ---------- */
function fullLayout() {
  const out = []; let s = 0;
  for (const b of books) {
    const left = b.lean < 0 ? b.over : 0, right = b.lean > 0 ? b.over : 0;
    s += left; out.push((s + b.t / 2) / RS); s += b.t + right + GAP;
  }
  return out;
}
function compactLayout(list, center) {
  let total = 0; for (const b of list) total += b.t + b.over + GAP;
  let s = -total / 2; const out = new Map();
  for (const b of list) {
    const left = b.lean < 0 ? b.over : 0, right = b.lean > 0 ? b.over : 0;
    s += left; out.set(b, center + (s + b.t / 2) / RS); s += b.t + right + GAP;
  }
  return { map: out, half: total / 2 / RS };
}
let blockHalf = 0, blockCenter = 0, swayOffset = 0;

function placeOnShelf(b) {
  b.root.position.set(R * Math.sin(b.ang), 0, R * Math.cos(b.ang));
  b.root.rotation.set(0, b.ang, 0);
}
function setLeanPivot(b, amount) {
  const side = b.lean > 0 ? 1 : -1;
  b.tilt.position.set(b.lean ? side * b.t / 2 : 0, 0, 0);
  b.mesh.position.set(b.lean ? -side * b.t / 2 : 0, 0, 0);
  b.tilt.rotation.set(0, 0, -b.lean * amount);
}
function slotWorld(b, ang = b.ang) {
  const p = new THREE.Vector3(R * Math.sin(ang), b.h / 2, R * Math.cos(ang)).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang + rot);
  return { p, q };
}
// take a book off the shelf group; root becomes the book's centre in world space
function detach(b) {
  b.mesh.updateWorldMatrix(true, false);
  const p = new THREE.Vector3(0, b.h / 2, 0).applyMatrix4(b.mesh.matrixWorld);
  const q = new THREE.Quaternion(); b.mesh.getWorldQuaternion(q);
  scene.add(b.root);
  b.hover.position.set(0, 0, 0); b.tilt.position.set(0, 0, 0); b.tilt.rotation.set(0, 0, 0);
  b.mesh.position.set(0, -b.h / 2, 0);
  b.root.position.copy(p); b.root.quaternion.copy(q); b.hov = 0;
}
function reattach(b) {
  if (b.real) { b.mesh.remove(b.real); prepared.set(b.id, b.real); b.real = null; if (prepared.size > 3) { const [id, old] = prepared.entries().next().value; disposeReal(old); prepared.delete(id); } }
  shelf.add(b.root); b.mesh.position.set(0, 0, 0); placeOnShelf(b); setLeanPivot(b, 0); b.mode = "shelf"; instDirty = true;
  if (b.lean) tween(REDUCED ? 0 : 0.3, k => { b.tilt.rotation.z = -b.lean * easeOut(k); instDirty = true; });
}

/* ---------- animation runner ---------- */
function tween(dur, fn, delay = 0) {
  return new Promise(res => {
    if (dur <= 0 && delay <= 0) { fn(1); dirty = true; instDirty = true; res(); return; }
    anims.push({ t: -delay, dur: Math.max(dur, 1e-4), fn, res });
  });
}

/* ---------- frame loop ---------- */
let lastT = performance.now(), clock = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const raw = (now - lastT) / 1000, dt = Math.min(0.07, raw); lastT = now;
  if (!running) return;
  clock += dt;
  update(dt);
  if (dirty) {
    adaptResolution(raw);
    const T = performance.now(); renderer.render(scene, camera); dirty = false;
    const d = performance.now() - T; if (d > 40) mark('render', T);
    if (!IR.firstFrame) { IR.firstFrame = performance.now(); IR.ready = true; document.body.dataset.ready = "1"; setTimeout(warmExtras, 30); }
  }
}

function update(dt) {
  // tweens
  if (anims.length) {
    dirty = true;
    for (let i = anims.length - 1; i >= 0; i--) {
      const a = anims[i]; a.t += dt; if (a.t < 0) continue;
      const k = Math.min(1, a.t / a.dur); a.fn(k); instDirty = true;
      if (k >= 1) { anims.splice(i, 1); a.res(); }
    }
  }
  // shelf rotation: slow spin, paused under the pointer, while a book is open, or during a change
  const paused = REDUCED || !warmed || pointerInside || dragging || openB || busy || performance.now() < touchHoldUntil;
  if (!dragging) {
    if (Math.abs(rotVel) > 1e-4) { rot += rotVel * dt; rotVel *= Math.pow(0.04, dt); dirty = true; }
    if (!paused) {
      if (topic) { // a small block of books sways gently instead of spinning away
        swayOffset += dt * 0.22;
        const target = -blockCenter + Math.sin(swayOffset) * Math.max(0, blockHalf - 0.12) * 0.8;
        rot += (target - rot) * Math.min(1, dt * 1.5);
      } else rot += autoSpeed * dt;
      dirty = true;
    }
  }
  if (shelf.rotation.y !== rot) { shelf.rotation.y = rot; dirty = true; }

  // hover / keyboard highlight: one book at a time
  if (pointerMoved && pointerOnCanvas && !dragging) { pointerMoved = false; pick(); }
  const want = keySel || hovered;
  for (const b of books) {
    if (b.mode !== "shelf") continue;
    let target = b === want ? 1 : 0;
    if (target === 1 && books.some(o => o !== b && o.hov > 0.12 && o.mode === "shelf")) target = 0; // wait for the last one to go back
    if (b.hov !== target) {
      const step = dt / (REDUCED ? 0.001 : 0.22);
      b.hov = target > b.hov ? Math.min(1, b.hov + step) : Math.max(0, b.hov - step);
      const k = easeInOut(b.hov);
      b.hover.position.set(0, 0.018 * k, 0.05 * k);
      dirty = true; instDirty = true;
    }
  }
  // physics while books are falling
  if (world && world.hasActive) { stepPhysics(dt); instDirty = true; }
  if (ballistic.length) { stepBallistic(dt); instDirty = true; }
  if (instDirty) updateInstances();
  // camera offset when a book is open
  if (viewOff.x !== viewOffTarget.x || viewOff.y !== viewOffTarget.y) {
    const k = REDUCED ? 1 : Math.min(1, dt * 6);
    viewOff.x += (viewOffTarget.x - viewOff.x) * k; viewOff.y += (viewOffTarget.y - viewOff.y) * k;
    if (Math.abs(viewOff.x - viewOffTarget.x) < 0.5 && Math.abs(viewOff.y - viewOffTarget.y) < 0.5) { viewOff.x = viewOffTarget.x; viewOff.y = viewOffTarget.y; }
    applyView(); dirty = true;
  }
}

// keep frames coming: lower the render resolution when frames are slow, raise it again when there is room
let prMax = Math.min(window.devicePixelRatio || 1, 1.75), pr = prMax, prMin = 0.6, emaFrame = 16, prCooldown = 3, prSteps = 0;
function adaptResolution(raw) {
  if (raw > 0.5) return; // tab switch or first frame
  emaFrame = emaFrame * 0.9 + raw * 1000 * 0.1;
  if ((prCooldown -= raw) > 0) return;
  // resizing the drawing buffer is itself a hitch, so change rarely and in one bigger step
  let next = pr;
  if (emaFrame > 40 && pr > prMin && prSteps < 2) next = Math.max(prMin, pr * 0.7);
  if (next !== pr) { const T = performance.now(); pr = next; prSteps++; renderer.setPixelRatio(pr); renderer.setSize(W, H, false); prCooldown = 4; emaFrame = 24; mark('resize ' + pr.toFixed(2), T); }
}
function resize() {
  const st = $("stage"); W = st.clientWidth; H = st.clientHeight;
  narrow = W / H < 0.9;
  renderer.setPixelRatio(pr); renderer.setSize(W, H, false);
  camera.aspect = W / H;
  camera.fov = narrow ? 44 : 34;
  const dist = narrow ? 1.5 : 1.18;
  camera.position.set(0, narrow ? 0.12 : 0.17, R + dist);
  camera.lookAt(0, narrow ? -0.1 : -0.075, R + 0.12);
  scene.fog.near = dist + 0.15; scene.fog.far = dist + 1.9;
  setViewTargets(); viewOff.x = viewOffTarget.x; viewOff.y = viewOffTarget.y;
  applyView(); dirty = true;
}
function setViewTargets() {
  if (!openB) { viewOffTarget.x = 0; viewOffTarget.y = Math.round(H * (narrow ? 0.14 : -0.08)); return; } // centre the shelf while the table is hidden
  if (narrow) { viewOffTarget.x = 0; viewOffTarget.y = Math.round(H * 0.2); }
  else { viewOffTarget.x = Math.round(W * 0.17); viewOffTarget.y = 0; }
}
function applyView() {
  if (viewOff.x || viewOff.y) camera.setViewOffset(W, H, viewOff.x, viewOff.y, W, H); else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}

/* ---------- pointer: hover, click, drag to turn (vertical swipes scroll the page) ---------- */
function setupPointer(stage) {
  let downX = 0, downY = 0, lastX = 0, lastMoveT = 0, rot0 = 0, down = false, moved = false, pid = null;
  stage.addEventListener("pointerenter", e => { if (e.pointerType === "mouse") pointerInside = true; });
  stage.addEventListener("pointerleave", e => { pointerInside = false; pointerOnCanvas = false; if (hovered) { hovered = null; stage.classList.remove("pointing"); } });
  stage.addEventListener("pointermove", e => {
    const r = stage.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    pointerMoved = true; pointerOnCanvas = !e.target.closest(".card");
    if (!down) return;
    const dx = e.clientX - downX, dy = e.clientY - downY;
    if (!dragging && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
      dragging = true; stage.classList.add("grabbing"); hovered = null;
      try { stage.setPointerCapture(pid); } catch (_) {}
    }
    if (dragging) {
      const k = 2.2 / Math.max(W, 1);
      const now = performance.now(); const v = (e.clientX - lastX) * k / Math.max(0.008, (now - lastMoveT) / 1000);
      rotVel = lerp(rotVel, v, 0.5); lastX = e.clientX; lastMoveT = now;
      rot = rot0 + dx * k; if (topic) rot = clamp(rot, -blockCenter - blockHalf, -blockCenter + blockHalf);
      dirty = true; moved = true;
    }
  });
  stage.addEventListener("pointerdown", e => {
    if (e.target.closest(".card")) return;
    down = true; moved = false; downX = lastX = e.clientX; downY = e.clientY; lastMoveT = performance.now(); rot0 = rot; rotVel = 0; pid = e.pointerId;
    if (e.pointerType !== "mouse") touchHoldUntil = performance.now() + 2500;
  });
  const up = e => {
    if (!down) return; down = false;
    if (dragging) { dragging = false; stage.classList.remove("grabbing"); if (topic) rotVel = 0; touchHoldUntil = performance.now() + (e.pointerType === "mouse" ? 0 : 2500); return; }
    rotVel = 0;
    if (!moved && e.type === "pointerup" && !e.target.closest(".card")) {
      const r = stage.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      const b = rayBook();
      if (b) openBook(b); else if (openB) closeBook();
    }
  };
  stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", e => { down = false; dragging = false; stage.classList.remove("grabbing"); });
}
function rayBook() {
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(inst, false)[0];
  const b = hit && books[hit.instanceId];
  return b && b.mode === "shelf" && b.visible ? b : null;
}
function pick() {
  const b = busy ? null : rayBook();
  if (b !== hovered) { hovered = b; keySel = null; $("stage").classList.toggle("pointing", !!b); dirty = true; prepareSoon(b); }
}

/* ---------- keyboard ---------- */
function visibleList() { return books.filter(b => b.visible).sort((a, c) => a.ang - c.ang); }
function frontBook() {
  let best = null, bd = 9;
  for (const b of books) if (b.visible && b.mode === "shelf") { const d = Math.abs(wrapPi(b.ang + rot)); if (d < bd) { bd = d; best = b; } }
  return best;
}
function setupKeys(stage) {
  stage.addEventListener("keydown", e => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const list = visibleList(); if (!list.length) return;
      const cur = keySel || frontBook();
      let i = list.indexOf(cur); i = (i + (e.key === "ArrowRight" ? 1 : -1) + list.length) % list.length;
      keySel = list[i]; hovered = null; bringToFront(keySel, 0.35); prepareSoon(keySel);
      $("focusCaption").textContent = `No. ${issue(keySel.id)} · ${keySel.essay.title}`;
      announce(`${keySel.essay.title}${keySel.essay.author ? ", " + keySel.essay.author : ""}. Press Enter to open.`);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault(); const b = keySel || frontBook(); if (b) openBook(b);
    }
  });
  stage.addEventListener("blur", () => { keySel = null; $("focusCaption").textContent = ""; });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!$("ownerSheet").hidden) { $("ownerSheet").hidden = true; return; }
    if (aiOpen()) { closeAI(); return; }
    if (addOpen()) { closeAdd(); return; }
    if (openB) { closeBook(); $("stage").focus({ preventScroll: true }); }
  });
}
function bringToFront(b, maxDur = 0.8) {
  const target = rot + wrapPi(-(b.ang + rot));
  const d = Math.abs(target - rot); if (d < 1e-4) return Promise.resolve();
  const from = rot, dur = REDUCED ? 0 : Math.min(maxDur, 0.25 + d * 0.5);
  if (topic) blockCenter = clamp(-target, blockCenter - blockHalf, blockCenter + blockHalf), swayOffset = 0;
  return tween(dur, k => { rot = lerp(from, target, easeInOut(k)); });
}

/* ---------- open / shelve ---------- */
let openToken = 0;
function tablePose(b) {
  const z = narrow ? R + 0.42 : R + 0.3;
  return { p: new THREE.Vector3(0, tableTop + b.h / 2, z), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.06, -Math.PI / 2 + 0.18, 0, "YXZ")) };
}
async function openBook(b) {
  if (!has3D || !b) return;
  const token = ++openToken;
  while (busy) { await sleep(60); if (token !== openToken) return; }
  if (!b.visible || openB === b) return;
  if (openB) closeBook({ fast: true, keepView: true });
  hovered = null; keySel = null;
  const real = prepare(b);              // cover painted and uploaded before anything moves
  await new Promise(r => requestAnimationFrame(r));
  await bringToFront(b);
  if (token !== openToken || b.mode !== "shelf") return;
  detach(b); b.mode = "open"; openB = b;
  b.mesh.add(real); b.real = real; prepared.delete(b.id); instDirty = true;
  const p0 = b.root.position.clone(), q0 = b.root.quaternion.clone();
  const out = new THREE.Vector3(p0.x, 0, p0.z).normalize();
  const p1 = p0.clone().addScaledVector(out, 0.2).add(new THREE.Vector3(0, 0.02, 0));
  const { p: p3, q: q3 } = tablePose(b);
  const p2 = p3.clone().add(new THREE.Vector3(0, 0.1, 0));
  setViewTargets(); showCard(b); showTable(true);
  history.replaceState(null, "", "#book-" + issue(b.id));
  await tween(REDUCED ? 0 : 1.15, k => {
    if (openB !== b) return;
    const a = easeOut(seg(k, 0, 0.28)), c = easeInOut(seg(k, 0.28, 0.82)), d = easeIn(seg(k, 0.82, 1));
    const p = a < 1 ? p0.clone().lerp(p1, a) : c < 1 ? p1.clone().lerp(p2, c).add(new THREE.Vector3(0, Math.sin(c * Math.PI) * 0.06, 0)) : p2.clone().lerp(p3, d);
    b.root.position.copy(p);
    b.root.quaternion.copy(q0).slerp(q3, easeInOut(seg(k, 0.2, 0.86)));
  });
  if (openB === b && !REDUCED) { // small settle on landing
    await tween(0.18, k => { if (openB === b) b.root.position.y = p3.y + Math.sin(k * Math.PI) * 0.004; });
  }
}
async function closeBook({ fast = false, keepView = false } = {}) {
  const b = openB; if (!b) return;
  openB = null; openToken++;
  if (!keepView) { setViewTargets(); hideCard(); showTable(false); history.replaceState(null, "", location.pathname + location.search); }
  b.mode = "closing";
  const p0 = b.root.position.clone(), q0 = b.root.quaternion.clone();
  await tween(REDUCED ? 0 : (fast ? 0.6 : 0.95), k => {
    const { p: ps, q: qs2 } = slotWorld(b); // the slot can move while we fly back
    const out = new THREE.Vector3(ps.x, 0, ps.z).normalize();
    const p1 = ps.clone().addScaledVector(out, 0.22).add(new THREE.Vector3(0, 0.03, 0));
    const a = easeInOut(seg(k, 0, 0.72)), c = easeOut(seg(k, 0.72, 1));
    const p = a < 1 ? p0.clone().lerp(p1, a).add(new THREE.Vector3(0, Math.sin(a * Math.PI) * 0.05, 0)) : p1.clone().lerp(ps, c);
    b.root.position.copy(p); b.root.quaternion.copy(q0).slerp(qs2, easeInOut(seg(k, 0, 0.7)));
  });
  reattach(b);
}
function stepBook(dir) {
  if (!openB) return;
  const list = visibleList(); const i = list.indexOf(openB);
  const next = list[(i + dir + list.length) % list.length];
  if (next && next !== openB) openBook(next);
}

function showTable(on) {
  const m = tableMesh.material, from = m.opacity, to = on ? 1 : 0;
  if (on) tableMesh.visible = true;
  tween(REDUCED ? 0 : 0.35, k => { m.opacity = lerp(from, to, k); m.transparent = m.opacity < 1; m.depthWrite = m.opacity > 0.5; })
    .then(() => { if (!on && !openB) tableMesh.visible = false; });
}

/* ---------- card ---------- */
function showCard(b) {
  const e = b.essay, list = visibleList();
  $("cardEyebrow").textContent = `Interesting Reads · No. ${issue(e.id)}`;
  $("cardTitle").textContent = e.title;
  $("cardMeta").textContent = [e.author, e.publication, e.year].filter(Boolean).join(" · ");
  $("cardDesc").textContent = e.description;
  $("cardTopic").textContent = "Topic: " + e.topic;
  $("cardRead").href = e.link;
  $("cardRead").setAttribute("aria-label", `Read ${e.title} (opens in a new tab)`);
  $("cardPos").textContent = `${list.indexOf(b) + 1} / ${list.length}`;
  $("shareNote").textContent = "";
  $("cardRead").hidden = !e.link;
  const owner = store.mode === "cloud" && store.canAdd;
  $("cardFile").hidden = !(e.hasFile && owner);
  $("cardFile").textContent = /pdf/.test(e.fileType || "") ? "Open PDF" : "Open file";
  $("cardDownload").hidden = !(e.hasFile && owner);
  $("cardAttach").hidden = !(e._extra && owner && !e.hasFile);
  $("cardFileNote").hidden = !(e.hasFile && !owner);
  $("cardAsk").hidden = !(store.mode === "cloud" && store.ai);
  $("cardRemove").hidden = !(e._extra && store.canAdd); $("removeAsk").hidden = true;
  const card = $("card"); card.hidden = false;
  $("hint").style.opacity = 0;
  $("cardTitle").focus({ preventScroll: true });
  announce(`Opened ${e.title}.`);
}
function hideCard() { $("card").hidden = true; $("hint").style.opacity = 1; }
async function copyShare() {
  if (!openB) return;
  const url = shareUrl(openB.id), note = $("shareNote");
  try { await navigator.clipboard.writeText(url); note.textContent = "Link copied."; }
  catch (_) { note.textContent = url; const r = document.createRange(); r.selectNodeContents(note); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
}

/* ---------- surprise + go to ---------- */
async function surprise() {
  if (!has3D) {
    const pool = DATA.filter(e => !topic || e.topic === topic), e = pool[Math.floor(Math.random() * pool.length)];
    document.querySelectorAll(".plain li.hit").forEach(li => li.classList.remove("hit"));
    const li = $("p-" + e.id); li.classList.add("hit"); li.scrollIntoView({ block: "center", behavior: REDUCED ? "auto" : "smooth" }); li.focus({ preventScroll: true });
    return;
  }
  const pool = books.filter(b => b.visible && b !== openB);
  const b = pool[Math.floor(Math.random() * pool.length)];
  if (b) openBook(b);
}
async function goToBook(id, { fromHash = false } = {}) {
  if (!has3D) {
    const li = $("p-" + id); if (!li) return;
    if (topic && byId.get(id).topic !== topic) { topic = null; syncChips(); filterPlain(); }
    li.scrollIntoView({ block: "center" }); li.classList.add("hit"); li.focus({ preventScroll: true }); return;
  }
  const b = books.find(x => x.id === id); if (!b) return;
  if (openB === b) return;
  if (!b.visible) await setTopic(null);
  while (busy) await sleep(60);
  if (fromHash) $("stage").scrollIntoView({ block: "nearest" });
  openBook(b);
}

/* ---------- topics: unrelated books tumble off, the rest close up ---------- */
async function setTopic(t) {
  if (t === topic && !busy) return;
  if (busy) { queuedTopic = t; topic = t; syncChips(); return; }
  topic = t; syncChips();
  if (!has3D) { filterPlain(); return; }
  busy = true; hovered = null; keySel = null; dirty = true;
  if (openB) await closeBook({ fast: true });
  const match = b => !t || b.essay.topic === t;
  const leavers = books.filter(b => b.mode === "shelf" && !match(b));
  const risers = books.filter(b => (b.mode === "fallen" || b.mode === "falling") && match(b));
  const stayers = books.filter(b => b.mode === "shelf" && match(b));
  for (const b of books) b.visible = match(b);
  const n = books.filter(b => b.visible).length;
  announce(t ? `Showing ${n} books in ${t}.` : `Showing all ${n} books.`);

  // targets for books that will sit on the shelf
  const keep = [...stayers, ...risers].sort((a, c) => a.id - c.id);
  let targets = new Map();
  const front = -rot;
  if (t) {
    let center = front;
    if (stayers.length) { const mean = stayers.reduce((s, b) => s + b.ang, 0) / stayers.length; center = mean + wrapPi(front - mean); }
    const lay = compactLayout(keep, center); targets = lay.map; blockHalf = lay.half; blockCenter = center; swayOffset = 0;
  } else {
    const full = fullLayout();
    let base = 0;
    if (stayers.length) { const i0 = books.indexOf(stayers[0]); base = stayers[0].ang - full[i0]; }
    else { const fi = books.indexOf(keep[0]); base = front - full[fi]; }
    books.forEach((b, i) => targets.set(b, full[i] + base));
    blockHalf = Math.PI; blockCenter = front;
  }
  // leavers fall
  const delay = leavers.length && !REDUCED ? 0.45 : 0;
  if (leavers.length) startFall(leavers, stayers);
  // stayers slide together
  const moves = stayers.map(b => {
    const from = b.ang; const to = from + wrapPi(targets.get(b) - from); // shortest way round
    return tween(REDUCED ? 0 : 0.9, k => { b.ang = lerp(from, to, easeInOut(k)); placeOnShelf(b); }, delay)
      .then(() => { b.ang = to; placeOnShelf(b); });
  });
  if (stayers.length && !REDUCED) setTimeout(() => removeStayerBodies(), delay * 1000);
  // risers come back up from where they fell
  const rises = risers.map((b, i) => riseTo(b, targets.get(b), delay, i));
  await Promise.all([...moves, ...rises]);
  if (!t) books.forEach(b => { b.ang = ((b.ang % TAU) + TAU) % TAU; if (b.mode === "shelf") placeOnShelf(b); });
  busy = false; dirty = true;
  if (queuedTopic !== undefined) { const q = queuedTopic; queuedTopic = undefined; topic = undefined; await setTopic(q); }
}

/* ---------- physics ---------- */
function ensureWorld() {
  if (world) return;
  world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  world.defaultContactMaterial.friction = 0.45; world.defaultContactMaterial.restitution = 0.12;
  const N = 72, len = TAU * (R + 0.1) / N * 1.04;
  for (let i = 0; i < N; i++) {
    const a = i / N * TAU;
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(len / 2, 0.015, 0.1)) });
    body.position.set(R * Math.sin(a), -0.015, R * Math.cos(a));
    body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), a);
    world.addBody(body);
  }
  floorBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
  floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0); floorBody.position.set(0, -1.1, 0); world.addBody(floorBody);
  world.hasActive = false;
}
function bodyFor(b, mass) {
  const body = new CANNON.Body({ mass, shape: new CANNON.Box(new CANNON.Vec3(b.t / 2, b.h / 2, b.w / 2)), linearDamping: 0.05, angularDamping: 0.08, sleepSpeedLimit: 0.08, sleepTimeLimit: 0.6 });
  body.position.set(b.root.position.x, b.root.position.y, b.root.position.z);
  body.quaternion.set(b.root.quaternion.x, b.root.quaternion.y, b.root.quaternion.z, b.root.quaternion.w);
  return body;
}
function startFall(leavers, stayers) {
  if (REDUCED) { for (const b of leavers) { detach(b); b.mode = "fallen"; b.root.visible = false; } dirty = true; instDirty = true; return; }
  ensureWorld();
  // stayers are solid while the others tip forward past them
  for (const b of stayers) {
    const { p, q } = slotWorld(b);
    if (Math.abs(Math.atan2(p.x, p.z)) > 1.3) continue; const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(b.t / 2, b.h / 2, b.w / 2)) });
    body.position.set(p.x, p.y, p.z); body.quaternion.set(q.x, q.y, q.z, q.w); world.addBody(body); staticShelfBodies.push(body);
  }
  const up = new THREE.Vector3(0, 1, 0);
  for (const b of leavers) {
    detach(b); b.mode = "falling"; b.fallT = 0;
    const az = Math.abs(Math.atan2(b.root.position.x, b.root.position.z));
    if (az > 1.2) { // behind the fog: a simple drop, no collisions needed
      const n = new THREE.Vector3(b.root.position.x, 0, b.root.position.z).normalize();
      ballistic.push({ b, v: n.multiplyScalar(0.6).setY(0.15), w: new THREE.Vector3().crossVectors(up, n).normalize(), spin: 6 });
      continue;
    }
    const body = bodyFor(b, 0.3); b.body = body; world.addBody(body);
    const n = new THREE.Vector3(b.root.position.x, 0, b.root.position.z).normalize();
    // a firm push near the top, like a finger tipping the book off the front edge
    const w = new THREE.Vector3().crossVectors(up, n).multiplyScalar(7 + Math.random() * 2.5);
    const kick = 0.55 + Math.random() * 0.2;
    body.velocity.set(n.x * kick, 0.12 + Math.random() * 0.12, n.z * kick);
    body.angularVelocity.set(w.x, w.y + (Math.random() - 0.5) * 2.5, w.z);
  }
  world.hasActive = true;
}
const ballistic = [];
const _q = new THREE.Quaternion();
function stepBallistic(dt) {
  for (let i = ballistic.length - 1; i >= 0; i--) {
    const f = ballistic[i], b = f.b;
    if (b.mode !== "falling") { ballistic.splice(i, 1); continue; }
    f.v.y -= 9.82 * dt; b.root.position.addScaledVector(f.v, dt);
    b.root.quaternion.premultiply(_q.setFromAxisAngle(f.w, f.spin * dt));
    b.fallT += dt;
    if (b.root.position.y < -1.1 || b.fallT > 2) { b.mode = "fallen"; b.root.visible = false; ballistic.splice(i, 1); }
  }
  dirty = true;
}
function removeStayerBodies() { for (const body of staticShelfBodies) world && world.removeBody(body); staticShelfBodies = []; }
function stepPhysics(dt) {
  world.step(1 / 60, dt, 4);
  let active = false;
  for (const b of books) {
    if (b.mode !== "falling" || !b.body) continue;
    b.fallT += dt;
    b.root.position.set(b.body.position.x, b.body.position.y, b.body.position.z);
    b.root.quaternion.set(b.body.quaternion.x, b.body.quaternion.y, b.body.quaternion.z, b.body.quaternion.w);
    if (b.body.sleepState === CANNON.Body.SLEEPING || b.fallT > 4) { b.mode = "fallen"; b.body.type = CANNON.Body.STATIC; b.body.mass = 0; b.body.updateMassProperties(); }
    else active = true;
  }
  world.hasActive = active; dirty = true;
}
async function riseTo(b, ang, delay, i) {
  if (b.body) { world.removeBody(b.body); b.body = null; }
  b.mode = "rising"; b.root.visible = true;
  b.ang = ang;
  if (REDUCED) { reattach(b); return; }
  const c0 = b.root.position.clone(), q0 = b.root.quaternion.clone();
  const r0 = Math.hypot(c0.x, c0.z), f0 = Math.atan2(c0.x, c0.z);
  const rOut = R + 0.36;
  const start = Math.max(0, delay + 0.9 - 1.5 * 0.8) + i * 0.012;
  await tween(1.5, k => {
    const { p: ps, q: qs2 } = slotWorld(b);
    const f1 = Math.atan2(ps.x, ps.z);
    const A = easeInOut(seg(k, 0, 0.28)), B = easeInOut(seg(k, 0.28, 0.8)), C = easeOut(seg(k, 0.8, 1));
    let r = lerp(r0, Math.max(r0, rOut), A), f = f0, y = c0.y + 0.03 * A;
    if (B > 0) { r = Math.max(r0, rOut); f = f0 + wrapPi(f1 - f0) * B; y = lerp(c0.y + 0.03, ps.y + 0.03, B); }
    if (C > 0) { r = lerp(Math.max(r0, rOut), R, C); f = f1; y = lerp(ps.y + 0.03, ps.y, C); }
    b.root.position.set(r * Math.sin(f), y, r * Math.cos(f));
    b.root.quaternion.copy(q0).slerp(qs2, easeInOut(seg(k, 0, 0.8)));
  }, start);
  reattach(b);
}

/* =====================================================================
   Adding new reads later: a link, pasted text, or a PDF / Word file.
   On the published page entries are kept in the page's own store (only the owner
   or an editor can add); on a copy hosted elsewhere they are kept in that browser,
   with a button to download the updated essays.json.
   ===================================================================== */
let BASE = null, extras = [], pendingArrival = null;
const store = { mode: "none", db: null, assets: null, sample: null, canAdd: false, ai: false, ownerKey: "" };
const OWNER_KEY_STORE = "interesting-reads-owner";
const LOCAL_KEY = "interesting-reads-added-v1";
const safeLink = u => (typeof u === "string" && (/^https?:\/\//i.test(u) || /^\/_blob\/[A-Za-z0-9]{8,64}$/.test(u))) ? u : "";
const safeCover = u => (typeof u === "string" && (/^\/_blob\/[A-Za-z0-9]{8,64}$/.test(u) || /^\/api\/cover\/\d+(\?v=[a-z0-9]+)?$/.test(u) || /^data:image\/(jpeg|png|webp);base64,/.test(u))) ? u : null;

function cleanEntry(x) {
  const s = v => (typeof v === "string" ? v : v == null ? "" : String(v)).slice(0, 400);
  const id = Number(x.id);
  if (!Number.isInteger(id) || id < 1) return null;
  return {
    id, title: s(x.title) || "Untitled", author: s(x.author) || null, publication: s(x.publication) || null,
    year: s(x.year) || null, description: s(x.description), link: safeLink(x.link),
    topic: TOPICS.includes(x.topic) ? x.topic : TOPICS[0], status: s(x.status) || "unchecked",
    archive_link: null, note: s(x.note) || null, cover: safeCover(x.cover),
    added: s(x.added) || null, source: s(x.source) || null,
    fileAsset: typeof x.fileAsset === "string" ? x.fileAsset : null, coverAsset: typeof x.coverAsset === "string" ? x.coverAsset : null,
    hasFile: !!x.hasFile, fileType: s(x.fileType) || "", hasText: !!x.hasText,
    _doc: x._doc || null, _extra: true,
  };
}
function nextId() { return Math.max(0, ...DATA.map(e => e.id)) + 1; }

async function initStore() {
  BASE = DATA.slice();
  if (!window.claude || !window.claude.use) {
    if (await initCloud()) return;
    // a copy hosted elsewhere without the Cloudflare functions: keep additions in this browser
    store.mode = "local"; store.canAdd = true;
    try { extras = (JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]") || []).map(cleanEntry).filter(Boolean); } catch (_) { extras = []; }
    showAddButton(); if (extras.length) await applyExtras(); return;
  }
  const use = n => window.claude.use(n).catch(() => null);
  const [db, user, assets, sample] = await Promise.all([use("db"), use("user"), use("assets"), use("sample")]);
  store.db = db; store.assets = assets; store.sample = sample;
  if (!db) return;
  store.mode = "db";
  const canEdit = user ? await user.canEdit().catch(() => false) : false;
  store.canAdd = !!(assets && canEdit);
  showAddButton();
  db.collection("reads").onSnapshot(snap => {
    const rows = snap.docs.map(d => cleanEntry({ ...d.data(), _doc: d.id })).filter(Boolean).sort((a, b) => a.id - b.id);
    const sig = r => r.map(e => [e.id, e.title, e.author, e.topic, e.cover, e.link, e.description, e.year, e.publication].join("|")).join("\n");
    if (sig(rows) === sig(extras)) return;
    extras = rows; applyExtras();
  }, err => console.warn("reads store", err && err.code));
}
function showAddButton() { $("addBtn").hidden = !store.canAdd; }

let applying = Promise.resolve();
function applyExtras() {
  applying = applying.then(async () => {
    DATA = BASE.concat(extras.filter(e => !BASE.some(b => b.id === e.id)));
    byId = new Map(DATA.map(e => [e.id, e]));
    for (const e of extras) if (e.cover && !coverImages.has(e.id)) { const img = new Image(); img.onload = () => coverImages.set(e.id, img); img.src = e.cover; }
    renderExtraLists();
    if (has3D) await rebuildShelf();
    if (pendingArrival && byId.has(pendingArrival)) { const id = pendingArrival; pendingArrival = null; if (has3D) arrive(id); else goToBook(id); }
  });
  return applying;
}
function renderExtraLists() {
  document.querySelectorAll("[data-extra]").forEach(n => n.remove());
  for (const e of extras) {
    const li = document.createElement("li"); li.dataset.extra = "1";
    li.innerHTML = `<button type="button" tabindex="-1" data-id="${e.id}">Open ${esc(e.title)}${e.author ? ", by " + esc(e.author) : ""}</button>`;
    $("srList").appendChild(li);
    const sec = $("plainBody").querySelector(`section[data-topic="${CSS.escape(e.topic)}"] ol`);
    if (sec) {
      const p = document.createElement("li"); p.dataset.extra = "1"; p.id = "p-" + e.id; p.tabIndex = -1;
      p.innerHTML = (e.link ? `<a href="${esc(e.link)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title)) +
        ` <span class="m">${esc([e.author, e.publication, e.year].filter(Boolean).join(" · "))}</span><br>${esc(e.description)}`;
      sec.appendChild(p);
    }
  }
  $("eyebrowCount").textContent = DATA.length + " essays";
}

async function rebuildShelf() {
  if (openB) await closeBook({ fast: true });
  while (busy) await sleep(80);
  busy = true;
  topic = null; syncChips();
  await buildShelf();
  rot = 0; rotVel = 0; shelf.rotation.y = 0;
  resize(); applyView();
  busy = false; dirty = true; instDirty = true;
}
// a new book drops in from below the front of the shelf, then opens on the table
async function arrive(id) {
  const b = books.find(x => x.id === id); if (!b) return;
  rot = -b.ang; shelf.rotation.y = rot; updateInstances();
  if (REDUCED) { openBook(b); return; }
  busy = true;
  detach(b); b.mode = "fallen";
  b.root.position.set(0.05, tableTop - 0.25, R + 0.55);
  b.root.quaternion.setFromEuler(new THREE.Euler(0.6, -0.9, 0.4));
  instDirty = true;
  await riseTo(b, b.ang, 0, 0);
  busy = false;
  announce(`${b.essay.title} is on the shelf.`);
  openBook(b);
}

/* ---------- the Add panel ---------- */
let addSrc = "link", lastRead = null, aCtl = null;
function setupAdd() {
  const sheet = $("addSheet");
  $("addBtn").addEventListener("click", () => openAdd());
  $("addClose").addEventListener("click", closeAdd);
  sheet.addEventListener("pointerdown", e => { if (e.target === sheet) closeAdd(); });
  for (const t of sheet.querySelectorAll("[data-src]")) t.addEventListener("click", () => setSrc(t.dataset.src));
  $("aRead").addEventListener("click", readIt);
  $("aBack").addEventListener("click", () => { $("addStep2").hidden = true; $("addStep1").hidden = false; });
  $("aSave").addEventListener("click", saveIt);
  for (const id of ["fTitle", "fAuthor", "fTopic", "fUsePic"]) $(id).addEventListener("input", drawPreview);
  $("aFile").addEventListener("change", () => { const f = $("aFile").files[0]; $("aFileName").textContent = f ? f.name : "No file chosen"; });
  $("aExport").addEventListener("click", exportJson);
  $("cardRemove").addEventListener("click", () => { $("removeAsk").hidden = false; $("cardRemove").hidden = true; });
  $("removeNo").addEventListener("click", () => { $("removeAsk").hidden = true; $("cardRemove").hidden = false; });
  $("removeYes").addEventListener("click", removeOpen);
  $("cardFile").addEventListener("click", () => openFile(false));
  $("cardDownload").addEventListener("click", () => openFile(true));
  $("cardAttach").addEventListener("click", attachFile);
  $("attachInput").addEventListener("change", attachChosen);
  $("fTopic").innerHTML = `<option value="">Choose a topic</option>` + TOPICS.map(t => `<option>${esc(t)}</option>`).join("");
}
function setSrc(src) {
  addSrc = src;
  for (const t of $("addSheet").querySelectorAll("[data-src]")) t.setAttribute("aria-selected", String(t.dataset.src === src));
  for (const p of $("addSheet").querySelectorAll("[data-pane]")) p.hidden = p.dataset.pane !== src;
  $("aStatus").textContent = "";
}
function openAdd() {
  $("addSheet").hidden = false; $("addStep1").hidden = false; $("addStep2").hidden = true;
  $("aExport").hidden = store.mode !== "local";
  $("aStatus").textContent = ""; setSrc(addSrc);
  setTimeout(() => ($("addSheet").querySelector(`[data-pane="${addSrc}"] input, [data-pane="${addSrc}"] textarea`) || $("aRead")).focus(), 30);
}
function closeAdd() { if (aCtl) aCtl.abort(); $("addSheet").hidden = true; $("addBtn").focus({ preventScroll: true }); }
const addOpen = () => !$("addSheet").hidden;

async function readIt() {
  const status = $("aStatus"), btn = $("aRead");
  let url = "", text = "", file = null, info = { kind: addSrc === "link" ? "link" : "text", text: "", picture: null };
  if (addSrc === "link") { url = $("aUrl").value.trim(); text = $("aUrlText").value.trim(); if (!/^https?:\/\//i.test(url)) { status.textContent = "Paste a full link that starts with http:// or https://."; return; } }
  if (addSrc === "text") { text = $("aText").value.trim(); url = $("aTextUrl").value.trim(); if (text.length < 20) { status.textContent = "Paste the text of the essay or article first."; return; } }
  if (addSrc === "file") { file = $("aFile").files[0]; url = $("aFileUrl").value.trim(); if (!file) { status.textContent = "Choose a PDF, Word (.docx) or text file first."; return; } }
  if (url && !/^https?:\/\//i.test(url)) { status.textContent = "The link should start with http:// or https://."; return; }
  btn.disabled = true;
  try {
    if (file) { status.textContent = "Reading the file…"; info = await readFile(file); text = info.text; }
    else if (addSrc === "link" && !text && store.mode === "cloud" && store.canAdd) {
      status.textContent = "Opening the link…";
      try { const r = await api("fetch-text", { method: "POST", json: { url } }); text = [r.title && "Page title: " + r.title, r.meta, r.text].filter(Boolean).join("\n"); } catch (_) {}
    }
    info.kind = info.kind || addSrc; info.text = text;
    let d = plainDetails({ text, url, fileName: file && file.name, pdfTitle: info.pdfTitle, pdfAuthor: info.pdfAuthor });
    if (store.sample && (text || url)) {
      status.textContent = "Claude is reading it for the title, author and topic…";
      aCtl = new AbortController();
      try {
        const s = await suggestDetails(store.sample, { text, url, fileName: file && file.name, topics: TOPICS, signal: aCtl.signal });
        d = { ...d, ...Object.fromEntries(Object.entries(s).filter(([, v]) => v)) };
      } catch (e) {
        if (e && e.code === "cancelled") return;
        status.textContent = "Claude couldn't fill in the details this time, so fill them in below.";
      }
    }
    lastRead = { info, file, url, text };
    $("fTitle").value = d.title || ""; $("fAuthor").value = d.author || ""; $("fPub").value = d.publication || "";
    $("fYear").value = d.year || ""; $("fDesc").value = d.description || ""; $("fTopic").value = d.topic || topic || "";
    $("fLink").value = url;
    $("fUsePic").checked = !!info.picture; $("fUsePicRow").hidden = !info.picture;
    $("aNote").textContent = noteFor(info, url);
    $("addStep1").hidden = true; $("addStep2").hidden = false; status.textContent = "";
    drawPreview(); $("fTitle").focus();
  } catch (e) {
    status.textContent = (e && e.message) || "That file couldn't be read.";
  } finally { btn.disabled = false; aCtl = null; }
}
function noteFor(info, url) {
  const bits = [];
  if (store.sample) bits.push("Details were filled in from the text only. Check them before saving.");
  if (store.mode === "cloud" && (info.kind === "pdf" || info.kind === "doc" || info.kind === "text") && !url) bits.push("The file is kept on your shelf; only you can open it.");
  if (info.picture) bits.push(info.kind === "pdf" ? "The picture is the file's first page." : "The picture is the first image in the document.");
  if (store.mode === "local" && !url && info.kind !== "link") bits.push("This copy can't keep the file itself, so add a link if you want a Read button.");
  if (store.mode === "db" && !url && (info.kind === "pdf" || info.kind === "doc" || info.kind === "text")) bits.push(info.kind === "pdf" ? "Read will open the PDF you uploaded." : "Read will open the text you added.");
  return bits.join(" ");
}
let previewImg = null, previewFor = null;
function drawPreview() {
  if (!lastRead) return;
  const use = $("fUsePic").checked && lastRead.info.picture;
  const draw = img => {
    const e = { id: nextId(), title: $("fTitle").value.trim() || "Untitled", author: $("fAuthor").value.trim() };
    const c = coverCanvas(e, bookShape(e), img, 0.5), out = $("aCover");
    out.width = c.width; out.height = c.height; out.getContext("2d").drawImage(c, 0, 0);
  };
  if (use) {
    if (previewFor === lastRead.info.picture && previewImg) return draw(previewImg);
    const img = new Image(); img.onload = () => { previewImg = img; previewFor = lastRead.info.picture; draw(img); };
    img.src = URL.createObjectURL(lastRead.info.picture);
  } else draw(null);
}

async function saveIt() {
  const title = $("fTitle").value.trim(), t = $("fTopic").value;
  const status = $("aNote");
  if (!title) { status.textContent = "Add a title first."; $("fTitle").focus(); return; }
  if (!t) { status.textContent = "Choose a topic, so the book goes on the right shelf."; $("fTopic").focus(); return; }
  const link = $("fLink").value.trim();
  if (link && !/^https?:\/\//i.test(link)) { status.textContent = "The link should start with http:// or https://."; return; }
  const btn = $("aSave"); btn.disabled = true; status.textContent = "Putting it on the shelf…";
  const { info, file } = lastRead;
  const id = nextId();
  const entry = {
    id, title, author: $("fAuthor").value.trim(), publication: $("fPub").value.trim(), year: $("fYear").value.trim(),
    description: $("fDesc").value.trim(), topic: t, link, status: link ? "unchecked" : "uploaded",
    cover: null, source: info.kind, added: new Date().toISOString(), fileAsset: null, coverAsset: null, note: null,
  };
  const usePic = $("fUsePic").checked && info.picture;
  try {
    if (store.mode === "cloud") {
      pendingArrival = id;
      const keepFile = file && (info.kind === "pdf" || info.kind === "doc" || info.kind === "text") ? file : null;
      const read = await saveCloud(entry, { ...info, text: info.text || lastRead.text || "" }, keepFile, usePic);
      pendingArrival = read.id;
      await loadCloud();
    } else if (store.mode === "db") {
      if (file && info.kind === "pdf") entry.fileAsset = (await store.assets.upload(file, { type: "application/pdf" })).id;
      else if (!link && info.text) entry.fileAsset = (await store.assets.upload(new Blob([title + "\n\n" + info.text], { type: "text/plain" }), { type: "text/plain" })).id;
      if (usePic) entry.coverAsset = (await store.assets.upload(info.picture)).id;
      if (!entry.link && entry.fileAsset) entry.link = "/_blob/" + entry.fileAsset;
      if (entry.coverAsset) entry.cover = "/_blob/" + entry.coverAsset;
      pendingArrival = id;
      await store.db.collection("reads").doc("r" + id).set(entry);
    } else {
      if (usePic) entry.cover = await smallDataUrl(info.picture);
      const list = extras.map(stripPrivate).concat([entry]);
      localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
      extras = list.map(cleanEntry).filter(Boolean);
      pendingArrival = id; await applyExtras();
    }
    closeAdd(); btn.disabled = false;
    for (const f of ["aUrl", "aUrlText", "aText", "aTextUrl", "aFileUrl"]) $(f).value = ""; $("aFile").value = ""; $("aFileName").textContent = "No file chosen";
  } catch (e) {
    btn.disabled = false; pendingArrival = null;
    const code = e && e.code;
    status.textContent = code === "owner_only" ? "Sign in as the owner first (the link at the foot of the page)."
      : code === "server_error" && e.message ? e.message
      : code === "too_large" ? "That file is over 20 MB. Try a smaller copy."
      : code === "quota_or_state" || code === "quota_exceeded" ? "The page's storage is full. Remove a few added reads and try again."
      : code === "rate_limited" ? "Too many saves at once. Wait a moment and try again."
      : (e && e.name === "QuotaExceededError") ? "This browser's storage is full. Download essays.json, then remove a few added reads."
      : "Saving didn't work. Try again in a moment.";
  }
}
const stripPrivate = e => { const o = { ...e }; delete o._doc; delete o._extra; return o; };
async function smallDataUrl(blob) {
  const img = await createImageBitmap(blob);
  const s = Math.min(1, 480 / img.width), c = document.createElement("canvas");
  c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.8);
}
function exportJson() {
  const all = BASE.concat(extras.map(stripPrivate)).map(e => { const o = { ...e }; delete o._extra; return o; });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(all, null, 2)], { type: "application/json" }));
  a.download = "essays.json"; document.body.appendChild(a); a.click(); a.remove();
}
async function removeOpen() {
  const b = openB; if (!b || !b.essay._extra) return;
  const e = b.essay; $("removeAsk").hidden = true;
  try {
    if (store.mode === "cloud") {
      await api("reads/" + e.id, { method: "DELETE" });
      await loadCloud();
    } else if (store.mode === "db") {
      await store.db.collection("reads").doc(e._doc || ("r" + e.id)).delete();
      for (const a of [e.fileAsset, e.coverAsset]) if (a) await store.assets.delete(a).catch(() => {});
    } else {
      extras = extras.filter(x => x.id !== e.id);
      localStorage.setItem(LOCAL_KEY, JSON.stringify(extras.map(stripPrivate)));
      await applyExtras();
    }
    announce(`${e.title} was removed.`);
  } catch (_) { $("cardRemove").hidden = false; announce("Removing didn't work. Try again."); }
}


/* =====================================================================
   The Cloudflare copy: added reads, files and AI live on the server (functions/api).
   Anyone can browse, read summaries and talk about a read; only the owner,
   with the passphrase set in Cloudflare, can add, remove and open files.
   ===================================================================== */
async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (store.ownerKey) headers["x-owner-key"] = store.ownerKey;
  if (opts.json !== undefined) { headers["content-type"] = "application/json"; opts.body = JSON.stringify(opts.json); }
  const res = await fetch("/api/" + path, { method: opts.method || "GET", headers, body: opts.body, signal: opts.signal });
  if (opts.raw) return res;
  let data = null; try { data = await res.json(); } catch (_) {}
  if (!res.ok || !data || data.ok === false) throw Object.assign(new Error((data && data.message) || "Request failed"), { code: (data && data.error) || "http_" + res.status, status: res.status });
  return data;
}
const lsGet = k => { try { return localStorage.getItem(k) || ""; } catch (_) { return ""; } };
const lsSet = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (_) {} };

async function initCloud() {
  let st;
  try { const r = await fetch("/api/status", { headers: { accept: "application/json" } }); if (!r.ok) return false; st = await r.json(); } catch (_) { return false; }
  if (!st || !st.ok) return false;
  store.ai = !!st.ai;
  setupAI();
  if (!st.store) return false; // functions run but no storage yet: fall back to this browser
  store.mode = "cloud";
  $("ownerBtn").hidden = !st.owner;
  const saved = lsGet(OWNER_KEY_STORE);
  if (saved && st.owner) {
    store.ownerKey = saved;
    try { await api("owner", { method: "POST", json: { key: saved } }); store.canAdd = true; } catch (_) { store.ownerKey = ""; lsSet(OWNER_KEY_STORE, ""); }
  }
  syncOwner();
  await loadCloud();
  if (store.canAdd) moveLocalToCloud();
  return true;
}
async function loadCloud() {
  try {
    const { reads } = await api("reads");
    extras = reads.map(cleanEntry).filter(Boolean).sort((a, b) => a.id - b.id);
  } catch (_) { extras = []; }
  await applyExtras();
}
function syncOwner() {
  showAddButton();
  $("ownerBtn").textContent = store.canAdd ? "Owner: signed in · Sign out" : "Owner sign-in";
  if (store.mode === "cloud") store.sample = store.canAdd && store.ai ? cloudSample : null;
  if (openB) showCard(openB);
}
const cloudSample = { json: async (prompt, o = {}) => (await api("details", { method: "POST", json: { prompt }, signal: o.signal })).value };

function setupOwner() {
  $("ownerBtn").addEventListener("click", () => {
    if (store.canAdd) { store.ownerKey = ""; store.canAdd = false; lsSet(OWNER_KEY_STORE, ""); syncOwner(); announce("Signed out."); return; }
    $("ownerSheet").hidden = false; $("ownerStatus").textContent = ""; $("ownerKey").value = ""; setTimeout(() => $("ownerKey").focus(), 30);
  });
  const close = () => { $("ownerSheet").hidden = true; $("ownerBtn").focus({ preventScroll: true }); };
  $("ownerClose").addEventListener("click", close);
  $("ownerSheet").addEventListener("pointerdown", e => { if (e.target === $("ownerSheet")) close(); });
  $("ownerForm").addEventListener("submit", async e => {
    e.preventDefault();
    const key = $("ownerKey").value; if (!key) return;
    $("ownerStatus").textContent = "Checking…";
    try {
      store.ownerKey = key; await api("owner", { method: "POST", json: { key } });
      store.canAdd = true; if ($("ownerRemember").checked) lsSet(OWNER_KEY_STORE, key);
      close(); syncOwner(); announce("Signed in. You can add, remove and open files now.");
      moveLocalToCloud();
    } catch (err) {
      store.ownerKey = ""; store.canAdd = false;
      $("ownerStatus").textContent = err.code === "wrong_key" ? "That passphrase doesn't match." : "Couldn't check it just now. Try again.";
    }
  });
}

// Reads added earlier in this browser (before the cloud shelf existed) move to the cloud once.
let moving = false;
async function moveLocalToCloud() {
  if (moving || store.mode !== "cloud" || !store.canAdd) return;
  let local = [];
  try { local = (JSON.parse(lsGet(LOCAL_KEY) || "[]") || []).map(cleanEntry).filter(Boolean); } catch (_) { return; }
  if (!local.length) return;
  moving = true;
  const left = [];
  for (const e of local) {
    try {
      const fd = new FormData();
      fd.append("entry", JSON.stringify(stripPrivate(e)));
      if (e.cover && e.cover.startsWith("data:")) fd.append("cover", await (await fetch(e.cover)).blob(), "cover.jpg");
      await api("reads", { method: "POST", body: fd });
    } catch (_) { left.push(e); }
  }
  lsSet(LOCAL_KEY, left.length ? JSON.stringify(left.map(stripPrivate)) : "");
  moving = false;
  if (left.length < local.length) { announce("Reads saved in this browser are now on the shelf everywhere."); await loadCloud(); }
}

async function saveCloud(entry, info, file, usePic) {
  const fd = new FormData();
  fd.append("entry", JSON.stringify(entry));
  if (file) fd.append("file", file, file.name);
  else if (!entry.link && info.text) fd.append("file", new Blob([entry.title + "\n\n" + info.text], { type: "text/plain" }), "text.txt");
  if (info.text) fd.append("text", info.text);
  if (usePic) fd.append("cover", await smallBlob(info.picture), "cover.jpg");
  const { read } = await api("reads", { method: "POST", body: fd });
  return read;
}
async function smallBlob(blob) {
  const url = await smallDataUrl(blob); return (await fetch(url)).blob();
}

/* ---------- opening an uploaded file (owner only) ---------- */
async function openFile(download) {
  const e = openB && openB.essay; if (!e) return;
  // open the tab now, while the click still counts, then point it at the short-lived link
  const w = download ? null : window.open("", "_blank");
  try {
    const r = await api("file-link/" + e.id, { method: "POST" });
    if (download) { const a = document.createElement("a"); a.href = r.download; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove(); }
    else if (w) { w.opener = null; w.location.href = r.view; }
    else location.href = r.view;
  } catch (err) {
    if (w) w.close();
    announce(err.code === "owner_only" ? "Sign in as the owner to open this file." : "The file couldn't be opened. Try again.");
    $("shareNote").textContent = err.code === "owner_only" ? "Only the owner can open this file." : "The file couldn't be opened just now.";
  }
}
function attachFile() {
  const inp = $("attachInput"); inp.value = ""; inp.click();
}
async function attachChosen() {
  const f = $("attachInput").files[0]; const e = openB && openB.essay; if (!f || !e) return;
  $("shareNote").textContent = "Reading the file…";
  try {
    const info = await readFile(f);
    const fd = new FormData();
    fd.append("entry", "{}"); fd.append("file", f, f.name);
    if (info.text) fd.append("text", info.text);
    if (info.picture && !e.cover) fd.append("cover", await smallBlob(info.picture), "cover.jpg");
    $("shareNote").textContent = "Uploading…";
    await api("reads/" + e.id, { method: "PATCH", body: fd });
    $("shareNote").textContent = "File attached.";
    coverImages.delete(e.id);
    await loadCloud();
  } catch (err) { $("shareNote").textContent = (err && err.message && !/Request failed/.test(err.message)) ? err.message : "Attaching didn't work. Try again."; }
}

/* ---------- talking about a read ---------- */
let aiFor = null, aiMsgs = [], aiCtl = null;
function setupAI() {
  if (setupAI.done) return; setupAI.done = true;
  $("cardAsk").addEventListener("click", () => openAI());
  $("aiClose").addEventListener("click", closeAI);
  $("aiSheet").addEventListener("pointerdown", e => { if (e.target === $("aiSheet")) closeAI(); });
  $("aiForm").addEventListener("submit", e => { e.preventDefault(); ask($("aiInput").value); });
  $("aiInput").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask($("aiInput").value); } });
  for (const b of document.querySelectorAll("[data-ask]")) b.addEventListener("click", () => ask(b.dataset.ask));
  $("aiRefresh").addEventListener("click", () => loadSummary(true));
}
function openAI() {
  const e = openB && openB.essay; if (!e) return;
  $("aiSheet").hidden = false;
  if (aiFor !== e.id) {
    aiFor = e.id; aiMsgs = []; $("aiLog").innerHTML = "";
    $("aiTitle").textContent = e.title;
    $("aiMeta").textContent = [e.author, e.publication, e.year].filter(Boolean).join(" · ");
    loadSummary(false);
  }
  setTimeout(() => $("aiInput").focus(), 30);
}
function closeAI() { if (aiCtl) aiCtl.abort(); $("aiSheet").hidden = true; $("cardAsk").focus({ preventScroll: true }); }
const aiOpen = () => !$("aiSheet").hidden;

async function loadSummary(fresh) {
  const id = aiFor, box = $("aiSummary");
  box.textContent = "Reading it and writing a summary…"; box.setAttribute("aria-busy", "true"); $("aiSource").textContent = "";
  try {
    const r = await api("summary/" + id + (fresh ? "?fresh=1" : ""));
    if (aiFor !== id) return;
    renderSummary(box, r.summary);
    $("aiSource").textContent = r.from === "uploaded" ? "From the file you uploaded." : r.from === "page" ? "From the article's web page." : "The article itself couldn't be read (paywall or blocked), so this only uses the title and note.";
  } catch (err) {
    if (aiFor !== id) return;
    box.textContent = err.code === "no_ai" ? "AI isn't connected on this site yet." : "The summary couldn't be made just now. Try again in a moment.";
  } finally { box.removeAttribute("aria-busy"); }
}
function renderSummary(box, text) {
  box.innerHTML = "";
  const lines = String(text || "").split(/\n+/).map(l => l.trim()).filter(Boolean);
  let ul = null;
  for (const l of lines) {
    if (/^[-*•]\s+/.test(l)) { if (!ul) { ul = document.createElement("ul"); box.appendChild(ul); } const li = document.createElement("li"); li.textContent = l.replace(/^[-*•]\s+/, ""); ul.appendChild(li); }
    else { ul = null; const p = document.createElement("p"); p.textContent = l; box.appendChild(p); }
  }
}
async function ask(q) {
  q = (q || "").trim(); if (!q || aiCtl) return;
  const id = aiFor; $("aiInput").value = "";
  aiMsgs.push({ role: "user", content: q }); bubble("user", q);
  const out = bubble("assistant", ""); out.classList.add("typing"); out.textContent = "…";
  aiCtl = new AbortController(); $("aiSend").disabled = true;
  let text = "";
  try {
    const res = await api("chat/" + id, { method: "POST", json: { messages: aiMsgs }, raw: true, signal: aiCtl.signal });
    if (!res.ok || !res.body) { let d = null; try { d = await res.json(); } catch (_) {} throw Object.assign(new Error("chat"), { code: d && d.error }); }
    const reader = res.body.getReader(), dec = new TextDecoder(); let buf = "";
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const d = line.slice(5).trim(); if (d === "[DONE]") continue;
        try { const j = JSON.parse(d); const t = j.response ?? (j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content) ?? ""; if (t) { text += t; out.textContent = text; out.classList.remove("typing"); scrollLog(); } } catch (_) {}
      }
    }
    if (!text) throw new Error("empty");
    aiMsgs.push({ role: "assistant", content: text });
  } catch (err) {
    if (err && err.name === "AbortError") { out.remove(); aiMsgs.pop(); }
    else { out.classList.remove("typing"); out.textContent = err && err.code === "no_ai" ? "AI isn't connected on this site yet." : "That didn't go through. Try asking again."; aiMsgs.pop(); }
  } finally { aiCtl = null; $("aiSend").disabled = false; if (aiFor === id && aiOpen()) $("aiInput").focus({ preventScroll: true }); }
}
function bubble(role, text) {
  const d = document.createElement("div"); d.className = "msg " + role; d.textContent = text;
  if (role === "assistant") d.setAttribute("aria-live", "polite");
  $("aiLog").appendChild(d); scrollLog(); return d;
}
function scrollLog() { const l = $("aiLog"); l.scrollTop = l.scrollHeight; }
