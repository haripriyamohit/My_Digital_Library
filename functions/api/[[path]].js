// Interesting Reads — server side, running as Cloudflare Pages Functions.
//
// Needs, in Cloudflare → the Pages project → Settings:
//   - a KV namespace bound as  SHELF      (added reads, their files, covers and AI caches)
//   - Workers AI bound as      AI         (summaries and chat)
//   - a secret named           OWNER_KEY  (your passphrase; only you can add, remove and open files)
//
// Routes (all under /api):
//   GET    /api/status                 what is set up
//   POST   /api/owner                  check a passphrase
//   GET    /api/reads                  the added reads (public fields only)
//   POST   /api/reads                  add one (owner)            multipart: entry, file?, cover?, text?
//   PATCH  /api/reads/:id              attach a file / change details (owner)
//   DELETE /api/reads/:id              remove one (owner)
//   GET    /api/cover/:id              cover picture of an added read
//   POST   /api/file-link/:id          a short-lived link to open or download the file (owner)
//   GET    /api/file/:id?exp&sig[&dl]  the file itself, with a valid link
//   POST   /api/fetch-text             the readable text of a web page (owner, used when adding a link)
//   POST   /api/details                fill in title/author/topic from text (owner)
//   GET    /api/summary/:id            a short summary of a read (cached)
//   POST   /api/chat/:id               talk about a read (streams)

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_FILE = 20 * 1024 * 1024;
const MAX_CONTEXT = 40000; // characters of the article given to the AI
const LINK_MINUTES = 30;

export async function onRequest(ctx) {
  const { request, env, params } = ctx;
  const parts = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const [route, arg] = parts;
  const m = request.method;
  try {
    if (route === "status" && m === "GET") return json({ ok: true, store: !!env.SHELF, ai: !!aiOf(env), owner: !!env.OWNER_KEY });
    if (!env.SHELF) return json({ ok: false, error: "not_set_up", message: "The SHELF storage isn't connected yet." }, 503);
    if (route === "owner" && m === "POST") {
      const { key } = await request.json().catch(() => ({}));
      return (await keyOk(env, key)) ? json({ ok: true }) : json({ ok: false, error: "wrong_key" }, 401);
    }
    if (route === "reads" && !arg && m === "GET") return json({ ok: true, reads: (await index(env)).map(publicEntry) }, 200, { "cache-control": "no-store" });
    if (route === "reads" && !arg && m === "POST") return (await owner(request, env)) || addRead(request, env);
    if (route === "reads" && arg && m === "PATCH") return (await owner(request, env)) || patchRead(request, env, toId(arg));
    if (route === "reads" && arg && m === "DELETE") return (await owner(request, env)) || removeRead(env, toId(arg));
    if (route === "cover" && arg && m === "GET") return cover(env, toId(arg));
    if (route === "file-link" && arg && m === "POST") return (await owner(request, env)) || fileLink(request, env, toId(arg));
    if (route === "file" && arg && m === "GET") return file(request, env, toId(arg));
    if (route === "fetch-text" && m === "POST") return (await owner(request, env)) || fetchTextRoute(request);
    if (route === "details" && m === "POST") return (await owner(request, env)) || details(request, env);
    if (route === "summary" && arg && m === "GET") return summary(request, env, toId(arg));
    if (route === "chat" && arg && m === "POST") return chat(request, env, toId(arg));
    return json({ ok: false, error: "not_found" }, 404);
  } catch (e) {
    return json({ ok: false, error: "server_error", message: String(e && e.message || e).slice(0, 200) }, 500);
  }
}

/* ---------------- helpers ---------------- */
const json = (o, status = 200, h = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", ...h } });
const toId = s => { const n = Number(s); return Number.isInteger(n) && n > 0 ? n : 0; };
const str = (v, n = 400) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim().slice(0, n);
const enc = new TextEncoder();

async function sha(s) { return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
async function keyOk(env, key) {
  if (!env.OWNER_KEY || typeof key !== "string" || !key) return false;
  const [a, b] = await Promise.all([sha(key), sha(env.OWNER_KEY)]);
  let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
async function owner(request, env) {
  if (!env.OWNER_KEY) return json({ ok: false, error: "no_owner_key", message: "Set OWNER_KEY in Cloudflare first." }, 503);
  return (await keyOk(env, request.headers.get("x-owner-key"))) ? null : json({ ok: false, error: "owner_only" }, 401);
}
async function sign(env, id, exp) {
  const k = await crypto.subtle.importKey("raw", enc.encode("file-link:" + env.OWNER_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(id + ":" + exp)));
  return [...s].map(b => b.toString(16).padStart(2, "0")).join("");
}
function aiOf(env) {
  if (env.AI) return env.AI;
  if (env.FAKE_AI === "1") return fakeAI; // local testing only
  return null;
}

/* ---------------- the added reads ---------------- */
async function index(env) { return (await env.SHELF.get("index", "json")) || []; }
async function saveIndex(env, list) { await env.SHELF.put("index", JSON.stringify(list)); }
const publicEntry = e => { const o = { ...e }; delete o.fileName; return o; };

async function baseEssays(request, env) {
  const url = new URL("/essays.json", request.url);
  const res = env.ASSETS ? await env.ASSETS.fetch(url) : await fetch(url);
  const d = await res.json();
  return Array.isArray(d) ? d : (d.essays || []);
}

function cleanEntry(x, id) {
  const link = str(x.link, 2000);
  return {
    id, title: str(x.title, 300) || "Untitled", author: str(x.author, 200) || null, publication: str(x.publication, 200) || null,
    year: str(x.year, 9) || null, description: str(x.description, 300), topic: str(x.topic, 80),
    link: /^https?:\/\//i.test(link) ? link : "", status: link ? "unchecked" : "uploaded",
    source: str(x.source, 20) || null, added: str(x.added, 40) || new Date().toISOString(),
  };
}

async function addRead(request, env) {
  const form = await request.formData();
  const raw = JSON.parse(form.get("entry") || "{}");
  const list = await index(env);
  const base = await baseEssays(request, env);
  const taken = new Set(base.map(e => e.id).concat(list.map(e => e.id)));
  let id = toId(raw.id);
  if (!id || taken.has(id)) id = Math.max(0, ...taken) + 1;
  const entry = cleanEntry(raw, id);
  await storeParts(env, entry, form);
  list.push(entry); await saveIndex(env, list);
  return json({ ok: true, read: publicEntry(entry) });
}

async function storeParts(env, entry, form) {
  const f = form.get("file");
  if (f && typeof f === "object" && f.size) {
    if (f.size > MAX_FILE) throw new Error("That file is over 20 MB.");
    await env.SHELF.put("file:" + entry.id, await f.arrayBuffer(), { metadata: { type: f.type || "application/octet-stream", name: str(f.name, 200), size: f.size } });
    entry.hasFile = true; entry.fileType = f.type || ""; entry.fileName = str(f.name, 200);
  }
  const c = form.get("cover");
  if (c && typeof c === "object" && c.size && c.size < 2 * 1024 * 1024 && /^image\/(jpeg|png|webp)$/.test(c.type)) {
    await env.SHELF.put("cover:" + entry.id, await c.arrayBuffer(), { metadata: { type: c.type } });
    entry.cover = "/api/cover/" + entry.id + "?v=" + Date.now().toString(36);
  }
  const t = form.get("text");
  if (typeof t === "string" && t.trim()) {
    await env.SHELF.put("text:" + entry.id, t.slice(0, 400000));
    entry.hasText = true;
    await env.SHELF.delete("sum:" + entry.id);
  }
}

async function patchRead(request, env, id) {
  const list = await index(env); const i = list.findIndex(e => e.id === id);
  if (i < 0) return json({ ok: false, error: "not_found" }, 404);
  const form = await request.formData();
  const raw = JSON.parse(form.get("entry") || "{}");
  const keep = list[i];
  const entry = Object.keys(raw).length ? { ...keep, ...cleanEntry({ ...keep, ...raw }, id), hasFile: keep.hasFile, fileType: keep.fileType, fileName: keep.fileName, cover: keep.cover, hasText: keep.hasText } : { ...keep };
  await storeParts(env, entry, form);
  list[i] = entry; await saveIndex(env, list);
  return json({ ok: true, read: publicEntry(entry) });
}

async function removeRead(env, id) {
  const list = await index(env);
  await saveIndex(env, list.filter(e => e.id !== id));
  await Promise.all(["file:", "cover:", "text:", "sum:", "page:"].map(p => env.SHELF.delete(p + id)));
  return json({ ok: true });
}

async function cover(env, id) {
  const { value, metadata } = await env.SHELF.getWithMetadata("cover:" + id, "arrayBuffer");
  if (!value) return new Response("Not found", { status: 404 });
  return new Response(value, { headers: { "content-type": (metadata && metadata.type) || "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
}

async function fileLink(request, env, id) {
  const exp = Math.floor(Date.now() / 1000) + LINK_MINUTES * 60;
  const sig = await sign(env, id, exp);
  const base = `/api/file/${id}?exp=${exp}&sig=${sig}`;
  return json({ ok: true, view: base, download: base + "&dl=1" });
}

async function file(request, env, id) {
  const u = new URL(request.url);
  const exp = Number(u.searchParams.get("exp")), sig = u.searchParams.get("sig") || "";
  if (!env.OWNER_KEY || !exp || exp < Date.now() / 1000 || sig !== await sign(env, id, exp)) return new Response("This link has expired. Open the file again from the shelf.", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  const { value, metadata } = await env.SHELF.getWithMetadata("file:" + id, "arrayBuffer");
  if (!value) return new Response("Not found", { status: 404 });
  const name = (metadata && metadata.name) || "read-" + id;
  const safe = name.replace(/[^\w.\- ]+/g, "_");
  const disp = (u.searchParams.has("dl") ? "attachment" : "inline") + `; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(name)}`;
  return new Response(value, { headers: { "content-type": (metadata && metadata.type) || "application/octet-stream", "content-disposition": disp, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}

/* ---------------- reading web pages ---------------- */
async function fetchTextRoute(request) {
  const { url } = await request.json().catch(() => ({}));
  if (!/^https?:\/\//i.test(url || "")) return json({ ok: false, error: "bad_url" }, 400);
  const r = await pageText(url);
  return json({ ok: !!r.text, ...r });
}

class Collect {
  constructor() { this.parts = []; this.skip = 0; this.title = ""; this.meta = {}; this.inTitle = false; }
}
async function pageText(url) {
  let res;
  try {
    res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; InterestingReads/1.0; personal reading list)", accept: "text/html,application/xhtml+xml" }, redirect: "follow", cf: { cacheTtl: 3600 } });
  } catch (e) { return { text: "", reason: "unreachable" }; }
  if (!res.ok) return { text: "", reason: "status_" + res.status };
  const type = res.headers.get("content-type") || "";
  if (/text\/plain/.test(type)) return { text: (await res.text()).slice(0, 200000), title: "" };
  if (!/html/.test(type)) return { text: "", reason: "not_html" };
  const c = new Collect();
  const blocks = "p, h1, h2, h3, h4, li, blockquote, pre, figcaption";
  const rw = new HTMLRewriter()
    .on("title", { element(el) { c.inTitle = true; el.onEndTag(() => { c.inTitle = false; }); }, text(t) { if (c.inTitle) c.title += t.text; } })
    .on('meta[property="og:title"], meta[name="author"], meta[property="article:author"], meta[name="description"], meta[property="og:description"], meta[property="og:site_name"], meta[property="article:published_time"]', {
      element(el) { const k = el.getAttribute("property") || el.getAttribute("name"); const v = el.getAttribute("content"); if (k && v && !c.meta[k]) c.meta[k] = v; },
    })
    .on("script, style, noscript, nav, footer, header, aside, form, svg", { element(el) { c.skip++; el.onEndTag(() => { c.skip--; }); } })
    .on(blocks, { element(el) { if (!c.skip) { c.parts.push("\n"); el.onEndTag(() => { c.parts.push("\n"); }); } }, text(t) { if (!c.skip) c.parts.push(t.text); } });
  await rw.transform(res).arrayBuffer();
  const text = decode(c.parts.join("")).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
  const metaLines = Object.entries(c.meta).map(([k, v]) => `${k}: ${decode(v)}`).join("\n");
  return { text: text.length > 400 ? text.slice(0, 200000) : "", title: decode(c.title).trim(), meta: metaLines, reason: text.length > 400 ? "" : "too_little_text" };
}
function decode(s) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

// The material the AI reads for one item: the uploaded text, or the article page, cached for 30 days.
async function material(request, env, id) {
  const list = await index(env);
  let e = list.find(x => x.id === id);
  if (!e) e = (await baseEssays(request, env)).find(x => x.id === id);
  if (!e) return null;
  let text = "", from = "none";
  const own = await env.SHELF.get("text:" + id);
  if (own) { text = own; from = "uploaded"; }
  else if (e.link && /^https?:\/\//i.test(e.link)) {
    const cached = await env.SHELF.get("page:" + id, "json");
    if (cached) { text = cached.text || ""; from = text ? "page" : "page_unavailable"; }
    else {
      const r = await pageText(e.link);
      await env.SHELF.put("page:" + id, JSON.stringify({ text: r.text || "", reason: r.reason || "" }), { expirationTtl: 60 * 60 * 24 * (r.text ? 30 : 2) });
      text = r.text || ""; from = text ? "page" : "page_unavailable";
    }
  }
  return { e, text: text.slice(0, MAX_CONTEXT), from, truncated: text.length > MAX_CONTEXT };
}

function header(e) {
  return [`Title: ${e.title}`, e.author && `Author: ${e.author}`, e.publication && `Publication: ${e.publication}`, e.year && `Year: ${e.year}`, e.description && `One-line note on the reading list: ${e.description}`, e.topic && `Shelf topic: ${e.topic}`, e.link && `Link: ${e.link}`].filter(Boolean).join("\n");
}
function sourceNote(m) {
  if (m.from === "uploaded") return "The full text below comes from the file the owner uploaded" + (m.truncated ? " (only the first part fits here)." : ".");
  if (m.from === "page") return "The text below was read from the article's web page" + (m.truncated ? " (only the first part fits here)." : ".");
  return "The article's text could not be read (it may be paywalled or the site blocks automated reading). Only the details above are known.";
}

/* ---------------- AI ---------------- */
async function runAI(env, messages, opts = {}) {
  const ai = aiOf(env); if (!ai) throw Object.assign(new Error("AI isn't connected yet."), { code: "no_ai" });
  return ai.run(MODEL, { messages, max_tokens: opts.max_tokens || 700, temperature: opts.temperature ?? 0.3, stream: !!opts.stream });
}
const textOf = r => (r && (r.response ?? (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content))) || "";

async function summary(request, env, id) {
  const cached = await env.SHELF.get("sum:" + id, "json");
  if (cached && !new URL(request.url).searchParams.has("fresh")) return json({ ok: true, ...cached, cached: true });
  if (!aiOf(env)) return json({ ok: false, error: "no_ai", message: "AI isn't connected yet." }, 503);
  const m = await material(request, env, id);
  if (!m) return json({ ok: false, error: "not_found" }, 404);
  const sys = [
    "You write short, plain summaries for a personal reading list.",
    "Use ONLY the material provided. Never invent quotes, facts, dates or arguments.",
    "If the article text is not available, say so in one sentence first, then describe only what the title, author and note tell you, without guessing the argument.",
    "Format: 3 to 5 short bullet points starting with '- ', then one line starting with 'Why read it: '. No headings. Under 150 words.",
  ].join(" ");
  const user = `${header(m.e)}\n\n${sourceNote(m)}\n\n${m.text ? "Article text:\n" + m.text : ""}`;
  const r = await runAI(env, [{ role: "system", content: sys }, { role: "user", content: user }], { max_tokens: 450 });
  const out = { summary: textOf(r).trim(), from: m.from };
  if (out.summary) await env.SHELF.put("sum:" + id, JSON.stringify(out), { expirationTtl: m.from === "page_unavailable" ? 60 * 60 * 24 * 2 : 60 * 60 * 24 * 90 });
  return json({ ok: true, ...out });
}

async function chat(request, env, id) {
  if (!aiOf(env)) return json({ ok: false, error: "no_ai", message: "AI isn't connected yet." }, 503);
  const body = await request.json().catch(() => ({}));
  const history = (Array.isArray(body.messages) ? body.messages : [])
    .filter(x => x && (x.role === "user" || x.role === "assistant") && typeof x.content === "string")
    .slice(-12).map(x => ({ role: x.role, content: x.content.slice(0, 2000) }));
  if (!history.length || history[history.length - 1].role !== "user") return json({ ok: false, error: "bad_request" }, 400);
  const m = await material(request, env, id);
  if (!m) return json({ ok: false, error: "not_found" }, 404);
  const sys = [
    "You are a thoughtful reading companion on a personal bookshelf website called Interesting Reads.",
    "You are discussing one piece of writing, given below. Answer questions about it, explain ideas, connect it to related thinkers or debates, and suggest what to read next.",
    "Ground claims about this piece in the provided text. When you go beyond it with general knowledge, say so plainly (for example 'Outside the essay, ...'). If the text isn't available, say you haven't been able to read it and stay general.",
    "Never make up quotations. Quote at most two short sentences at a time, and never reproduce long passages or the whole text, even if asked.",
    "Be concise: short paragraphs, under 200 words unless asked for more. Use plain language.",
    "", header(m.e), "", sourceNote(m), "", m.text ? "Text:\n" + m.text : "",
  ].join("\n");
  const stream = await runAI(env, [{ role: "system", content: sys }, ...history], { stream: true, max_tokens: 700, temperature: 0.5 });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" } });
}

async function details(request, env) {
  if (!aiOf(env)) return json({ ok: false, error: "no_ai" }, 503);
  const { prompt } = await request.json().catch(() => ({}));
  if (typeof prompt !== "string" || !prompt) return json({ ok: false, error: "bad_request" }, 400);
  const r = await runAI(env, [
    { role: "system", content: "You extract reading-list details. Reply with one JSON object only, no other text." },
    { role: "user", content: prompt.slice(0, 30000) },
  ], { max_tokens: 300, temperature: 0 });
  const t = textOf(r); const mm = typeof t === "string" ? t.match(/\{[\s\S]*\}/) : null;
  let value = null; try { value = typeof t === "object" ? t : JSON.parse(mm ? mm[0] : "null"); } catch (_) {}
  return json({ ok: !!value, value });
}

/* ---------------- a stand-in AI for local tests (FAKE_AI=1) ---------------- */
const fakeAI = {
  async run(model, { messages, stream }) {
    const last = messages[messages.length - 1].content;
    const sys = messages[0].content;
    let reply;
    if (/JSON object/.test(sys)) reply = JSON.stringify({ title: "Fake Title From Text", author: "Fake Author", publication: "", year: "2020", description: "A fake description.", topic: "" });
    else if (/summaries/.test(sys)) reply = "- Point one from the text.\n- Point two.\n- Point three.\nWhy read it: fake. [chars of material: " + last.length + "]";
    else reply = "Fake answer about: " + last.slice(0, 60) + " [system chars " + sys.length + "]";
    if (!stream) return { response: reply };
    const words = reply.split(/(?<= )/);
    return new ReadableStream({ async start(ctl) { for (const w of words) ctl.enqueue(enc.encode(`data: ${JSON.stringify({ response: w })}\n\n`)); ctl.enqueue(enc.encode("data: [DONE]\n\n")); ctl.close(); } });
  },
};
