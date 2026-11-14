#!/usr/bin/env python3
"""Independent verification for token-radar-01 v3 (LOCAL ONLY).

Re-implements the model from scratch in Python (no shared code with
app.js) and checks:
  1. every published implied value == the Python recompute (exact),
  2. board.json passes the competition gate's board rules,
  3. farm steps are 3-12 strings of 20-600 chars,
  4. the dashboard source fits the 65,536-byte dossier text budget,
  5. no http(s) address appears in any HTML attribute / CSS / JS import.
"""
import json, os, re, subprocess, sys
from datetime import date

V3 = os.path.expanduser("~/workspace/makefun/token-radar-01-v3")
KIT = os.path.expanduser("~/workspace/makefun/token-radar-01/kit/token-radar-01-kit")
ASOF = date(2026, 11, 14)

snap = json.load(open(os.path.join(KIT, "input/snapshot.json")))
prots = {p["slug"]: p for p in snap["protocols"]}
official_wl = set(snap["watchlist"])

# --- load data.js (strip the var assignment) ---
raw = open(os.path.join(V3, "dashboard/data.js")).read()
assert raw.startswith("var RADAR_DATA = ")
data = json.loads(raw[len("var RADAR_DATA = "):].rstrip().rstrip(";"))
rows = data["rows"]
print("data.js rows:", len(rows))

def clamp(x, lo, hi): return max(lo, min(hi, x))
def age_years(listed):
    if not listed: return 0.0
    y, m, d = map(int, listed.split("-"))
    return max(0.0, (ASOF - date(y, m, d)).days / 365.25)

def py_implied(r):
    tvl, chg, listed = r[4], r[5], r[7]
    gf = 1.0 if chg is None else 1 + clamp(chg, -50, 100) / 100.0
    mf = 0.75 + 0.25 * min(age_years(listed), 4) / 4.0
    return int(tvl * 0.20 * gf * mf)

fails = []
# 1. published implied == python recompute, pre-token rows only
pre = [r for r in rows if r[10] == "pre"]
live = [r for r in rows if r[10] == "live"]
for r in pre:
    if py_implied(r) != r[9]:
        fails.append(f"implied mismatch {r[0]}: py {py_implied(r)} vs published {r[9]}")
print("pre-token rows:", len(pre), "| live rows:", len(live))
print("published-implied mismatches:", len([f for f in fails if f.startswith('implied')]))
# live rows: mcap + symbol present, published null
for r in live:
    if r[6] is None or not r[8] or r[9] is not None:
        fails.append(f"live row bad {r[0]}")
print("live-row problems:", len([f for f in fails if f.startswith('live')]))
# watchlist coverage
wl_rows = [r for r in pre if r[11] == 1]
print("watchlist-flagged rows:", len(wl_rows))
if not official_wl <= {r[0] for r in pre}:
    fails.append("official watchlist NOT fully covered")
print("official 40 covered:", official_wl <= {r[0] for r in pre})

# 2. board.json gate rules
board = json.load(open(os.path.join(V3, "board.json")))
brows = board["rows"]
print("board.json rows:", len(brows))
if not (100 <= len(brows) <= 4000): fails.append("board row count out of range")
if [r["rank"] for r in brows] != list(range(1, len(brows) + 1)):
    fails.append("ranks are not exactly 1..N")
vals = [r["implied_value_usd"] for r in brows]
if any(vals[i] < vals[i + 1] for i in range(len(vals) - 1)):
    fails.append("implied values rise with rank")
if any(v <= 0 for v in vals): fails.append("non-positive implied value")
if len({r["slug"] for r in brows}) != len(brows): fails.append("duplicate slugs")
if any(r["slug"] not in prots for r in brows): fails.append("slug not in snapshot")
if not official_wl <= {r["slug"] for r in brows}: fails.append("watchlist missing from board")
# board implied == python recompute
for r in brows:
    drow = next(x for x in rows if x[0] == r["slug"])
    if py_implied(drow) != r["implied_value_usd"]:
        fails.append(f"board implied mismatch {r['slug']}")
print("board implied mismatches:", len([f for f in fails if f.startswith('board implied')]))
# farm steps (via app.js, through node)
driver = """
const m = require(process.argv[2]);
const rows = JSON.parse(require('fs').readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(rows.map(r => m.farmStepsFor(r))));
"""
open("/tmp/radar-v3-farm.js", "w").write(driver)
proc = subprocess.run(["node", "/tmp/radar-v3-farm.js",
                       os.path.join(V3, "dashboard/app.js")],
                      input=json.dumps(rows).encode(), capture_output=True, check=True)
steps = json.loads(proc.stdout.decode())
bad_steps = 0
for r, ss in zip(rows, steps):
    if not (3 <= len(ss) <= 12): bad_steps += 1
    for s in ss:
        if not (20 <= len(s.strip()) <= 600): bad_steps += 1
print("farm-step violations (all rows):", bad_steps)
if bad_steps: fails.append(f"{bad_steps} farm-step violations")
# board farm_steps match app.js output
for r in brows:
    idx = next(i for i, x in enumerate(rows) if x[0] == r["slug"])
    if steps[idx] != r["farm_steps"]: fails.append(f"board farm mismatch {r['slug']}")
print("board farm mismatches:", len([f for f in fails if f.startswith('board farm')]))

# 3. dossier budget
total = 0
for fn in ["index.html", "app.css", "app.js", "data.js"]:
    sz = os.path.getsize(os.path.join(V3, "dashboard", fn))
    total += sz
    print(f"  dashboard/{fn}: {sz} bytes")
print("dashboard total bytes:", total, "(budget 65536)")
if total > 65536: fails.append("dashboard source exceeds dossier text budget")

# 4. no http(s) addresses in attributes / css / js imports
for fn in ["index.html", "app.css", "app.js"]:
    txt = open(os.path.join(V3, "dashboard", fn)).read()
    hits = re.findall(r"https?://[^\s\"'<>]+", txt)
    print(f"  {fn}: http(s) occurrences: {len(hits)}")
    if hits: fails.append(f"{fn} contains http(s) address: {hits[:2]}")

print("\nRESULT:", "ALL CHECKS PASSED" if not fails else f"{len(fails)} FAILURES")
for f in fails: print("  FAIL:", f)
sys.exit(1 if fails else 0)
