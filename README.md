# Interesting Reads

A one-page site that shows every item in essays.json as a book on a slowly turning 3D shelf.

## Adding reads later
Press **+ Add a read** (top right; shown only to people who may add):

- **Link**: paste the link, and if you like, some or all of the article's text. The page cannot open other websites itself, so the details come from the text you paste.
- **Paste text**: paste the essay; add its link if it has one.
- **PDF or Word file**: upload a PDF, a Word (.docx) or a text file. A PDF's first page (or a Word file's first picture) becomes the picture on the cover.

On the published claude.ai page, Claude fills in the title, author, publication, year, topic and a one-line description using only what is in that text; you check them, then press **Put it on the shelf**. The entry and its file are kept with the page, the new book drops onto the shelf in the same style as the others, and **Remove from shelf** takes it off again.

On a copy you host yourself (the `site/` folder) there is no Claude, so you fill in the details; additions are kept in that browser. Use **Download essays.json with your additions** and replace `public/essays.json` to make them permanent for everyone.

## Files
- `npm run build` makes the finished site in `dist/` (plain static files). Serve it over http (it loads essays.json), not as a local file.
- Edit `public/essays.json`, then `npm install` once and `npm run build`. Pushing to GitHub redeploys the live site on Cloudflare Pages.
- Covers for the original 150: put an image in `public/covers/`, for example `091.jpg`, and set that item's `"cover"` to `"covers/091.jpg"`. None could be downloaded during the build; `covers-missing.tsv` lists all 150.
- Share links look like `…/#book-091`.
- `perf/` has the smoothness test (`measure.py`) and its results; `results.md` is the summary.

## Cloud shelf, files and AI (Cloudflare)

The `functions/api` folder runs on Cloudflare Pages and adds:

- **Added reads stored online**, so they appear on every device (not just one browser).
- **Your uploaded PDF / Word files**, which only you can open or download.
- **Summary & ask AI** on every book: a short summary and a conversation about the piece, using the
  uploaded file's text or the article's web page (paywalled pages fall back to the title and note).

It needs three things in Cloudflare → Workers & Pages → my-digital-library → Settings → Bindings / Variables:

| Name | Type | What it is |
|---|---|---|
| `SHELF` | KV namespace | where added reads, files and summaries are kept |
| `AI` | Workers AI | the model for summaries and chat (free daily allowance) |
| `OWNER_KEY` | Secret | your passphrase; sign in with "Owner sign-in" at the foot of the page |

Without these, the site still works as before and keeps additions in the browser.
