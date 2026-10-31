import { defineConfig } from "vite";
import fs from "node:fs";

// Topic buttons, the screen-reader list and the plain fallback list are written into the HTML
// at build time, so nothing is inserted after load and the shelf never jumps down the page.
const CHIP = ["#ff5fa2", "#3ee6b0", "#ffd93d", "#ff8a3d", "#9b5cff", "#ff3d5a", "#3db8ff", "#a6e22e", "#ffb38a", "#2ee6e6", "#ff9ad5", "#4d6bff"];
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function staticShelfHtml() {
  return {
    name: "static-shelf-html",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const data = JSON.parse(fs.readFileSync("public/essays.json", "utf8"));
        const topics = [...new Set(data.map(e => e.topic))];
        const chips = `<button class="chip" type="button" data-topic="" aria-pressed="true" style="--chip:#f3ecdc">All shelves</button>` +
          topics.map((t, i) => `<button class="chip" type="button" data-topic="${esc(t)}" aria-pressed="false" style="--chip:${CHIP[(i * 5) % CHIP.length]}">${esc(t)}</button>`).join("");
        const sr = data.map(e => `<li><button type="button" tabindex="-1" data-id="${e.id}">Open ${esc(e.title)}${e.author ? ", by " + esc(e.author) : ""}</button></li>`).join("");
        const plain = topics.map(t => `<section data-topic="${esc(t)}"><h3>${esc(t)}</h3><ol>` +
          data.filter(e => e.topic === t).map(e => `<li id="p-${e.id}" tabindex="-1"><a href="${esc(e.link)}" target="_blank" rel="noopener">${esc(e.title)}</a> <span class="m">${esc([e.author, e.publication, e.year].filter(Boolean).join(" · "))}</span><br>${esc(e.description)}</li>`).join("") +
          `</ol></section>`).join("");
        html = html.replace('<div class="topics" id="topics" role="group" aria-label="Topics"></div>', `<div class="topics" id="topics" role="group" aria-label="Topics">${chips}</div>`)
          .replace('<ul class="sr-only" id="srList" aria-label="All books"></ul>', `<ul class="sr-only" id="srList" aria-label="All books">${sr}</ul>`)
          .replace('<div id="plainBody"></div>', `<div id="plainBody">${plain}</div>`);
        // preload the three faces used above the fold, so text does not change width when they arrive
        if (ctx.bundle) {
          const want = [/playfair-display-latin-700-normal.*\.woff2$/, /source-serif-4-latin-400-normal.*\.woff2$/, /ibm-plex-mono-latin-500-normal.*\.woff2$/];
          const links = Object.keys(ctx.bundle).filter(f => want.some(r => r.test(f)))
            .map(f => `<link rel="preload" href="./${f}" as="font" type="font/woff2" crossorigin>`).join("\n");
          html = html.replace("</title>", "</title>\n" + links);
        }
        return html;
      },
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [staticShelfHtml()],
  build: { target: "es2022", chunkSizeWarningLimit: 900, assetsInlineLimit: f => f.endsWith(".woff2") }, // woff2 fonts ride inside the CSS: no swap, no jump
  server: { port: 5173, strictPort: true },
});
