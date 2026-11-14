// Token Launch Radar — token-radar-01
//
// Reads a sealed DefiLlama snapshot, ranks the protocols that record no token
// by an implied launch value derived from the snapshot's own figures, and
// writes the board, the dashboard data, the dashboard itself, the screenshots
// and the dossier into the output directory. Deterministic: two runs write
// byte-identical output (all age math anchors on the snapshot's as_of date;
// no clocks, no randomness, no network).

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

// ------------------------------------------------------------------ types

interface SnapshotProto {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

interface SnapshotFile {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProto[];
  watchlist: string[];
}

interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  multiple_used: number;
  status: string;
  on_watchlist: boolean;
}

// ------------------------------------------------------------------ helpers

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv: string[]): { input: string; output: string } {
  let input = '/input/snapshot.json';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input' && i + 1 < argv.length) input = argv[i + 1]!;
  }
  const output = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  return { input, output };
}

function medianOf(values: number[]): number {
  const xs = [...values].sort((a, b) => a - b);
  if (xs.length === 0) return 0;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 1 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2;
}

function clampNum(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Whole-dollar formatting with thousands separators, no locale dependence. */
function fmtUsd(n: number): string {
  const s = String(Math.round(n));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtMoney(n: number): string {
  return `$${fmtUsd(n)}`;
}

function fmtCompact(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return fmtMoney(n);
}

/** UTC day count between two YYYY-MM-DD dates. */
function daySpan(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const a = Date.UTC(fy!, fm! - 1, fd!);
  const b = Date.UTC(ty!, tm! - 1, td!);
  return Math.max(0, Math.floor((b - a) / 86_400_000));
}

/** Rough cost in USD of one plain transaction on a chain. */
function gasUsd(chain: string): number {
  const table: Record<string, number> = {
    Ethereum: 3.0,
    Base: 0.05,
    Solana: 0.02,
    Arbitrum: 0.3,
    Optimism: 0.1,
    'BNB Chain': 0.15,
    Polygon: 0.05,
    Avalanche: 0.3,
    Blast: 0.05,
    Linea: 0.1,
    Scroll: 0.1,
    zkSync: 0.1,
    Mantle: 0.05,
    Sui: 0.02,
    Aptos: 0.02,
  };
  return table[chain] ?? 0.5;
}

// ------------------------------------------------------------------ value model

/**
 * The TVL-to-market-cap multiple for a category: the median multiple of the
 * token-bearing protocols in that category (at least 3 samples, else the
 * global median), clamped so one outlier category cannot run away with the
 * board. Everything comes from the snapshot; no protocol name is hardcoded.
 */
function categoryMultiples(protos: SnapshotProto[]): Map<string, number> {
  const byCat = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protos) {
    if (p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0) {
      const mult = p.mcap_usd / p.tvl_usd;
      all.push(mult);
      const key = p.category ?? 'Uncategorized';
      const list = byCat.get(key) ?? [];
      list.push(mult);
      byCat.set(key, list);
    }
  }
  const global = clampNum(medianOf(all), 0.05, 2);
  const out = new Map<string, number>();
  for (const [cat, list] of byCat) {
    out.set(cat, list.length >= 3 ? clampNum(medianOf(list), 0.05, 2) : global);
  }
  out.set('__global__', global);
  return out;
}

function multipleFor(cat: string | null, multiples: Map<string, number>): number {
  const key = cat ?? 'Uncategorized';
  return multiples.get(key) ?? multiples.get('__global__')!;
}

/**
 * Implied launch value of a protocol that records no token:
 *   TVL x category multiple, adjusted by 7-day TVL growth (clamped) and by
 *   how long it has run with no token (a longer track record without a token
 *   reads as a larger, more mature launch; the factor is capped at +50%).
 */
function impliedValueUsd(p: SnapshotProto, asOf: string, multiples: Map<string, number>): { value: number; multiple: number; ageDays: number | null } {
  const multiple = multipleFor(p.category, multiples);
  const growth = p.change_7d === null ? 1 : 1 + clampNum(p.change_7d, -25, 60) / 250;
  const ageDays = p.listed_at === null ? null : daySpan(p.listed_at, asOf);
  const ageFactor = ageDays === null ? 1 : 1 + 0.5 * (Math.min(ageDays, 1095) / 1095);
  const value = Math.max(1, Math.round(p.tvl_usd * multiple * growth * ageFactor));
  return { value, multiple, ageDays };
}

// ------------------------------------------------------------------ farm plan

/**
 * A concrete farm plan for one protocol, built from its own snapshot figures
 * (category, chains, TVL, 7-day change, age). Costs are in USD, each step
 * names a timeframe, and nothing claims the protocol has no token — only
 * that it records none.
 */
function farmPlanFor(p: SnapshotProto, value: number): string[] {
  const primary = p.chains[0] ?? 'Ethereum';
  const gas = gasUsd(primary);
  const gasText = gas < 0.1 ? gas.toFixed(2) : gas.toFixed(1);
  const position = clampNum(Math.round(p.tvl_usd / 200_000), 50, 400);
  const gasFund = Math.max(5, Math.ceil(gas * 12));
  const bridgeFee = Math.max(1, Math.round(gas * 4));
  const claimGas = Math.max(1, Math.ceil(gas * 3));
  const cat = (p.category ?? 'protocol').toLowerCase();
  const changeText =
    p.change_7d === null
      ? 'with no 7-day change reported'
      : p.change_7d >= 0
        ? `up ${p.change_7d.toFixed(1)}% over 7 days`
        : `down ${Math.abs(p.change_7d).toFixed(1)}% over 7 days`;
  const steps = [
    `Set up a fresh wallet and fund it with about ${fmtMoney(gasFund)} of ${primary} gas plus ${fmtMoney(position)} for positions. A ${primary} transaction costs roughly $${gasText}, so ${fmtMoney(gasFund)} covers 10+ transactions over the next 6 weeks.`,
    `Bridge ${fmtMoney(position)} of stablecoins to ${primary} through the chain's canonical bridge (about ${fmtMoney(bridgeFee)} in fees, 10-20 minutes) and keep ${fmtMoney(Math.max(2, Math.ceil(gas * 5)))} in reserve for gas so a later claim never strands you.`,
    `Put ${fmtMoney(position)} to work in ${p.name}'s ${cat} product on ${primary}: deposit, hold the position for at least 4 weeks, and make a small second interaction in week 2 so the activity reads as real usage, not a one-off deposit.`,
    `Repeat one small interaction a week for 6-8 weeks — a deposit, a withdrawal, or a vote — at about $${gasText} in gas each, and watch the protocol's TVL (now ${fmtCompact(p.tvl_usd)}, ${changeText}) to tell whether usage is growing or fading.`,
    `Watch ${p.name} for a token announcement; if one lands, claim inside the first 48 hours and budget about ${fmtMoney(claimGas)} in gas for the claim, then decide whether to hold the airdrop or sell half. The radar's implied value for this launch is ${fmtCompact(value)}.`,
  ];
  return steps;
}

// ------------------------------------------------------------------ board build

function buildBoard(snap: SnapshotFile): BoardRow[] {
  const multiples = categoryMultiples(snap.protocols);
  const watch = new Set(snap.watchlist);
  const preToken = snap.protocols.filter((p) => p.gecko_id === null && p.symbol === null);
  const chosen: SnapshotProto[] = [];
  for (const p of preToken) if (watch.has(p.slug)) chosen.push(p);
  const rest = preToken
    .filter((p) => !watch.has(p.slug))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, 160);
  chosen.push(...rest);

  const scored = chosen.map((p) => {
    const { value, multiple, ageDays } = impliedValueUsd(p, snap.as_of, multiples);
    return { p, value, multiple, ageDays };
  });
  scored.sort((a, b) => b.value - a.value || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));

  return scored.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    rank: i + 1,
    implied_value_usd: s.value,
    farm_steps: farmPlanFor(s.p, s.value),
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    age_days: s.ageDays,
    multiple_used: Math.round(s.multiple * 1000) / 1000,
    status: 'pre-token',
    on_watchlist: watch.has(s.p.slug),
  }));
}

// ------------------------------------------------------------------ dashboard data

/** Compact rows for the dashboard page (farm steps are rebuilt in app.js from the same plan). */
function dashboardRows(rows: BoardRow[]): unknown[] {
  return rows.map((r) => [
    r.slug,
    r.name,
    r.rank,
    r.implied_value_usd,
    r.tvl_usd,
    r.category,
    r.chains,
    r.change_7d,
    r.age_days,
    r.multiple_used,
    r.on_watchlist ? 1 : 0,
  ]);
}

// ------------------------------------------------------------------ main

function main(): void {
  const { input, output } = parseArgs(process.argv.slice(2));
  const snap = JSON.parse(readFileSync(input, 'utf8')) as SnapshotFile;
  const rows = buildBoard(snap);

  // Fail fast rather than writing a board that misses part of the watchlist.
  const covered = new Set(rows.map((r) => r.slug));
  const missing = snap.watchlist.filter((s) => !covered.has(s));
  if (rows.length < 100 || missing.length > 0) {
    throw new Error(`token-radar: board invalid — ${rows.length} rows, missing watchlist: ${missing.join(', ')}`);
  }

  if (existsSync(output)) rmSync(output, { recursive: true, force: true });
  mkdirSync(join(output, 'dashboard'), { recursive: true });
  mkdirSync(join(output, 'screenshots'), { recursive: true });

  writeFileSync(join(output, 'board.json'), `${JSON.stringify({ as_of: snap.as_of, floor_usd: snap.floor_usd, rows }, null, 2)}\n`, 'utf8');

  const dataJs =
    `// Token Launch Radar data. Row fields, in order:\n` +
    `// [slug, name, rank, implied_value_usd, tvl_usd, category, chains, change_7d, age_days, multiple_used, on_watchlist]\n` +
    `// Farm steps are rebuilt in app.js from the same plan main.ts writes to board.json.\n` +
    `window.RADAR = ${JSON.stringify({ asOf: snap.as_of, floorUsd: snap.floor_usd, rows: dashboardRows(rows) })};\n`;
  cpSync(join(REPO_ROOT, 'dashboard'), join(output, 'dashboard'), { recursive: true });
  writeFileSync(join(output, 'dashboard', 'data.js'), dataJs, 'utf8');
  cpSync(join(REPO_ROOT, 'screenshots'), join(output, 'screenshots'), { recursive: true });

  writeFileSync(join(output, 'dossier.json'), buildDossier(output, { text_max_bytes: 65536 }), 'utf8');

  process.stdout.write(`token-radar: ${rows.length} rows, rank 1 ${rows[0]!.slug} ${fmtMoney(rows[0]!.implied_value_usd)}, dossier written\n`);
}

main();
