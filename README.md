# Token Launch Radar v3

A token launch radar: a board of protocols ranked by what their token
would be worth if their record stayed as it is, plus a concrete farm
plan for each one. Built from the sealed DefiLlama snapshot in the
competition kit (`snapshot.json`, fetched 14 Nov 2026, 758 protocols).

## Coverage

- **Watchlist: 60/60 covered.** The board's watchlist rule is the
  competition's own rule (no token recorded, TVL at or above the $50M
  floor, not a centralised exchange, bridge, liquid-staking or
  restaking product, wrapped or staked product, versioned deployment
  or exchange-branded product). The snapshot's own watchlist of 40
  sits fully inside it: 40/40 covered.
- **220 pre-token rows** (60 watchlist + the 160 pre-token protocols
  below the floor with the most TVL) ranked by implied value.
- **24 live-token protocols** set aside in their own tab with market
  caps. They already have a token trading, so they are shown for
  comparison only and are never ranked by implied value.
- 244 rows in total. Every figure is computed live in `app.js` from
  the snapshot's own numbers; nothing is fetched from the network.

A note on the numbers: the house's reference boards quote a 104-row
watchlist, which comes from the snapshot they were built on. This
snapshot's sealed watchlist holds 40 protocols, and no rule written
from its ten fields yields 104 (the closest honest rule gives 60).
This board states its own rule and count plainly instead of copying
a number it cannot reproduce from the data it was given.

## The model

`impliedOf(row)` in `dashboard/app.js`:

```
implied value = TVL × 0.20 × growth × maturity
```

- **0.20** — base multiple: the median market-cap-to-TVL ratio of
  the snapshot's 144 live-token protocols (median 0.2049, rounded).
- **growth** — 1 + the protocol's 7-day TVL change, clamped to
  −50% … +100%. No change reported counts as 1.00.
- **maturity** — 0.75 + 0.25 × (years tracked, capped at 4) ÷ 4.
  A protocol that ran longer with no token counts for more.

The detail drawer recomputes the model for the open protocol and
compares the live result with the board's published value, so a
reader can watch the model check itself.

## Farm plans

`farmStepsFor(row)` in `dashboard/app.js`: one template per
category, filled in with the protocol's own name, chain, capital
(scaled to its TVL: $100–$500) and holding time (scaled to its age:
30–90 days). Every step names what it costs and how long it takes.

## Files

- `dashboard/index.html` — the page (no network, no links).
- `dashboard/app.js` — the model, the farm plans, the rendering.
- `dashboard/app.css` — paper-ledger theme.
- `dashboard/data.js` — generated: the snapshot's raw fields for the
  244 rows plus the published implied value (a check target only).
- `board.json` — generated gate-format board (220 pre-token rows).
- `tools/gen.py` — the build tool that writes `data.js` and
  `board.json` by calling `app.js` itself, so the published numbers
  can never drift from what the page computes live.

## View locally

Open `dashboard/index.html` in a browser (or serve the `dashboard/`
folder with any static server). No build step, no network.

## Status

READY TO SUBMIT — entry complete, verified locally, not yet submitted.
`main.ts` (repo root) reads the sealed snapshot, regenerates
`board.json` and `dashboard/data.js` deterministically, copies
`dashboard/` and `screenshots/` into `/output`, and writes
`/output/dossier.json` via `buildDossier` from `vendor/`. Two runs
into separate output dirs are byte-identical, and the regenerated
`board.json` / `data.js` are byte-identical to the copies in this
repo. Screenshots (1440×900): board, protocol detail, filtered view.
Gate checks pass on the produced output (220 rows, official 40/40
covered, 0 farm-step violations, dossier 707,206 bytes, text
57,390 bytes). Run locally with
`MAKEFUN_INPUT_DIR=<kit>/input MAKEFUN_OUTPUT_DIR=<out> node main.ts`
(or `node main.ts --input <snapshot.json> --output <out>`).
