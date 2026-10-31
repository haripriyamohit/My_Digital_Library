import json
b=json.load(open('before.json'))['profiles']; a=json.load(open('after.json'))['profiles']
f={'laptop':json.load(open('after_full_laptop.json'))['profiles']['laptop'],'old laptop':json.load(open('after_full_old.json'))['profiles']['old laptop']}
out=["# Interesting Reads — smoothness, before and after","",
"Measured 31 Oct 2026 in headless Chrome. The build machine has no graphics card, so 3D is drawn in software (SwiftShader).",
"Absolute frame rates are therefore far below a real laptop or phone; compare before with after on the same profile.","",
"Profiles: **laptop** 1440×900; **old laptop** 1366×768 with the CPU slowed 4×; **phone** 390×844 at 2× pixel density, touch, CPU slowed 2×.","",
"Columns: frames per second during the interaction · worst single frame · main-thread time blocked by long tasks · layout shift (CLS; 0 means nothing on the page jumped).",""]
for prof in b:
    out += [f"## {prof.capitalize()}", "", "| Interaction | fps before → after | worst frame (ms) | blocked main thread (ms) | layout shift |", "|---|---|---|---|---|"]
    for k in b[prof]:
        if k=='whole session' or k not in a[prof]: continue
        x=b[prof][k]; y=a[prof][k]
        out.append(f"| {k} | {x['fps']} → **{y['fps']}** | {x['worst_ms']:.0f} → {y['worst_ms']:.0f} | {x['blocked_ms']} → **{y['blocked_ms']}** | {x['cls']} → {y['cls']} |")
    out += [f"| first shelf on screen | {b[prof]['loading']['first_shelf_ms']} ms → {a[prof]['loading']['first_shelf_ms']} ms | | | |", ""]
out += ["## Same build forced to full resolution (code changes only)", "",
"Without a graphics card the page now draws at a lower resolution. These rows turn that off (`?fullres`) to show what the code changes did on their own.", "",
"| Profile | Interaction | fps before → after | blocked (ms) |", "|---|---|---|---|"]
for prof in f:
    for k in f[prof]:
        if k in ('whole session','loading'): continue
        out.append(f"| {prof} | {k} | {b[prof][k]['fps']} → {f[prof][k]['fps']} | {b[prof][k]['blocked_ms']} → {f[prof][k]['blocked_ms']} |")
open('results.md','w').write("\n".join(out)+"\n")
print("\n".join(out))
