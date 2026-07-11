// Publish a batch of validated profit runs into the committed catalogue.
//
// Reads a results.json from run-profit-benchmark.mjs, validates/normalizes each
// run with the curator-server logic, dedupes by id, appends to
// src/data/published-runs.json atomically, and prints a per-cell P&L summary
// (using the same budget-fit + best-price settlement the web app uses).
//
// Usage: node scripts/publish-batch.mjs <results.json>

import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import matches from '../src/data/matches.json' with { type: 'json' };
import { normalizePublishedRun, readRuns, validatePublishedRun, writeRuns } from '../server/store.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const resultsPath = resolve(process.argv[2] || join(here, '../.profit-out/results.json'));
const storePath = resolve(here, '../src/data/published-runs.json');
const validMatchIds = new Set(matches.map((match) => match.id));

const BANKROLL = 100, MAX_STAKE = 10, FEEDS = ['bet365', 'betfairExchange', 'marketAverage', 'marketBest'];
const byId = new Map(matches.map((m) => [m.id, m]));
const price = (l, o) => (o === 'H' ? l.home : o === 'D' ? l.draw : l.away);
const bestOdds = (m, o) => Math.max(...FEEDS.map((f) => price(m.odds[f], o)));
const actual = (m) => (m.homeGoals > m.awayGoals ? 'H' : m.homeGoals < m.awayGoals ? 'A' : 'D');
const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

function fitStakes(stakes, budget = BANKROLL, cap = MAX_STAKE) {
  const s = stakes.map((v) => Math.max(0, Math.min(cap, Number.isFinite(v) ? v : 0)));
  const total = s.reduce((a, b) => a + b, 0);
  if (total <= 0) return s;
  if (total > budget) return s.map((v) => round2((v * budget) / total));
  for (let i = 0; i < 60; i += 1) {
    const cur = s.reduce((a, b) => a + b, 0);
    if (budget - cur < 1e-6) break;
    const fixed = s.reduce((a, v) => a + (v >= cap - 1e-9 ? v : 0), 0);
    const free = s.map((v, idx) => (v > 0 && v < cap - 1e-9 ? idx : -1)).filter((idx) => idx >= 0);
    const freeSum = free.reduce((a, idx) => a + s[idx], 0);
    if (!free.length || freeSum <= 0) break;
    const factor = (budget - fixed) / freeSum;
    if (factor <= 1 + 1e-9) break;
    for (const idx of free) s[idx] = Math.min(cap, s[idx] * factor);
  }
  return s.map(round2);
}

function scoreRun(run) {
  const scored = run.wagers.filter((w) => byId.has(w.matchId));
  const stakes = fitStakes(scored.map((w) => (w.bet === 'PASS' ? 0 : w.stake)));
  let pnl = 0, staked = 0, placed = 0, wins = 0;
  scored.forEach((w, i) => {
    const stake = stakes[i];
    if (w.bet === 'PASS' || stake <= 0) return;
    const m = byId.get(w.matchId);
    const o = bestOdds(m, w.bet);
    staked += stake; placed += 1;
    if (w.bet === actual(m)) { pnl += stake * (o - 1); wins += 1; } else pnl -= stake;
  });
  return { pnl: round2(pnl), staked: round2(staked), placed, wins };
}

const incoming = JSON.parse(await readFile(resultsPath, 'utf8'));
if (!Array.isArray(incoming) || !incoming.length) throw new Error('results.json contained no runs.');

const existing = await readRuns(storePath);
const existingIds = new Set(existing.map((run) => run.id));

const accepted = [];
const skipped = [];
for (const run of incoming) {
  if (existingIds.has(run.id)) { skipped.push(`${run.id} (already published)`); continue; }
  const error = validatePublishedRun(run, validMatchIds);
  if (error) { skipped.push(`${run.id} (${error})`); continue; }
  accepted.push({ ...normalizePublishedRun(run), model: run.model.trim(), publishedAt: new Date().toISOString() });
  existingIds.add(run.id);
}

if (accepted.length) await writeRuns(storePath, [...existing, ...accepted]);

const cells = new Map();
for (const run of accepted) {
  const key = `${run.model} / ${run.reasoningEffort}`;
  const { pnl, placed, wins } = scoreRun(run);
  const cell = cells.get(key) || { runs: 0, pnl: 0, placed: 0, wins: 0 };
  cell.runs += 1; cell.pnl += pnl; cell.placed += placed; cell.wins += wins;
  cells.set(key, cell);
}

console.log(`Published ${accepted.length} run(s); catalogue now holds ${existing.length + accepted.length}.`);
if (skipped.length) console.log(`Skipped ${skipped.length}:\n  ${skipped.join('\n  ')}`);
console.log('\nMean net P&L by cell (on £100 bankroll):');
for (const [key, cell] of [...cells.entries()].sort((a, b) => b[1].pnl / b[1].runs - a[1].pnl / a[1].runs)) {
  const pnl = cell.pnl / cell.runs;
  console.log(`  ${key.padEnd(26)} ${cell.runs} runs  ${pnl >= 0 ? '+' : ''}£${pnl.toFixed(2)}  (${(100 * pnl / 100).toFixed(1)}% ROI, ${(cell.placed / cell.runs).toFixed(0)} bets, ${(100 * cell.wins / cell.placed).toFixed(0)}% hit)`);
}
