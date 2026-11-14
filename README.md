# Token Launch Radar

A radar for protocol token launches that have not happened yet. It reads a
sealed snapshot of the protocol universe (DefiLlama data, fetched once),
finds the protocols that record no token, and ranks them by what a launch
would be worth if their record stayed as it is — then shows, for each one,
concrete steps to farm it.

## The value model

For every protocol whose token already trades, the snapshot gives a market
cap and a TVL, so the TVL-to-market-cap multiple is known. The radar takes
the median multiple inside each category (the global median where a category
has too few token-bearing protocols), multiplies a pre-token protocol's TVL
by it, then adjusts by 7-day TVL growth (clamped) and by how long the
protocol has run with no token (up to +50% for three years of track record).
Nothing is hardcoded by protocol name: the model follows from the snapshot's
own figures, so it would rank a future snapshot's protocols the same way.

## The board

200 rows: the snapshot's whole 40-protocol watchlist plus the 160
highest-TVL remaining protocols that record no token. Each row carries an
implied value in whole dollars and a farm plan whose costs are in USD and
whose steps name timeframes. A protocol is called *pre-token* because its
DefiLlama record carries no token — the record is not proof it has none.

## How to run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input kit/input/snapshot.json
```

Node 22 or later, standard library only. The run writes `out/board.json`,
`out/dashboard/` (the page plus its data), `out/screenshots/` and
`out/dossier.json`. Two runs write byte-identical output.

## The dashboard

`dashboard/` is a static page with no network: a sortable, filterable board
(search, category, chain, watchlist-only), a detail view for every protocol
with its figures, a small value chart and its farm plan, and `?shot=`
parameters for the board, detail and filtered views.
