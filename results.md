# Interesting Reads — smoothness, before and after

Measured 31 Oct 2026 in headless Chrome. The build machine has no graphics card, so 3D is drawn in software (SwiftShader).
Absolute frame rates are therefore far below a real laptop or phone; compare before with after on the same profile.

Profiles: **laptop** 1440×900; **old laptop** 1366×768 with the CPU slowed 4×; **phone** 390×844 at 2× pixel density, touch, CPU slowed 2×.

Columns: frames per second during the interaction · worst single frame · main-thread time blocked by long tasks · layout shift (CLS; 0 means nothing on the page jumped).

## Laptop

| Interaction | fps before → after | worst frame (ms) | blocked main thread (ms) | layout shift |
|---|---|---|---|---|
| loading | 3.0 → **4.0** | 850 → 1417 | 999 → **1043** | 0.0324 → 0 |
| idle spin | 3.2 → **7.1** | 367 → 283 | 0 → **0** | 0 → 0 |
| hovering | 5.5 → **11.4** | 467 → 467 | 76 → **0** | 0 → 0 |
| switching topic (fall) | 3.6 → **9.8** | 400 → 233 | 88 → **0** | 0 → 0 |
| switching back (rise) | 5.1 → **9.0** | 300 → 250 | 0 → **0** | 0 → 0 |
| opening a book | 3.8 → **6.2** | 350 → 317 | 0 → **0** | 0 → 0 |
| shelving it | 3.5 → **6.1** | 317 → 350 | 0 → **0** | 0 → 0 |
| scrolling the page | 6.1 → **6.9** | 883 → 383 | 328 → **0** | 0 → 0 |
| first shelf on screen | 1454 ms → 2397 ms | | | |

## Old laptop

| Interaction | fps before → after | worst frame (ms) | blocked main thread (ms) | layout shift |
|---|---|---|---|---|
| loading | 1.0 → **5.7** | 3416 → 1867 | 3591 → **1036** | 0.0335 → 0 |
| idle spin | 2.7 → **5.7** | 383 → 333 | 95 → **0** | 0 → 0 |
| hovering | 8.4 → **14.6** | 467 → 367 | 212 → **0** | 0 → 0 |
| switching topic (fall) | 2.6 → **7.5** | 417 → 317 | 769 → **214** | 0 → 0 |
| switching back (rise) | 3.5 → **7.9** | 400 → 317 | 325 → **5** | 0 → 0 |
| opening a book | 4.0 → **5.3** | 333 → 333 | 18 → **50** | 0 → 0 |
| shelving it | 3.2 → **5.8** | 433 → 217 | 16 → **0** | 0 → 0 |
| scrolling the page | 2.4 → **6.2** | 783 → 350 | 1297 → **0** | 0 → 0 |
| first shelf on screen | 4158 ms → 3959 ms | | | |

## Phone

| Interaction | fps before → after | worst frame (ms) | blocked main thread (ms) | layout shift |
|---|---|---|---|---|
| loading | 6.3 → **9.8** | 850 → 1750 | 664 → **762** | 0.0244 → 0 |
| idle spin | 4.9 → **18.8** | 233 → 133 | 0 → **0** | 0 → 0 |
| swiping the shelf | 7.8 → **27.7** | 267 → 100 | 0 → **0** | 0 → 0 |
| switching topic (fall) | 4.9 → **20.3** | 433 → 133 | 0 → **30** | 0 → 0 |
| switching back (rise) | 6.0 → **18.8** | 333 → 117 | 0 → **0** | 0 → 0 |
| opening a book | 5.1 → **33.4** | 367 → 167 | 0 → **0** | 0 → 0 |
| shelving it | 3.9 → **19.0** | 1000 → 150 | 946 → **0** | 0 → 0 |
| scrolling the page | 3.2 → **18.8** | 350 → 133 | 0 → **0** | 0 → 0 |
| first shelf on screen | 1358 ms → 3149 ms | | | |

## Same build forced to full resolution (code changes only)

Without a graphics card the page now draws at a lower resolution. These rows turn that off (`?fullres`) to show what the code changes did on their own.

| Profile | Interaction | fps before → after | blocked (ms) |
|---|---|---|---|
| laptop | idle spin | 3.2 → 3.8 | 0 → 0 |
| laptop | hovering | 5.5 → 7.8 | 76 → 0 |
| laptop | switching topic (fall) | 3.6 → 5.4 | 88 → 0 |
| laptop | switching back (rise) | 5.1 → 6.3 | 0 → 0 |
| laptop | opening a book | 3.8 → 3.5 | 0 → 0 |
| laptop | shelving it | 3.5 → 3.1 | 0 → 1 |
| laptop | scrolling the page | 6.1 → 3.7 | 328 → 0 |
| old laptop | idle spin | 2.7 → 3.0 | 95 → 0 |
| old laptop | hovering | 8.4 → 9.3 | 212 → 0 |
| old laptop | switching topic (fall) | 2.6 → 3.4 | 769 → 335 |
| old laptop | switching back (rise) | 3.5 → 5.5 | 325 → 0 |
| old laptop | opening a book | 4.0 → 3.5 | 18 → 0 |
| old laptop | shelving it | 3.2 → 3.0 | 16 → 0 |
| old laptop | scrolling the page | 2.4 → 17.2 | 1297 → 34 |
