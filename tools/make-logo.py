#!/usr/bin/env python3
# tools/make-logo.py: draws the GASFREE logo into home/: icon.svg (the mark: a knob drawn as a fuel
# gauge, E to F, turned all the way to F) and logo.svg (the mark and the wordmark). The letters are
# strokes, not text, so the logo looks the same without the web fonts. Run it after changing it.
import math, os
HOME = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "home")
INK, RED, DIM, BG, EDGE = "#ece8df", "#e2574c", "#8d8a83", "#151514", "#2c2c2a"
# the letters: strokes on a 20 x 36 cell
GLYPHS = { "G": "M18 4H2V32H18V18H10", "A": "M2 32V4H18V32M2 18H18", "S": "M18 4H2V18H18V32H2",
	"F": "M18 4H2V32M2 18H14", "R": "M2 32V4H18V18H2M12 21L18 32", "E": "M18 4H2V32H18M2 18H14" }
DEFS = ('<defs><radialGradient id="knob" cx="0.38" cy="0.32" r="0.75"><stop offset="0" stop-color="#4a4a47"/>'
	'<stop offset="0.6" stop-color="#1f1f1d"/><stop offset="1" stop-color="#0b0b0a"/></radialGradient></defs>')

def mark():
	cx, cy, out = 32, 29, []
	out.append('<rect x="1" y="1" width="62" height="62" rx="14" fill="%s" stroke="%s" stroke-width="2"/>' % (BG, EDGE))
	for i in range(9): # the scale, 135 to 405 degrees; the last two marks (near F) red
		a = math.radians(135 + i * 270 / 8)
		r0, r1 = (18.5, 24) if i in (0, 8) else (20, 24)
		out.append('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="%s" stroke-width="%g" stroke-linecap="round"/>' % (
			cx + math.cos(a) * r0, cy + math.sin(a) * r0, cx + math.cos(a) * r1, cy + math.sin(a) * r1,
			RED if i >= 7 else DIM, 2.4 if i in (0, 8) else 1.8))
	out.append('<circle cx="%g" cy="%g" r="14" fill="url(#knob)" stroke="#000" stroke-opacity="0.6"/>' % (cx, cy))
	a = math.radians(45) # turned to F
	out.append('<line x1="%g" y1="%g" x2="%.2f" y2="%.2f" stroke="%s" stroke-width="3.6" stroke-linecap="round"/>' % (
		cx, cy, cx + math.cos(a) * 12, cy + math.sin(a) * 12, RED))
	for ch, x, col in (("E", 11, DIM), ("F", 47, RED)): # under the ends of the scale
		out.append('<path d="%s" transform="translate(%g 49) scale(0.3)" fill="none" stroke="%s" stroke-width="6"/>' % (GLYPHS[ch], x, col))
	return out

def word(ox, oy):
	out, x = [], 0
	for i, ch in enumerate("GASFREE"):
		if i == 3: x += 10 # GAS | FREE
		out.append('<path d="%s" transform="translate(%g %g)" fill="none" stroke="%s" stroke-width="5" stroke-linecap="square"/>' % (
			GLYPHS[ch], ox + x, oy, INK if i < 3 else RED))
		x += 27
	return out, ox + x - 7

def svg(w, parts):
	return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d 64" width="%d" height="64" role="img" aria-label="GASFREE">\n'
		'\t<title>GASFREE</title>\n\t%s\n\t%s\n</svg>\n') % (w, w, DEFS, "\n\t".join(parts))

open(os.path.join(HOME, "icon.svg"), "w").write(svg(64, mark()))
letters, right = word(84, 14)
open(os.path.join(HOME, "logo.svg"), "w").write(svg(math.ceil(right) + 4, mark() + letters))
print("home/icon.svg, home/logo.svg")
