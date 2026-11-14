/* Launch Radar v3 — entrypoint (main.ts).
 *
 * Reads the sealed DefiLlama snapshot and builds the graded output:
 *   /output/board.json            the ranked board (gate format)
 *   /output/dashboard/data.js    the page's data, computed live from the snapshot
 *   /output/dashboard/           index.html + app.css + app.js (copied as-is)
 *   /output/screenshots/         the three dashboard screenshots
 *   /output/dossier.json         written by buildDossier from vendor/makefun-board.ts
 *
 * The valuation model and the farm-step templates live ONLY in
 * dashboard/app.js, the single source of truth. This file loads them
 * and calls them, so the numbers it publishes can never drift from
 * what the page computes live. The selection rules below mirror the
 * competition's watchlist rule (RULES.txt) and the board's own rule:
 * the snapshot's official watchlist of 40 sits fully inside the
 * board's 60-protocol rule watchlist, and the board ranks 220
 * pre-token protocols (60 watchlist + the 160 below the $50M floor
 * with the most TVL). The 24 live-token protocols are set aside in
 * their own tab and are never ranked by implied value.
 *
 * Node 22, standard library only, no network. Runs twice in the
 * grader; both runs must write identical bytes. It never deletes
 * anything: /output is a mount point, so it only writes files into
 * it, never removes the directory or its contents.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { buildDossier } from "./vendor/makefun-board.ts";

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const model = require(join(REPO_ROOT, "dashboard", "app.js")) as {
  impliedOf: (row: unknown[]) => number;
  farmStepsFor: (row: unknown[]) => string[];
};

const EXCLUDED_CATEGORIES = new Set([
  "Bridge", "Canonical Bridge", "Liquid Staking",
  "Liquid Restaking", "Restaked BTC", "CEX",
]);
const EXCHANGE_NAMES = [
  "Binance", "Coinbase", "Bybit", "Kraken",
  "Bitget", "OKX", "Bitfinex", "Gemini",
];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

type Protocol = {
  slug: string;
  name: string;
  category: string | null;
  chains: string[] | null;
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
};

function hasNoToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

function passesWatchlistRule(p: Protocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  const name = p.name || "";
  if (WRAPPED_WORD.test(name)) return false;
  for (const ex of EXCHANGE_NAMES) {
    if (name.indexOf(ex) === 0) return false;
  }
  if (VERSION_SUFFIX.test(name)) return false;
  return true;
}

function flag(name: string, value: string | undefined): string {
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === name && i + 1 < process.argv.length) return process.argv[i + 1];
  }
  return value as string;
}

async function main(): Promise<void> {
  const inputDir = flag("--input", process.env.MAKEFUN_INPUT_DIR || "/input");
  const outDir = flag("--output", process.env.MAKEFUN_OUTPUT_DIR || "/output");
  const snapPath = inputDir.endsWith(".json") ? inputDir : join(inputDir, "snapshot.json");
  const snap = JSON.parse(readFileSync(snapPath, "utf8")) as {
    as_of: string;
    floor_usd: number;
    protocols: Protocol[];
    watchlist: string[];
  };
  const prots = snap.protocols;
  const floor = snap.floor_usd;
  const officialWatchlist = new Set(snap.watchlist);

  // The board's own watchlist: the competition's rule, no token
  // recorded, TVL at or above the floor. Snapshot order (by slug).
  const watch = prots.filter(
    (p) => p.tvl_usd >= floor && hasNoToken(p) && passesWatchlistRule(p)
  );
  const watchSlugs = new Set(watch.map((p) => p.slug));
  // Below the floor: the 160 pre-token protocols with the most TVL.
  const below = prots
    .filter((p) => p.tvl_usd < floor && hasNoToken(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .slice(0, 160);
  // Live token: the 24 token-trading protocols with the most TVL.
  const live = prots
    .filter((p) => p.mcap_usd !== null && p.mcap_usd !== undefined)
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .slice(0, 24);

  const pre = watch.concat(below);
  const preSlugs = new Set(pre.map((p) => p.slug));
  for (const slug of officialWatchlist) {
    if (!preSlugs.has(slug)) {
      throw new Error("official watchlist protocol missing from board: " + slug);
    }
  }
  if (new Set(pre.concat(live).map((p) => p.slug)).size !== pre.length + live.length) {
    throw new Error("duplicate slug across pre-token and live-token rows");
  }

  // Positional rows, the same shape dashboard/app.js reads:
  // [slug, name, category, chain, tvl, chg7d, mcap, listed, symbol,
  //  published_implied, section, on_watchlist]
  const rows: unknown[][] = [];
  for (const p of pre) {
    rows.push([
      p.slug, p.name, p.category === null ? null : p.category,
      (p.chains && p.chains.length > 0 ? p.chains[0] : "-"),
      p.tvl_usd, p.change_7d === undefined ? null : p.change_7d, null,
      p.listed_at === undefined ? null : p.listed_at, null, null,
      "pre", watchSlugs.has(p.slug) ? 1 : 0,
    ]);
  }
  for (const p of live) {
    rows.push([
      p.slug, p.name, p.category === null ? null : p.category,
      (p.chains && p.chains.length > 0 ? p.chains[0] : "-"),
      p.tvl_usd, p.change_7d === undefined ? null : p.change_7d,
      p.mcap_usd, p.listed_at === undefined ? null : p.listed_at,
      p.symbol, null, "live", 0,
    ]);
  }

  // Ask app.js — the single source of truth — for the implied values
  // and the farm plans, so the published board can never drift from
  // what the page computes live.
  const computed = rows.map((r) => ({
    implied: model.impliedOf(r),
    steps: model.farmStepsFor(r),
  }));
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][10] === "pre") rows[i][9] = computed[i].implied;
  }
  const farmBySlug = new Map<string, string[]>();
  for (let i = 0; i < rows.length; i++) {
    farmBySlug.set(rows[i][0] as string, computed[i].steps);
  }

  const ranked = rows
    .filter((r) => r[10] === "pre")
    .sort((a, b) => (b[9] as number) - (a[9] as number));
  const board = {
    rows: ranked.map((r, i) => ({
      slug: r[0],
      name: r[1],
      rank: i + 1,
      implied_value_usd: r[9],
      farm_steps: farmBySlug.get(r[0] as string),
    })),
  };

  const data = { asOf: snap.as_of, floor: floor, rows: rows };

  mkdirSync(join(outDir, "dashboard"), { recursive: true });
  mkdirSync(join(outDir, "screenshots"), { recursive: true });
  writeFileSync(join(outDir, "board.json"), JSON.stringify(board));
  writeFileSync(
    join(outDir, "dashboard", "data.js"),
    "var RADAR_DATA = " + JSON.stringify(data) + ";\n"
  );
  for (const f of ["index.html", "app.css", "app.js"]) {
    copyFileSync(join(REPO_ROOT, "dashboard", f), join(outDir, "dashboard", f));
  }
  const shots = readdirSync(join(REPO_ROOT, "screenshots"))
    .filter((f) => f.toLowerCase().endsWith(".png"))
    .sort();
  if (shots.length < 3) {
    throw new Error("expected at least 3 screenshots, found " + shots.length);
  }
  for (const f of shots) {
    copyFileSync(join(REPO_ROOT, "screenshots", f), join(outDir, "screenshots", f));
  }

  // The dossier is written by the kit's library from the dashboard
  // and the screenshots already in /output. It must match byte for
  // byte on every run, so nothing is written into /output after it.
  const result: unknown = buildDossier(outDir, { text_max_bytes: 65536 });
  if (result && typeof (result as { then?: unknown }).then === "function") {
    await (result as Promise<unknown>);
  }
  if (!existsSync(join(outDir, "dossier.json"))) {
    if (result instanceof Uint8Array) {
      // buildDossier returns the dossier bytes themselves: write them
      // raw. (JSON.stringify on a Uint8Array would emit {"0":123,...},
      // a bloated object of byte values, not the dossier.)
      writeFileSync(join(outDir, "dossier.json"), result);
    } else if (typeof result === "string") {
      writeFileSync(join(outDir, "dossier.json"), result);
    } else if (result && typeof result === "object") {
      writeFileSync(join(outDir, "dossier.json"), JSON.stringify(result));
    } else {
      throw new Error("buildDossier wrote no dossier.json");
    }
  }

  console.log(
    "board rows:", board.rows.length,
    "| watchlist (rule):", watch.length,
    "| official 40 covered:", [...officialWatchlist].every((s) => preSlugs.has(s)),
    "| live rows:", live.length,
    "| rank 1:", board.rows[0].slug,
    "$" + board.rows[0].implied_value_usd.toLocaleString("en-US")
  );
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
