"""Smoothness measurements for Interesting Reads.

For each device profile and interaction we record, in the page itself:
  - every animation frame's timestamp  -> fps, p95 frame time, stutters (frames > 50 ms), worst frame
  - long main-thread tasks (> 50 ms)   -> count and total blocked time
  - layout shifts                      -> cumulative layout shift (CLS), any jump at all counts
Load also reports time to the first drawn shelf.

Rendering runs on SwiftShader (software WebGL, no GPU), so absolute fps are far below a real
laptop or phone; compare before/after on the same profile.
usage: python3 measure.py URL OUT.json [label]
"""
import asyncio, json, sys, statistics as st
from playwright.async_api import async_playwright

ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
PROFILES = {
    "laptop":     dict(w=1440, h=900, dpr=1, cpu=1, touch=False),
    "old laptop": dict(w=1366, h=768, dpr=1, cpu=4, touch=False),
    "phone":      dict(w=390, h=844, dpr=2, cpu=2, touch=True),
}

INSTRUMENT = """
(() => {
  window.__m = { frames: [], longtasks: [], shifts: [], rec: true };
  const f = t => { if (window.__m.rec) window.__m.frames.push(t); requestAnimationFrame(f); }; requestAnimationFrame(f);
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__m.longtasks.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__m.shifts.push([e.startTime, e.value]); }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
})();
"""

def summarize(frames, longtasks, shifts, t0, t1):
    fr = [f for f in frames if t0 <= f <= t1]
    d = [b - a for a, b in zip(fr, fr[1:])]
    lt = [x for x in longtasks if t0 <= x[0] <= t1]
    sh = [x for x in shifts if t0 <= x[0] <= t1]
    if not d:
        return dict(fps=0, p95_ms=None, hitches=0, worst_ms=None, longtasks=len(lt), blocked_ms=round(sum(x[1] for x in lt)), cls=round(sum(x[1] for x in sh), 4))
    d_sorted = sorted(d); med = d_sorted[len(d_sorted) // 2]
    return dict(
        fps=round(len(d) / ((fr[-1] - fr[0]) / 1000), 1),
        p95_ms=round(d_sorted[int(0.95 * (len(d_sorted) - 1))], 1),
        # a hitch is a frame that takes more than twice as long as the typical frame in that moment
        hitches=sum(1 for x in d if x > max(2 * med, 50)),
        worst_ms=round(max(d), 1),
        longtasks=len(lt), blocked_ms=round(sum(max(0, x[1] - 50) for x in lt)),
        cls=round(sum(x[1] for x in sh), 4),
    )

async def window(pg, ms, action=None):
    t0 = await pg.evaluate("performance.now()")
    if action: await action()
    await pg.wait_for_timeout(ms)
    t1 = await pg.evaluate("performance.now()")
    m = await pg.evaluate("window.__m")
    return summarize(m["frames"], m["longtasks"], m["shifts"], t0, t1)

async def run_profile(p, url, name, prof):
    b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=ARGS)
    ctx = await b.new_context(viewport={"width": prof["w"], "height": prof["h"]}, device_scale_factor=prof["dpr"],
                              has_touch=prof["touch"], is_mobile=prof["touch"])
    pg = await ctx.new_page()
    errors = []; pg.on("pageerror", lambda e: errors.append(str(e)))
    await pg.add_init_script(INSTRUMENT)
    cdp = await ctx.new_cdp_session(pg)
    if prof["cpu"] > 1: await cdp.send("Emulation.setCPUThrottlingRate", {"rate": prof["cpu"]})
    out = {}
    await pg.goto(url)
    await pg.wait_for_selector("body[data-ready]", timeout=120000)
    first = await pg.evaluate("window.__ir.firstFrame")
    await pg.wait_for_timeout(2000)
    m = await pg.evaluate("window.__m")
    load = summarize(m["frames"], m["longtasks"], m["shifts"], 0, first + 2000)
    load["first_shelf_ms"] = round(first)
    out["loading"] = load

    stage = await pg.query_selector("#stage"); box = await stage.bounding_box()
    await pg.evaluate("document.getElementById('stage').scrollIntoView({block:'center'})"); await pg.wait_for_timeout(600)
    box = await stage.bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] * 0.42

    out["idle spin"] = await window(pg, 3000)
    if not prof["touch"]:
        async def hover():
            await pg.mouse.move(box["x"] + 40, cy)
            for i in range(40):
                await pg.mouse.move(box["x"] + 40 + (box["width"] - 80) * i / 39, cy + (8 if i % 2 else -8))
                await pg.wait_for_timeout(70)
        out["hovering"] = await window(pg, 600, hover)
        await pg.mouse.move(box["x"] + box["width"] / 2, box["y"] - 30)
    else:
        async def swipe():
            pts = [(box["x"] + box["width"] * 0.8 - i * box["width"] * 0.6 / 20, cy) for i in range(21)]
            await cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": pts[0][0], "y": pts[0][1]}]})
            for x, y in pts[1:]:
                await cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y}]}); await pg.wait_for_timeout(30)
            await cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        out["swiping the shelf"] = await window(pg, 1200, swipe)

    sci = 'button[data-topic="Science, Biology and Medicine"]'
    out["switching topic (fall)"] = await window(pg, 5000, lambda: pg.click(sci))
    out["switching back (rise)"] = await window(pg, 6000, lambda: pg.click('button[data-topic=""]'))
    await pg.wait_for_timeout(1500)

    async def open_book():
        await pg.focus("#stage"); await pg.keyboard.press("Enter")
    out["opening a book"] = await window(pg, 4000, open_book)
    out["shelving it"] = await window(pg, 3000, lambda: pg.keyboard.press("Escape"))

    async def scroll():
        for _ in range(12):
            await pg.mouse.wheel(0, 90) if not prof["touch"] else await pg.evaluate("window.scrollBy(0, 90)")
            await pg.wait_for_timeout(60)
        for _ in range(12):
            await pg.mouse.wheel(0, -90) if not prof["touch"] else await pg.evaluate("window.scrollBy(0, -90)")
            await pg.wait_for_timeout(60)
    out["scrolling the page"] = await window(pg, 500, scroll)
    m = await pg.evaluate("window.__m")
    out["whole session"] = dict(cls=round(sum(x[1] for x in m["shifts"]), 4), page_errors=len(errors))
    await b.close()
    return out

async def main(url, outpath, label, only=None):
    res = {"label": label, "profiles": {}}
    async with async_playwright() as p:
        for name, prof in PROFILES.items():
            if only and name != only: continue
            res["profiles"][name] = await run_profile(p, url, name, prof)
            print(name, json.dumps(res["profiles"][name]), flush=True)
    json.dump(res, open(outpath, "w"), indent=1)

if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "", sys.argv[4] if len(sys.argv) > 4 else None))
