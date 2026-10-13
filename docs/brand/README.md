# Weav logo

The mark is a "run" triangle woven from three threads: each thread tucks under the one before it and passes over the next. It reads as *run*, and the tucks make it a *weave*: trigger, action and result, woven into one flow that runs on its own.

## Files

| File | Use |
| --- | --- |
| `weav-symbol.svg` | Master symbol, brand blue. App header, docs, slides. |
| `weav-symbol-small.svg` | Small-size cut (wider gaps, heavier threads). Use below 48 px; source of the favicons. |
| `weav-horizontal.svg` / `-dark.svg` | Symbol + wordmark, for light / dark backgrounds. |
| `weav-horizontal-white.svg`, `-mono-2b5fd9.svg` | One-colour lockups (white on photos or brand blue; blue on white). |
| `weav-stacked.svg` | Square-ish spaces: splash screens, title slides. |
| `weav-wordmark.svg` | Wordmark alone, when the symbol already appears nearby. |
| `weav-black.svg`, `weav-white.svg` | One-colour symbol (print, embossing, dark photos). |
| `weav-app-icon.svg` | White symbol on a blue rounded tile (mobile app, avatars). |

Web icons (`favicon.ico`, `favicon.svg`, `apple-touch-icon.png`, `icon-192/512.png`, `maskable-512.png`, `site.webmanifest`) live in `apps/web/public/`.

## Colour

| Name | HEX | RGB | Use |
| --- | --- | --- | --- |
| Weav Blue | `#2B5FD9` | 43 95 217 | Symbol on light backgrounds; app-icon tile. Same as `--primary`. |
| Weav Blue (dark UI) | `#5B8CF0` | 91 140 240 | Symbol on dark backgrounds. |
| Ink | `#1C1917` | 28 25 23 | Wordmark on light. Same as `--foreground`. |
| Paper | `#EDEBE9` | 237 235 233 | Wordmark on dark. |

## Type

The wordmark is "weav" in **Geist** (SemiBold, weight 620, tracking -1.5 %), converted to outlines. Geist is the app's UI font, licensed under the SIL OFL, which permits logo use. Don't retype it; use the SVG.

## Rules

- **Clear space:** keep at least the width of one thread (about 1/5 of the symbol's height) free on every side.
- **Minimum size:** symbol 16 px (use the small cut below 48 px); horizontal lockup 80 px wide.
- **Backgrounds:** blue symbol on white or light neutrals; `#5B8CF0` or white on dark; white on the brand blue.
- **Don't:** rotate it (the triangle must point right), recolour the threads separately, add gradients or shadows, close the gaps between threads, or put the blue mark on a busy photo.

## Regenerating

The geometry is computed, not hand-drawn. `source/build.py` writes every master above:

```bash
uv run --no-project --with fonttools --with brotli python docs/brand/source/build.py apps/web/node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2
```

Trademark clearance has not been checked; run a search before registering the mark.
