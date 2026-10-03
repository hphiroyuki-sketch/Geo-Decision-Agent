# -*- coding: utf-8 -*-
"""Generate system-map.html (how the parts are wired) from data.js + geometry.

Run:  python3 docs/system-map/build.py
Geometry lives here so it can be checked: no edge may pass through a node it
does not connect, and every node in data.js must be drawn.
"""
import html, json, math, os, random, re

HERE = os.path.dirname(os.path.abspath(__file__))
e = html.escape
data_js = open(os.path.join(HERE, "data.js"), encoding="utf-8").read()
node_ids = re.findall(r"^ (\w+):\{t:", data_js, re.M)

# x, y, w, h, colour token
N = {
 "browser": (20, 200, 200, 110, 1), "tiles": (20, 440, 200, 96, 3), "dev": (20, 660, 200, 72, 7),
 "assets": (290, 70, 190, 74, 5), "cron": (290, 196, 190, 74, 5), "api": (540, 190, 190, 120, 5),
 "r2": (290, 350, 190, 74, 5), "d1": (540, 350, 190, 74, 5), "secrets": (290, 452, 440, 70, 5),
 "github": (290, 660, 190, 72, 7), "actions": (540, 660, 190, 72, 7),
 "anthropic": (830, 40, 390, 80, 6),
 "oauth": (836, 186, 160, 64, 4), "ee": (1044, 186, 160, 64, 4),
 "emb": (836, 280, 160, 64, 4), "s2": (1044, 280, 160, 64, 4),
 "gbif": (836, 420, 368, 52, 2), "gsi": (836, 480, 368, 52, 2), "osm": (836, 540, 368, 52, 2),
}
assert set(N) == set(node_ids), set(N) ^ set(node_ids)
GROUPS = [  # x, y, w, h, title, colour
 (262, 24, 476, 532, "Cloudflare（無料プラン）", 5),
 (816, 140, 408, 220, "Google Cloud", 4),
 (816, 384, 408, 222, "公的データ（無料・登録不要）", 2),
 (262, 636, 476, 112, "GitHub", 7),
]
# id, from, to, points, label, label (x, y), both-ways
E = [
 ("e1", "browser", "assets", [(170, 200), (170, 107), (290, 107)], "画面のファイル", (230, 107), False),
 ("e2", "browser", "api", [(220, 300), (540, 300)], "質問 ⇄ 答え（SSE）", (380, 300), True),
 ("e3", "browser", "tiles", [(120, 310), (120, 440)], "地図画像は直接", (120, 375), False),
 ("e4", "cron", "api", [(480, 233), (540, 233)], "起動", (510, 233), False),
 ("e5", "api", "d1", [(635, 310), (635, 350)], "SQL", (635, 330), False),
 ("e6", "api", "r2", [(570, 310), (570, 330), (385, 330), (385, 350)], "写真", (478, 330), False),
 ("e7", "api", "anthropic", [(730, 205), (790, 205), (790, 80), (830, 80)], "相談", (790, 142), False),
 ("e8", "api", "oauth", [(730, 236), (836, 236)], "鍵で署名", (783, 236), False),
 ("e9", "oauth", "ee", [(996, 218), (1044, 218)], "通行証", (1020, 205), False),
 ("e10", "ee", "emb", [(1080, 250), (1080, 265), (916, 265), (916, 280)], "読む", (998, 265), False),
 ("e11", "ee", "s2", [(1150, 250), (1150, 280)], "読む", (1150, 265), False),
 ("e12", "api", "gbif", [(730, 290), (790, 290), (790, 495), (836, 495)], "照会", (790, 400), False),
 ("e13", "dev", "github", [(220, 696), (290, 696)], "push", (255, 696), False),
 ("e14", "github", "actions", [(480, 696), (540, 696)], "起動", (510, 696), False),
 ("e15", "actions", "secrets", [(690, 660), (690, 522)], "鍵を登録", (690, 600), False),
 ("e16", "actions", "assets", [(580, 660), (580, 556)], "配信・DB更新", (580, 608), False),
]
for eid, a, b, pts, *_ in E:
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        sx1, sx2, sy1, sy2 = min(x1, x2), max(x1, x2), min(y1, y2), max(y1, y2)
        for nid, (x, y, w, h, _) in N.items():
            if nid in (a, b) or (eid == "e12" and nid in ("gsi", "osm")): continue
            assert not (sx1 < x + w - 1 and x + 1 < sx2 and sy1 < y + h - 1 and y + 1 < sy2), f"{eid} crosses {nid}"

def arrow(p, q):
    (x1, y1), (x2, y2) = p, q
    dx, dy = x2 - x1, y2 - y1
    n = math.hypot(dx, dy) or 1
    ux, uy = dx / n, dy / n
    s = 7
    pts = [(x2, y2), (x2 - ux * s * 1.6 - uy * s * .7, y2 - uy * s * 1.6 + ux * s * .7),
           (x2 - ux * s * 1.6 + uy * s * .7, y2 - uy * s * 1.6 - ux * s * .7)]
    return '<polygon class="ah" points="' + " ".join(f"{a:.1f},{b:.1f}" for a, b in pts) + '"/>'

svg = []
for x, y, w, h, title, c in GROUPS:
    svg.append(f'<g class="grp k{c}"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="16"/></g>')
for eid, a, b, pts, label, (lx, ly), both in E:
    lw = len(label) * 12.5 + 12 if not label.isascii() else len(label) * 8 + 14
    s = f'<g class="edge" id="{eid}" data-a="{a}" data-b="{b}"><polyline points="{" ".join(f"{x},{y}" for x, y in pts)}"/>'
    s += arrow(pts[-2], pts[-1]) + (arrow(pts[1], pts[0]) if both else "")
    s += f'<rect class="pill" x="{lx - lw / 2:.0f}" y="{ly - 9}" width="{lw:.0f}" height="18" rx="9"/><text class="el" x="{lx}" y="{ly + 4}" text-anchor="middle">{e(label)}</text></g>'
    svg.append(s)
for x, y, w, h, title, c in GROUPS:
    svg.append(f'<g class="grp k{c}"><text x="{x + 14}" y="{y + 22}">{e(title)}</text></g>')
titles = {m[0]: (m[1], m[2]) for m in re.findall(r"^ (\w+):\{t:\"([^\"]+)\",s:\"([^\"]+)\"", data_js, re.M)}
for nid, (x, y, w, h, c) in N.items():
    t, sub = titles[nid]
    svg.append(f'<g class="node k{c}" data-n="{nid}" tabindex="0" role="button" aria-label="{e(t)}の説明を開く">'
               f'<rect class="bg" x="{x}" y="{y}" width="{w}" height="{h}" rx="10"/>'
               f'<rect class="bar" x="{x}" y="{y}" width="7" height="{h}" rx="3"/>'
               f'<text class="nt" x="{x + 18}" y="{y + h / 2 - 3:.0f}">{e(t)}</text>'
               f'<text class="ns" x="{x + 18}" y="{y + h / 2 + 16:.0f}">{e(sub)}</text></g>')

# ---- the embedding explainer: two 64-number fingerprints (illustrative) ----
rnd = random.Random(7)
a = [rnd.gauss(0, 1) for _ in range(64)]
b = [v + rnd.gauss(0, 0.45) for v in a]
def unit(v): n = math.sqrt(sum(x * x for x in v)); return [x / n for x in v]
a, b = unit(a), unit(b)
cos = sum(x * y for x, y in zip(a, b))
def bars(v, y0, cls):
    out = []
    for i, x in enumerate(v):
        hgt = abs(x) * 160
        top = y0 - hgt if x >= 0 else y0
        out.append(f'<rect class="{cls}" x="{250 + i * 6}" y="{top:.1f}" width="4.4" height="{max(hgt, .8):.1f}"/>')
    return "".join(out)
emb = (bars(a, 80, "ba") + bars(b, 200, "bb"))
G0 = 0.4  # the gauge starts at 0.4 so the 0.70 / 0.85 bands are readable
gx = lambda s: 700 + (max(s, G0) - G0) / (1 - G0) * 270
gauge = (f'<rect class="g0" x="{gx(0)}" y="120" width="{gx(.70) - gx(0):.1f}" height="22"/>'
         f'<rect class="g1" x="{gx(.70):.1f}" y="120" width="{gx(.85) - gx(.70):.1f}" height="22"/>'
         f'<rect class="g2" x="{gx(.85):.1f}" y="120" width="{gx(1) - gx(.85):.1f}" height="22"/>'
         f'<line class="tick" x1="{gx(.70):.1f}" y1="114" x2="{gx(.70):.1f}" y2="148"/><text class="gt" x="{gx(.70):.1f}" y="162" text-anchor="middle">0.70</text>'
         f'<line class="tick" x1="{gx(.85):.1f}" y1="114" x2="{gx(.85):.1f}" y2="148"/><text class="gt" x="{gx(.85):.1f}" y="162" text-anchor="middle">0.85</text>'
         f'<text class="gt" x="{gx(G0):.1f}" y="162" text-anchor="middle">0.4</text><text class="gt" x="{gx(1):.1f}" y="162" text-anchor="middle">1.0</text>'
         f'<text class="gl" x="{(gx(0) + gx(.70)) / 2:.0f}" y="135" text-anchor="middle">ふつう</text>'
         f'<text class="gl" x="{(gx(.70) + gx(.85)) / 2:.0f}" y="135" text-anchor="middle">類似</text>'
         f'<text class="gl" x="{(gx(.85) + gx(1)) / 2:.0f}" y="135" text-anchor="middle">優先度A</text>'
         f'<polygon class="mk" points="{gx(cos):.1f},116 {gx(cos) - 7:.1f},104 {gx(cos) + 7:.1f},104"/>'
         f'<text class="gv" x="{gx(cos):.1f}" y="98" text-anchor="middle">{cos:.2f}</text>')

tpl = open(os.path.join(HERE, "template.html"), encoding="utf-8").read()
tokens = open(os.path.join(HERE, "_tokens.css"), encoding="utf-8").read()
out = (tpl.replace("__TOKENS__", tokens).replace("__SVG__", "\n".join(svg))
          .replace("__EMB__", emb).replace("__GAUGE__", gauge).replace("__COS__", f"{cos:.2f}")
          .replace("__DATA__", data_js.replace("</", "<\\/")))
open(os.path.join(HERE, "system-map.html"), "w", encoding="utf-8").write(out)
print("wrote system-map.html", len(out) // 1024, "KB; nodes", len(N), "edges", len(E), "illustrative cos", round(cos, 3))
