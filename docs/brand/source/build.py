"""Build the Weav logo SVG masters into docs/brand/.

Usage (from the repo root):
  uv run --no-project --with fonttools --with brotli python docs/brand/source/build.py \
      apps/web/node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2

The PNG/ICO web icons in apps/web/public/ were rendered from weav-symbol-small.svg
(favicons) and weav-app-icon.svg; re-render them if the geometry changes.
"""
import math
import os
import sys

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

OUT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLUE, BLUE_DARK, INK, PAPER = "#2b5fd9", "#5b8cf0", "#1c1917", "#edebe9"
f = lambda v: f"{v:.2f}".rstrip("0").rstrip(".")


# ---------- geometry ----------
def isect(p, d, q, e):
    den = d[0] * e[1] - d[1] * e[0]
    t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den
    return (p[0] + t * d[0], p[1] + t * d[1])


def unit(a, b):
    d = (b[0] - a[0], b[1] - a[1]); L = math.hypot(*d)
    return (d[0] / L, d[1] / L)


def piece(a, b, r, start_cut=None):
    """Thread a->b of width 2r: round cap at b; at a a round cap, or flat along start_cut (point, dir)."""
    d = (b[0] - a[0], b[1] - a[1]); L = math.hypot(*d)
    n = (-d[1] / L * r, d[0] / L * r)
    aL, aR = (a[0] + n[0], a[1] + n[1]), (a[0] - n[0], a[1] - n[1])
    bL, bR = (b[0] + n[0], b[1] + n[1]), (b[0] - n[0], b[1] - n[1])
    if start_cut:
        aL, aR = isect(aL, d, *start_cut), isect(aR, d, *start_cut)
    arc = lambda p: f"A{f(r)} {f(r)} 0 0 0 {f(p[0])} {f(p[1])}"
    s = f"M{f(aL[0])} {f(aL[1])}L{f(bL[0])} {f(bL[1])}{arc(bR)}L{f(aR[0])} {f(aR[1])}"
    return s + ("Z" if start_cut else arc(aL) + "Z")


def tri(side, cx=128, cy=128):
    """Right-pointing equilateral triangle; bbox centred, nudged 4 units right (it looks left-heavy)."""
    h = side * math.sqrt(3) / 2
    gx = cx + 4 - h / 6
    return [(gx - h / 3, cy - side / 2), (gx - h / 3, cy + side / 2), (gx + 2 * h / 3, cy)]


def run_weave(P, w, gap, ext):
    """Thread i runs P[i]->P[i+1]; it tucks under thread i-1 at P[i] and passes over thread i+1."""
    r, out = w / 2, []
    for i in range(3):
        p, q, prev = P[i], P[(i + 1) % 3], P[i - 1]
        u, v = unit(p, q), unit(prev, p)
        nv = (-v[1], v[0])
        side = 1 if (q[0] - p[0]) * nv[0] + (q[1] - p[1]) * nv[1] > 0 else -1
        cut = ((p[0] + nv[0] * (r + gap) * side, p[1] + nv[1] * (r + gap) * side), v)
        out.append(piece(p, (q[0] + u[0] * ext, q[1] + u[1] * ext), r, start_cut=cut))
    return out


SYMBOL = run_weave(tri(156), 50, 9, 2)
SMALL = run_weave(tri(164), 54, 18, 2)       # wider gaps survive 16-32 px


def paths(ps, color):
    return "".join(f'<path d="{p}" fill="{color}"/>' for p in ps)


def doc(body, w, h):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:g} {h:g}" role="img">'
            f"<title>Weav</title>{body}</svg>\n")


def write(name, content):
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as fh:
        fh.write(content)


# ---------- wordmark ----------
def outline_word(font_path, text="weav", weight=620, tracking=-0.015):
    font = instantiateVariableFont(TTFont(font_path), {"wght": weight})
    gs, cmap, hmtx = font.getGlyphSet(), font.getBestCmap(), font["hmtx"]
    track = tracking * font["head"].unitsPerEm
    x, word, bp = 0.0, "", BoundsPen(gs)
    for ch in text:
        name = cmap[ord(ch)]
        pen = SVGPathPen(gs)
        gs[name].draw(TransformPen(pen, (1, 0, 0, -1, x, 0)))   # font y-up -> svg y-down
        gs[name].draw(TransformPen(bp, (1, 0, 0, 1, x, 0)))
        word += f'<path d="{pen.getCommands()}"/>'
        x += hmtx[name][0] + track
    return word, bp.bounds


def main(font_path):
    word, (x0, y0, x1, y1) = outline_word(font_path)
    wm_w, wm_h = x1 - x0, y1 - y0

    def wordmark(scale, tx, ty, color):
        return (f'<g fill="{color}" transform="translate({tx:.2f} {ty:.2f}) scale({scale:.5f}) '
                f'translate({-x0:.2f} {y1:.2f})">{word}</g>')

    write("weav-symbol.svg", doc(paths(SYMBOL, BLUE), 256, 256))
    write("weav-symbol-small.svg", doc(paths(SMALL, BLUE), 256, 256))
    write("weav-black.svg", doc(paths(SYMBOL, "#000"), 256, 256))
    write("weav-white.svg", doc(paths(SYMBOL, "#fff"), 256, 256))
    write("weav-app-icon.svg", doc(
        f'<rect width="256" height="256" rx="57.6" fill="{BLUE}"/>'
        f'<g transform="translate(36 36) scale(0.71875)">{paths(SMALL, "#fff")}</g>', 256, 256))
    write("weav-wordmark.svg", doc(wordmark(1, 0, 0, INK), round(wm_w, 2), round(wm_h, 2)))

    # symbol ink box on the 256 grid (measured with svg_audit)
    sx0, sy0, sx1, sy1 = 37.9, 24.1, 256 - 29.9, 256 - 23.0
    sw, sh = sx1 - sx0, sy1 - sy0

    # horizontal: x-height = 0.52 x symbol height, gap = 0.30 x symbol height
    k = 0.52 * sh / wm_h
    W = sw + 0.30 * sh + wm_w * k

    def horizontal(sym_color, word_color):
        return doc(f'<g transform="translate({-sx0:.2f} {-sy0:.2f})">{paths(SYMBOL, sym_color)}</g>'
                   + wordmark(k, sw + 0.30 * sh, (sh - wm_h * k) / 2, word_color),
                   round(W, 2), round(sh, 2))

    write("weav-horizontal.svg", horizontal(BLUE, INK))
    write("weav-horizontal-dark.svg", horizontal(BLUE_DARK, PAPER))
    write("weav-horizontal-white.svg", horizontal("#fff", "#fff"))
    write("weav-horizontal-mono-2b5fd9.svg", horizontal(BLUE, BLUE))

    # stacked: wordmark width = 1.15 x symbol width, gap = 0.22 x symbol height
    k2 = 1.15 * sw / wm_w
    W2, H2 = max(sw, wm_w * k2), sh * 1.22 + wm_h * k2
    write("weav-stacked.svg", doc(
        f'<g transform="translate({(W2 - sw) / 2 - sx0:.2f} {-sy0:.2f})">{paths(SYMBOL, BLUE)}</g>'
        + wordmark(k2, (W2 - wm_w * k2) / 2, sh * 1.22, INK), round(W2, 2), round(H2, 2)))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
