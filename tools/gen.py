#!/usr/bin/env python3
"""Build tool for token-radar-01 v3 (LOCAL ONLY, not part of the graded entry).

Reads the sealed kit snapshot, selects the board rows, and writes:
  - dashboard/data.js : raw snapshot fields + the published implied value
    (one column, computed by app.js itself, so the page can cross-check
    its live recompute against the published board value).
  - board.json        : gate-format board (pre-token rows only, ranks 1..N).

The valuation model and the farm-step templates live ONLY in
dashboard/app.js. This script calls app.js through Node so the numbers
it publishes can never drift from what the page computes live.
An independent Python re-implementation of the model (tools/check.py)
verifies the published numbers afterwards.
"""
import json, subprocess, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
V3 = os.path.dirname(HERE)
KIT = os.path.expanduser("~/workspace/makefun/token-radar-01/kit/token-radar-01-kit")
SNAP = os.path.join(KIT, "input/snapshot.json")
APPJS = os.path.join(V3, "dashboard/app.js")
DRIVER = "/tmp/radar-v3-driver.js"

EXCL_CAT = {"Bridge", "Canonical Bridge", "Liquid Staking",
            "Liquid Restaking", "Restaked BTC", "CEX"}
EXCH = ("Binance", "Coinbase", "Bybit", "Kraken", "Bitget",
        "OKX", "Bitfinex", "Gemini")
import re
VER_RE = re.compile(r"\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$")
WORD_RE = re.compile(r"\b(wrapped|staked|staking)\b", re.I)

def no_token(p):
    return p.get("gecko_id") is None and p.get("symbol") is None

def passes_rule(p):
    """Watchlist rule: a fresh launch candidate (RULES.txt, minus the
    parentProtocol check, which the snapshot does not carry)."""
    if p.get("category") in EXCL_CAT:
        return False
    if WORD_RE.search(p.get("name") or ""):
        return False
    if any((p.get("name") or "").startswith(e) for e in EXCH):
        return False
    if VER_RE.search(p.get("name") or ""):
        return False
    return True

def main():
    snap = json.load(open(SNAP))
    prots = snap["protocols"]
    floor = snap["floor_usd"]
    official_wl = set(snap["watchlist"])

    watch = [p for p in prots
             if p["tvl_usd"] >= floor and no_token(p) and passes_rule(p)]
    below = sorted([p for p in prots
                    if p["tvl_usd"] < floor and no_token(p)],
                   key=lambda p: -p["tvl_usd"])[:160]
    live = sorted([p for p in prots if p.get("mcap_usd") is not None],
                  key=lambda p: -p["tvl_usd"])[:24]
    pre = watch + below

    assert official_wl <= {p["slug"] for p in pre}, "official watchlist not covered"
    assert len({p["slug"] for p in pre + live}) == len(pre) + len(live)

    # Positional rows: [slug,name,category,chain,tvl,chg7d,mcap,listed,symbol,impl,section,onWatchlist]
    rows = []
    for p in pre:
        rows.append([p["slug"], p["name"], p.get("category"),
                     (p.get("chains") or ["-"])[0], p["tvl_usd"],
                     p.get("change_7d"), None, p.get("listed_at"), None,
                     None, "pre", 1 if p in watch else 0])
    for p in live:
        rows.append([p["slug"], p["name"], p.get("category"),
                     (p.get("chains") or ["-"])[0], p["tvl_usd"],
                     p.get("change_7d"), p["mcap_usd"], p.get("listed_at"),
                     p.get("symbol"), None, "live", 0])

    # Ask app.js (the single source of truth) for implied values + farm steps.
    driver = """
const m = require(process.argv[2]);
const rows = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const out = rows.map(r => ({impl: m.impliedOf(r), steps: m.farmStepsFor(r)}));
process.stdout.write(JSON.stringify(out));
"""
    open(DRIVER, "w").write(driver)
    proc = subprocess.run(["node", DRIVER, APPJS],
                          input=json.dumps(rows).encode(),
                          capture_output=True, check=True)
    computed = json.loads(proc.stdout.decode())
    for r, c in zip(rows, computed):
        r[9] = c["impl"] if r[10] == "pre" else None
    farm = {rows[i][0]: computed[i]["steps"] for i in range(len(rows))}

    data = {"asOf": snap["as_of"], "floor": floor, "rows": rows}
    with open(os.path.join(V3, "dashboard/data.js"), "w") as f:
        f.write("var RADAR_DATA = ")
        f.write(json.dumps(data, separators=(",", ":")))
        f.write(";\n")

    ranked = sorted([r for r in rows if r[10] == "pre"],
                    key=lambda r: -r[9])
    board = {"rows": [
        {"slug": r[0], "name": r[1], "rank": i + 1,
         "implied_value_usd": r[9], "farm_steps": farm[r[0]]}
        for i, r in enumerate(ranked)]}
    with open(os.path.join(V3, "board.json"), "w") as f:
        json.dump(board, f, separators=(",", ":"))

    print("watchlist (rule):", len(watch),
          "| official 40 covered:", official_wl <= {p["slug"] for p in pre})
    print("pre-token rows:", len(pre), "| live rows:", len(live),
          "| total:", len(rows))
    print("board.json rows:", len(board["rows"]),
          "| rank 1:", board["rows"][0]["slug"],
          "$%s" % format(board["rows"][0]["implied_value_usd"], ","))
    print("data.js bytes:", os.path.getsize(os.path.join(V3, "dashboard/data.js")))

if __name__ == "__main__":
    main()
