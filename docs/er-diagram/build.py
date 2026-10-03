# -*- coding: utf-8 -*-
"""Generate er-diagram.html from the real migrations + content.py.

Run:  python3 docs/er-diagram/build.py
Everything structural (tables, columns, types, FKs, counts) comes from
schema_parse.parse(); content.py only adds human wording and is checked
against the schema, so the picture cannot show a column that does not exist.
"""
import glob, html, json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import schema_parse, content

HERE = os.path.dirname(os.path.abspath(__file__))
S = schema_parse.parse()
T, STEPS, RELS = content.T, content.STEPS, content.RELS

# ---- integrity checks -------------------------------------------------------
assert set(S) == set(T), (set(S) ^ set(T))
for tid, a in T.items():
    names = {c["name"] for c in S[tid]["cols"]}
    for col in list(a["cols"]) + list(a["logical"]):
        assert col in names, f"{tid}.{col} is not in the schema"
fk_pairs = {(c["fk"], t) for t in S for c in S[t]["cols"] if c["fk"]}
for p, c, kind, _ in RELS:
    if kind == "fk":
        assert (p, c) in fk_pairs, f"drawn as FK but not declared: {p} -> {c}"
n_cols = sum(len(v["cols"]) for v in S.values())
n_fk = sum(1 for t in S for c in S[t]["cols"] if c["fk"])

# ---- layout -----------------------------------------------------------------
W, H = 184, 60
A, B, C, D, E, F, G = 20, 272, 546, 842, 1126, 1394, 1662
# Each step occupies one contiguous zone so the story reads at a glance:
# ① top-left, ⑥ across the top, ②③ in the middle row, ④⑤ below, ⑦ bottom-left.
POS = {
 "sessions": (A, 80), "invites": (A, 190), "users": (B, 190), "usage_log": (A, 300),
 "messages": (C, 80), "conversations": (C, 190), "analyses": (D, 190),
 "site_candidates": (E, 80), "mitigation_measures": (F, 80),
 "decision_reports": (E, 190), "report_reviewers": (F, 190),
 "projects": (D, 360), "field_records": (E, 360),
 "meshes": (D, 490), "mesh_cells": (E, 490),
 "public_data_cache": (D, 680), "embedding_cache": (C, 680), "indices_cache": (E, 680),
 "mesh_hotspots": (F, 490), "recovery_actions": (G, 490),
 "audit_events": (A, 580), "alerts": (B, 580),
 "system_checks": (A, 670), "alert_rules": (B, 670), "settings": (A, 760),
}
assert set(POS) == set(T)
VB_W, VB_H = G + W + 24, 846

def L(t, dy=0): x, y = POS[t]; return (x, y + H // 2 + dy)
def R(t, dy=0): x, y = POS[t]; return (x + W, y + H // 2 + dy)
def Tp(t, dx=0): x, y = POS[t]; return (x + W // 2 + dx, y)
def Bt(t, dx=0): x, y = POS[t]; return (x + W // 2 + dx, y + H)

# (parent, child) -> (points, segment index for the label, position along it)
P = {}
def route(p, c, pts, seg=-1, at=0.5): P[(p, c)] = (pts, seg, at)

# ① people
route("users", "sessions", [Tp("users"), (Tp("users")[0], L("sessions")[1]), R("sessions")], 1)
route("users", "invites", [L("users"), R("invites")], 0)
ul = Bt("users", -30)
route("users", "usage_log", [ul, (ul[0], L("usage_log")[1]), R("usage_log")], 1)
route("users", "conversations", [R("users"), L("conversations")], 0)
ur = Bt("users", 30)
route("users", "projects", [ur, (ur[0], L("projects", -14)[1]), L("projects", -14)], 1, 0.42)
# ② the case at the centre
pt = Tp("projects", -50)
route("projects", "conversations", [pt, (pt[0], 300), (Bt("conversations")[0], 300), Bt("conversations")], 1)
route("projects", "analyses", [Tp("projects"), Bt("analyses")], 0)
tx = E - 70
for ch in ("site_candidates", "decision_reports"):
    route("projects", ch, [R("projects", -14), (tx, R("projects", -14)[1]), (tx, L(ch)[1]), L(ch)], 2)
route("projects", "field_records", [R("projects", 8), L("field_records", 8)], 0)
route("projects", "meshes", [Bt("projects"), Tp("meshes")], 0)
pa = L("projects", 16)
route("projects", "alerts", [pa, (C - 46, pa[1]), (C - 46, R("alerts")[1]), R("alerts")], 0, 0.3)
# ⑥ deciding with AI
route("conversations", "messages", [Tp("conversations"), Bt("messages")], 0)
route("conversations", "analyses", [R("conversations"), L("analyses")], 0)
route("site_candidates", "mitigation_measures", [R("site_candidates"), L("mitigation_measures")], 0)
route("decision_reports", "report_reviewers", [R("decision_reports"), L("report_reviewers")], 0)
# ④⑤ measuring from space, then acting on it
route("meshes", "mesh_cells", [R("meshes"), L("mesh_cells")], 0)
mh = Bt("meshes", 60)
route("meshes", "mesh_hotspots", [mh, (mh[0], 590), (Bt("mesh_hotspots")[0], 590), Bt("mesh_hotspots")], 1, 0.62)
route("mesh_cells", "mesh_hotspots", [R("mesh_cells"), L("mesh_hotspots")], 0)
route("mesh_hotspots", "recovery_actions", [R("mesh_hotspots"), L("recovery_actions")], 0)
mb = Bt("meshes")
route("meshes", "public_data_cache", [mb, Tp("public_data_cache")], 0, 0.82)
route("meshes", "embedding_cache", [mb, (mb[0], 640), (Tp("embedding_cache")[0], 640), Tp("embedding_cache")], 1, 0.5)
route("meshes", "indices_cache", [mb, (mb[0], 640), (Tp("indices_cache")[0], 640), Tp("indices_cache")], 1, 0.5)

# Zones: one rectangle per step, bounding its tables. Checked below so a zone
# never swallows another step's table and zones never overlap.
ZP, ZH = 16, 30
ZONES = {}
for st in STEPS:
    ids = [t for t in T if T[t]["step"] == st["n"]]
    x1 = min(POS[t][0] for t in ids) - ZP; y1 = min(POS[t][1] for t in ids) - ZH
    x2 = max(POS[t][0] for t in ids) + W + ZP; y2 = max(POS[t][1] for t in ids) + H + ZP
    ZONES[st["n"]] = (x1, y1, x2, y2)
def _ov(a, b): return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]
for n, z in ZONES.items():
    for m, z2 in ZONES.items():
        assert n == m or not _ov(z, z2), f"zones {n} and {m} overlap"
    for t in T:
        x, y = POS[t]
        if T[t]["step"] != n: assert not _ov(z, (x, y, x + W, y + H)), f"zone {n} covers {t}"

# No line may pass through a table it does not connect.
for (p, c), (pts, _, _) in P.items():
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        sx1, sx2, sy1, sy2 = min(x1, x2), max(x1, x2), min(y1, y2), max(y1, y2)
        for t in T:
            if t in (p, c): continue
            x, y = POS[t]
            assert not (sx1 < x + W and x < sx2 + 1 and sy1 < y + H and y < sy2 + 1), f"{p}->{c} crosses {t}"

for p, c, kind, label in RELS:
    assert (p, c) in P, f"no route for {p}->{c}"

def pts_str(pts): return " ".join(f"{x},{y}" for x, y in pts)

def label_xy(pts, seg, at):
    seg = seg if seg >= 0 else len(pts) + seg - 1
    (x1, y1), (x2, y2) = pts[seg], pts[seg + 1]
    return x1 + (x2 - x1) * at, y1 + (y2 - y1) * at

def arrow(pts):
    (x1, y1), (x2, y2) = pts[-2], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    n = max(abs(dx), abs(dy)) or 1
    ux, uy = dx / n, dy / n
    px, py = -uy, ux
    s = 7
    a = (x2, y2)
    b = (x2 - ux * s * 1.6 + px * s * .7, y2 - uy * s * 1.6 + py * s * .7)
    c = (x2 - ux * s * 1.6 - px * s * .7, y2 - uy * s * 1.6 - py * s * .7)
    return f"{a[0]:.1f},{a[1]:.1f} {b[0]:.1f},{b[1]:.1f} {c[0]:.1f},{c[1]:.1f}"

def end_tag(pts, at_start, txt):
    # "1" near the parent end, "N" near the child end, set beside the line
    if at_start: (x1, y1), (x2, y2) = pts[0], pts[1]
    else: (x1, y1), (x2, y2) = pts[-1], pts[-2]
    dx, dy = x2 - x1, y2 - y1
    n = max(abs(dx), abs(dy)) or 1
    ux, uy = dx / n, dy / n
    x = x1 + ux * 13 - uy * 9
    y = y1 + uy * 13 + ux * 9 + 4
    if not at_start:  # keep clear of the arrowhead
        x = x1 + ux * 17 - uy * 10
        y = y1 + uy * 17 + ux * 10 + 4
    return f'<text class="crd" x="{x:.0f}" y="{y:.0f}" text-anchor="middle">{txt}</text>'

e = html.escape
svg = []
for n, (x1, y1, x2, y2) in ZONES.items():
    st = STEPS[n - 1]
    svg.append(f'<g class="zone z{n}" data-step="{n}"><rect x="{x1}" y="{y1}" width="{x2 - x1}" height="{y2 - y1}" rx="16"/></g>')
for p, c, kind, label in RELS:
    pts, seg, at = P[(p, c)]
    lx, ly = label_xy(pts, seg, at)
    lw = len(label) * 13 + 12
    (sx1, sy1), (sx2, sy2) = pts[seg if seg >= 0 else len(pts) + seg - 1], pts[(seg if seg >= 0 else len(pts) + seg - 1) + 1]
    if sy1 == sy2: assert abs(sx2 - sx1) >= lw + 6, f'label too wide for its segment: {p}->{c} {label} {lw} > {abs(sx2 - sx1)}'
    svg.append(
        f'<g class="rel {kind}" data-from="{p}" data-to="{c}">'
        f'<polyline points="{pts_str(pts)}"/><polygon class="ah" points="{arrow(pts)}"/>'
        + end_tag(pts, True, "1") + end_tag(pts, False, "N")
        + f'<rect class="pill" x="{lx - lw / 2:.0f}" y="{ly - 9:.0f}" width="{lw:.0f}" height="18" rx="9"/>'
        f'<text class="rl" x="{lx:.0f}" y="{ly + 4:.0f}" text-anchor="middle">{e(label)}</text></g>')
# zone titles go above the lines so a line never strikes through them
for n, (x1, y1, x2, y2) in ZONES.items():
    svg.append(f'<g class="zone z{n}" data-step="{n}"><text x="{x1 + 14}" y="{y1 + 21}">{n}　{e(STEPS[n - 1]["title"])}</text></g>')
for tid, a in T.items():
    x, y = POS[tid]
    ncol = len(S[tid]["cols"])
    svg.append(
        f'<g class="tbl s{a["step"]}" data-t="{tid}" data-step="{a["step"]}" tabindex="0" role="button" '
        f'aria-label="{e(a["jp"])}（{tid}）の詳細を開く">'
        f'<title>{e(a["jp"])}：{e(a["plain"])}</title>'
        f'<rect class="bg" x="{x}" y="{y}" width="{W}" height="{H}" rx="9"/>'
        f'<rect class="bar" x="{x}" y="{y}" width="7" height="{H}" rx="3"/>'
        f'<circle class="badge" cx="{x + W - 14}" cy="{y + 14}" r="8"/>'
        f'<text class="bn" x="{x + W - 14}" y="{y + 18}" text-anchor="middle">{a["step"]}</text>'
        f'<text class="tj" x="{x + 18}" y="{y + 27}">{e(a["jp"])}</text>'
        f'<text class="te" x="{x + 18}" y="{y + 46}">{tid}</text>'
        f'<text class="tc" x="{x + W - 12}" y="{y + 55}" text-anchor="end">{ncol}列</text></g>')

# ---- data for the detail panel ---------------------------------------------
refs_out, refs_in = {}, {}
for t in S:
    for c in S[t]["cols"]:
        if c["fk"]:
            refs_out.setdefault(t, []).append([c["name"], c["fk"]])
            refs_in.setdefault(c["fk"], []).append([t, c["name"]])
data = {"steps": STEPS, "tables": {}}
for tid, a in T.items():
    cols = S[tid]["cols"]
    key = [{"n": c["name"], "ty": c["type"], "pk": c["pk"], "uq": c["unique"], "fk": c["fk"],
            "m": a["cols"][c["name"]], "lg": a["logical"].get(c["name"])}
           for c in cols if c["name"] in a["cols"]]
    rest = [c["name"] for c in cols if c["name"] not in a["cols"]]
    data["tables"][tid] = {"id": tid, "step": a["step"], "jp": a["jp"], "plain": a["plain"],
        "expert": a["expert"], "why": a["why"], "ex": a["example"], "ncol": len(cols),
        "key": key, "rest": rest, "out": refs_out.get(tid, []), "in": refs_in.get(tid, []),
        "mig": S[tid]["migration"]}
data["rels"] = [{"p": p, "c": c, "k": k, "l": l} for p, c, k, l in RELS]

# FKs not drawn: say exactly what they are
drawn = {(p, c) for p, c, k, _ in RELS if k == "fk"}
und = [(t, c["name"], c["fk"]) for t in S for c in S[t]["cols"] if c["fk"] and (c["fk"], t) not in drawn]
und_user = [u for u in und if u[2] == "users"]
und_other = [u for u in und if u[2] != "users"]
n_drawn = n_fk - len(und)
note = (f"宣言された外部キー {n_fk} 本のうち {n_drawn} 本を線で描きました。"
        f"残り {len(und)} 本のうち {len(und_user)} 本は「誰が」を表す列（"
        + "・".join(sorted({f'{t}.{c}' for t, c, _ in und_user})) + "）で、すべて users を指します。線が重なって読めなくなるため省いています。")
if und_other:
    note += (" ほかに " + "、".join(f"{t}.{c} → {r}" for t, c, r in und_other)
             + " があります（recovery_actions の2本は重要エリア経由でも辿れる近道、analyses.replay_of は同じ表の中での再実行の連鎖）。")
assert all(((t == "analyses" and c == "replay_of") or (t == "recovery_actions" and c in ("project_id", "mesh_id"))) for t, c, _ in und_other), und_other

stats = {"tables": len(S), "cols": n_cols, "fks": n_fk, "migs": len(glob.glob(os.path.join(HERE, "..", "..", "migrations", "*.sql")))}
tpl = open(os.path.join(HERE, "template.html"), encoding="utf-8").read()
out = (tpl.replace("__SVG__", "\n".join(svg))
          .replace("__VBW__", str(VB_W)).replace("__VBH__", str(VB_H))
          .replace("__NOTE__", e(note))
          .replace("__S_TABLES__", str(stats["tables"])).replace("__S_COLS__", str(stats["cols"]))
          .replace("__S_FKS__", str(stats["fks"])).replace("__S_MIGS__", str(stats["migs"]))
          .replace("__DATA__", json.dumps(data, ensure_ascii=False).replace("</", "<\\/")))
open(os.path.join(HERE, "er-diagram.html"), "w", encoding="utf-8").write(out)
print("wrote er-diagram.html", len(out) // 1024, "KB;", stats, "undrawn:", len(und))
