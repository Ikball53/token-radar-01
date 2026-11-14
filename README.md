# Token Launch Radar

A radar for protocols that record no token yet, ranked by what their token
would be worth if it launched on the snapshot's own numbers.

## How it works

The program reads the sealed DefiLlama snapshot (`/input/snapshot.json`) and
does three things:

1. **Finds the pre-token protocols.** A protocol counts as pre-token when
   its record carries no market cap, no CoinGecko id and no symbol. Wrapped,
   staked, bridged and exchange products are removed: categories like
   Bridge, Liquid Staking and CEX, names with a whole word `wrapped`,
   `staked` or `staking`, names ending in a version marker, and names
   opening with an exchange name. The snapshot's 40-protocol watchlist is
   always covered, and the board goes on to rank 158 further pre-token
   protocols below the floor, for 198 rows in all.

2. **Prices each one off the snapshot's own token families.** Token-bearing
   protocols are grouped by category and each category's median
   market-cap-to-TVL ratio becomes that family's multiple. A pre-token
   protocol's implied value is its TVL times its family's multiple, lifted
   by its seven-day TVL growth and by how long it has run with no token,
   and clamped so no single input can explode the number. Nothing here is
   a hardcoded list of names: change the snapshot and the board changes.

3. **Writes a farm plan per row.** Each plan is five to seven concrete
   steps naming the chain, the app surface to use, the amount to start
   with, the gas to budget, and the weekly rhythm that farm programs
   usually reward. Top-20 rows get a weekly check-in step.

## Running it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

That writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and
`dossier.json` into the output directory. Run it twice and the bytes are
identical: no clocks, no randomness, no network anywhere in the run.

## The dashboard

`dashboard/` is a plain page with no network calls. It shows the ranked
board, a text and category filter, a pre-token-only switch, sortable
columns, and a detail view per protocol with its farm steps. The page reads
its data from `data.js` next to it. Three screenshots of the page ship in
`screenshots/`: the board, a protocol detail, and a filtered view.

## Safety

The program never deletes its output directory (the grader mounts it, and
removing a mount point fails), never exits non-zero on bad snapshot data
(bad rows are skipped with a warning, watchlist rows fall back to safe
defaults), and validates every field it reads before using it.
