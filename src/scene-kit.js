// Shared scene pieces: renderer, warm top-left light, wood texture.
import * as THREE from "three";

export function makeRenderer(canvas, { quality = "high" } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === "high", powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === "high" ? 2 : 1.25));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 1);
  return renderer;
}

export function addLights(scene, { shadowSize = 2048, span = 1.6 } = {}) {
  scene.add(new THREE.HemisphereLight(0xfff1dc, 0x0a0806, 0.55));
  const key = new THREE.DirectionalLight(0xffd6a0, 2.6); // warm, from the top left
  key.position.set(-1.6, 2.4, 1.6);
  key.castShadow = true;
  key.shadow.mapSize.set(shadowSize, shadowSize);
  key.shadow.radius = 6; key.shadow.bias = -0.0004; key.shadow.normalBias = 0.01;
  const cam = key.shadow.camera; cam.left = -span; cam.right = span; cam.top = span; cam.bottom = -span; cam.near = 0.1; cam.far = 8;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbcd2ff, 0.25); fill.position.set(1.5, 0.6, 1.2);
  scene.add(fill);
  return { key };
}

export function woodTexture(dark = false) {
  const c = document.createElement("canvas"); c.width = 1024; c.height = 128;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, dark ? "#3a2416" : "#6b4128"); g.addColorStop(1, dark ? "#2a1a10" : "#57331f");
  x.fillStyle = g; x.fillRect(0, 0, 1024, 128);
  let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 70; i++) {
    const y = r() * 128, a = 0.04 + r() * 0.08, amp = 2 + r() * 6, f = 0.004 + r() * 0.01, ph = r() * 6;
    x.strokeStyle = `rgba(${r() < 0.5 ? "30,15,5" : "160,110,70"},${a})`; x.lineWidth = 0.6 + r() * 1.6;
    x.beginPath();
    for (let px = 0; px <= 1024; px += 8) x.lineTo(px, y + Math.sin(px * f + ph) * amp);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

export async function loadFonts() {
  try {
    await Promise.all([
      document.fonts.load('700 40px "Playfair Display"'),
      document.fonts.load('500 20px "IBM Plex Mono"'),
      document.fonts.load('italic 400 20px "Source Serif 4"'),
      document.fonts.load('400 20px "Source Serif 4"'),
    ]);
  } catch (e) { /* fall back to system serif */ }
}
