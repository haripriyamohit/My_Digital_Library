// Reading a new item: text and a picture out of a PDF or Word file, and its details
// (title, author, ...) filled in by Claude from that text only. Libraries load on first use.

const LIBS = {
  pdf: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js",
  pdfWorker: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js",
  mammoth: "https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js",
};
const loaded = new Map();
function loadScript(src) {
  if (!loaded.has(src)) loaded.set(src, new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = src; s.async = true;
    s.onload = res; s.onerror = () => { loaded.delete(src); rej(new Error("Could not load a helper library. Check your connection and try again.")); };
    document.head.appendChild(s);
  }));
  return loaded.get(src);
}

const MAX_TEXT = 24000; // enough for Claude to find the title, author and gist

export async function readFile(file) {
  const name = file.name || "file";
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (ext === "pdf" || file.type === "application/pdf") return { kind: "pdf", ...(await readPdf(file)) };
  if (ext === "docx") return { kind: "doc", ...(await readDocx(file)) };
  if (ext === "doc") throw new Error("Old .doc files can't be read here. Save it as .docx or PDF and try again.");
  if (["txt", "md", "markdown", "text"].includes(ext) || file.type.startsWith("text/")) return { kind: "text", text: (await file.text()).slice(0, 400000), picture: null };
  throw new Error("Use a PDF, a Word (.docx) file, or a plain text file.");
}

async function readPdf(file) {
  await loadScript(LIBS.pdf);
  const lib = window.pdfjsLib;
  if (!lib.GlobalWorkerOptions.workerPort) {
    // a worker must come from this page's own origin, so start one that pulls the script in
    const boot = new Blob([`importScripts(${JSON.stringify(LIBS.pdfWorker)});`], { type: "text/javascript" });
    lib.GlobalWorkerOptions.workerPort = new Worker(URL.createObjectURL(boot));
  }
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  let text = "";
  for (let p = 1; p <= Math.min(doc.numPages, 8) && text.length < MAX_TEXT; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    text += tc.items.map(i => i.str + (i.hasEOL ? "\n" : " ")).join("") + "\n\n";
  }
  // the first page, drawn small, becomes the picture in the middle of the cover
  const first = await doc.getPage(1);
  const vp0 = first.getViewport({ scale: 1 });
  const scale = Math.min(2, 700 / vp0.width);
  const vp = first.getViewport({ scale });
  const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  await first.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
  const picture = await new Promise(r => c.toBlob(r, "image/jpeg", 0.85));
  const meta = await doc.getMetadata().catch(() => null);
  return { text: text.trim(), picture, pages: doc.numPages, pdfTitle: meta?.info?.Title || "", pdfAuthor: meta?.info?.Author || "" };
}

async function readDocx(file) {
  await loadScript(LIBS.mammoth);
  const buf = await file.arrayBuffer();
  const { value: text } = await window.mammoth.extractRawText({ arrayBuffer: buf });
  // the first picture inside the document, if there is one
  let picture = null;
  await window.mammoth.convertToHtml({ arrayBuffer: buf }, {
    convertImage: window.mammoth.images.imgElement(async img => {
      if (!picture && /^image\/(png|jpe?g|gif|webp)$/.test(img.contentType)) {
        const b64 = await img.read("base64");
        const bin = atob(b64), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        picture = new Blob([bytes], { type: img.contentType });
      }
      return { src: "" };
    }),
  });
  return { text: text.trim(), picture };
}

// Ask Claude to fill the fields from the text it is given, and nothing else.
export async function suggestDetails(sample, { text, url, fileName, topics, signal }) {
  const parts = [
    "You are filling in a reading-list entry. Use ONLY information that appears in the material below.",
    "Never guess or use outside knowledge. If a field is not stated, return an empty string for it.",
    "Reply with only one JSON object with these keys:",
    '{"title": string, "author": string, "publication": string, "year": string, "description": string, "topic": string}',
    "- title: the piece's own title as written.",
    "- author: the author or authors as written (\"A and B\" for two).",
    "- publication: the magazine, journal, site or publisher named in the material.",
    "- year: four digits, only if a publication year or date is stated.",
    "- description: ONE plain sentence, under 15 words, saying what the piece is about, based on the text.",
    `- topic: exactly one of these, the best fit: ${topics.map(t => JSON.stringify(t)).join(", ")}.`,
    "",
  ];
  if (url) parts.push("Link: " + url);
  if (fileName) parts.push("File name: " + fileName);
  if (text) parts.push("", "Material:", text.slice(0, MAX_TEXT));
  else parts.push("", "There is no text, only the link above: take the title from the link's words only if they clearly spell it out; leave everything else empty except topic.");
  const out = await sample.json(parts.join("\n"), { modelTier: "quick", signal });
  const s = v => (typeof v === "string" ? v.trim() : "");
  const res = { title: s(out?.title), author: s(out?.author), publication: s(out?.publication), year: s(out?.year), description: s(out?.description), topic: s(out?.topic) };
  if (!/^\d{4}$/.test(res.year)) res.year = "";
  if (!topics.includes(res.topic)) res.topic = "";
  return res;
}

// Without Claude: only what can be read directly.
export function plainDetails({ text, url, fileName, pdfTitle, pdfAuthor }) {
  const firstLine = (text || "").split("\n").map(l => l.trim()).find(l => l.length > 3 && l.length < 160) || "";
  const fromName = fileName ? fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() : "";
  return { title: pdfTitle || firstLine || fromName, author: pdfAuthor || "", publication: "", year: "", description: "", topic: "", url: url || "" };
}
