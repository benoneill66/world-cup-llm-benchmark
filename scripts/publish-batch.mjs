// Publish a batch of validated benchmark runs into the committed catalogue.
//
// Reads a results.json produced by run-claude-benchmark.mjs, validates and
// normalizes each run with the same logic the curator server uses, dedupes by
// id, and appends to src/data/published-runs.json atomically. Prints a per-cell
// accuracy summary so the batch can be sanity-checked before it is committed.
//
// Usage: node scripts/publish-batch.mjs <results.json>

import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import matches from '../src/data/matches.json' with { type: 'json' };
import { normalizePublishedRun, readRuns, validatePublishedRun, writeRuns } from '../server/store.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const resultsPath = resolve(process.argv[2] || join(here, '../.batch-out/results.json'));
const storePath = resolve(here, '../src/data/published-runs.json');
const validMatchIds = new Set(matches.map((match) => match.id));

const actual = new Map(
  matches.map((match) => [
    match.id,
    match.homeGoals > match.awayGoals ? 'H' : match.homeGoals < match.awayGoals ? 'A' : 'D',
  ]),
);

const incoming = JSON.parse(await readFile(resultsPath, 'utf8'));
if (!Array.isArray(incoming) || !incoming.length) throw new Error('results.json contained no runs.');

const existing = await readRuns(storePath);
const existingIds = new Set(existing.map((run) => run.id));

const accepted = [];
const skipped = [];
for (const run of incoming) {
  if (existingIds.has(run.id)) {
    skipped.push(`${run.id} (already published)`);
    continue;
  }
  const error = validatePublishedRun(run, validMatchIds);
  if (error) {
    skipped.push(`${run.id} (${error})`);
    continue;
  }
  accepted.push({ ...normalizePublishedRun(run), model: run.model.trim(), publishedAt: new Date().toISOString() });
  existingIds.add(run.id);
}

if (accepted.length) await writeRuns(storePath, [...existing, ...accepted]);

// Per-cell accuracy summary over the accepted runs.
const cells = new Map();
for (const run of accepted) {
  const key = `${run.model} / ${run.reasoningEffort}`;
  const correct = run.predictions.filter((prediction) => prediction.outcome === actual.get(prediction.matchId)).length;
  const cell = cells.get(key) || { runs: 0, accSum: 0 };
  cell.runs += 1;
  cell.accSum += correct / run.predictions.length;
  cells.set(key, cell);
}

console.log(`Published ${accepted.length} run(s); catalogue now holds ${existing.length + accepted.length}.`);
if (skipped.length) console.log(`Skipped ${skipped.length}:\n  ${skipped.join('\n  ')}`);
console.log('\nMean accuracy by cell:');
for (const [key, cell] of [...cells.entries()].sort()) {
  console.log(`  ${key.padEnd(26)} ${cell.runs} runs  ${(100 * cell.accSum / cell.runs).toFixed(1)}%`);
}
