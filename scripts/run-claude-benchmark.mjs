// Isolated Claude benchmark batch runner.
//
// Runs each Claude model N times at each reasoning level in a fresh ephemeral
// directory OUTSIDE the repo, with every built-in tool disabled and an empty
// strict MCP config, so the model can never read src/data/matches.json (which
// holds the actual results) or reach the web. Reasoning level is set via the
// MAX_THINKING_TOKENS budget. Telemetry is checked to confirm zero web searches.
//
// Usage:
//   node scripts/run-claude-benchmark.mjs <outDir> [runsPerCell] [concurrency]
//
// Writes <outDir>/results.json — an array of validated, publish-ready run
// objects — plus per-job raw responses. It does NOT publish; feed results.json
// to scripts/publish-batch.mjs after inspecting the summary.

import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import matches from '../src/data/matches.json' with { type: 'json' };

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.argv[2] || join(here, '../.batch-out'));
const runsPerCell = Number(process.argv[3] || 5);
const concurrency = Number(process.argv[4] || 4);

const validIds = new Set(matches.map((match) => match.id));
const oddsSource = 'bet365';
const promptVersion = 'closing-odds-cli-v1';

const models = [
  ['haiku', 'Claude Haiku'],
  ['sonnet', 'Claude Sonnet'],
  ['opus', 'Claude Opus'],
  ['fable', 'Claude Fable'],
];
const reasoningLevels = [
  ['low', 2000],
  ['medium', 10000],
];

const basePrompt = [
  'IMPORTANT: This is an isolated retrospective benchmark. Treat every fixture as not yet played.',
  'Do not browse, search, call tools, use retrieval, inspect files, or access any external source.',
  'Do not use remembered actual results. If you recognise a result, ignore it and make a pre-match prediction.',
  'Use only the fixture data, closing odds below, and football knowledge available before 11 June 2026.',
  '',
  'Predict the 90-minute result of all 72 listed 2026 World Cup group-stage matches.',
  'For each match choose one outcome from the HOME TEAM perspective:',
  '- WIN: the listed home team wins',
  '- DRAW: the match is drawn',
  '- LOSS: the listed home team loses and the away team wins',
  '',
  'Return ONLY a JSON object of this exact shape, with every matchId included exactly once:',
  '{"predictions":[{"matchId":"2026-A-01","outcome":"WIN"}]}',
  `Odds source: ${oddsSource}.`,
  '',
  JSON.stringify(
    matches.map((match) => ({
      matchId: match.id,
      group: match.group,
      kickoff: match.kickoff,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      closingOdds: match.odds[oddsSource],
    })),
    null,
    2,
  ),
].join('\n');

const isolationSystemPrompt =
  'You are running in an isolated retrospective benchmark. You have no tools, no web access, and no file access. ' +
  'Do not attempt to use any. Return only the requested JSON.';

function runClaude(jobDir, alias, thinkingTokens) {
  return new Promise((resolvePromise) => {
    const args = [
      '-p', basePrompt,
      '--model', alias,
      '--output-format', 'json',
      '--tools', '',
      '--strict-mcp-config',
      '--mcp-config', join(jobDir, 'empty-mcp.json'),
      '--append-system-prompt', isolationSystemPrompt,
    ];
    execFile(
      'claude',
      args,
      {
        cwd: jobDir,
        env: { ...process.env, MAX_THINKING_TOKENS: String(thinkingTokens) },
        maxBuffer: 64 * 1024 * 1024,
        timeout: 8 * 60 * 1000,
      },
      (error, stdout, stderr) => {
        if (error) return resolvePromise({ error: `${error.message}\n${stderr}`.slice(0, 500) });
        try {
          resolvePromise({ wrapper: JSON.parse(stdout) });
        } catch {
          resolvePromise({ error: `Unparseable CLI output: ${stdout.slice(0, 200)}` });
        }
      },
    );
  });
}

function extractPredictions(resultText) {
  let text = String(resultText ?? '').trim();
  text = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start < 0 || end < start) throw new Error('No JSON array found in response.');
    parsed = JSON.parse(text.slice(start, end + 1));
  }
  const array = Array.isArray(parsed) ? parsed : parsed.predictions;
  if (!Array.isArray(array)) throw new Error('Response did not contain a predictions array.');
  return array.map((item) => ({
    matchId: item.matchId ?? item.id,
    outcome: item.outcome ?? item.prediction ?? item.result,
  }));
}

const OUTCOME_ALIAS = { H: 'WIN', D: 'DRAW', A: 'LOSS', WIN: 'WIN', DRAW: 'DRAW', LOSS: 'LOSS' };

function validate(predictions, label) {
  if (!Array.isArray(predictions) || predictions.length !== 72) {
    throw new Error(`${label}: expected 72 predictions, got ${predictions?.length}.`);
  }
  const seen = new Set();
  return predictions.map((prediction) => {
    if (!validIds.has(prediction.matchId)) throw new Error(`${label}: unknown match ${prediction.matchId}.`);
    const outcome = OUTCOME_ALIAS[prediction.outcome];
    if (!outcome) throw new Error(`${label}: invalid outcome "${prediction.outcome}" for ${prediction.matchId}.`);
    if (seen.has(prediction.matchId)) throw new Error(`${label}: duplicate match ${prediction.matchId}.`);
    seen.add(prediction.matchId);
    return { matchId: prediction.matchId, outcome };
  });
}

async function runJob(job) {
  const jobDir = join(outDir, job.id);
  await mkdir(jobDir, { recursive: true });
  await writeFile(join(jobDir, 'empty-mcp.json'), '{"mcpServers":{}}\n');

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { wrapper, error } = await runClaude(jobDir, job.alias, job.thinkingTokens);
    if (error) {
      if (attempt === 2) return { ok: false, id: job.id, error };
      continue;
    }
    await writeFile(join(jobDir, 'response.json'), JSON.stringify(wrapper, null, 2));
    try {
      const usage = wrapper.modelUsage || {};
      const webSearches = Object.values(usage).reduce((total, item) => total + (item.webSearchRequests || 0), 0);
      if (webSearches) throw new Error(`${job.id}: reported ${webSearches} web searches.`);
      const actualVersion =
        Object.keys(usage).find((version) => version.includes(`-${job.alias}-`)) || Object.keys(usage).at(-1) || job.alias;
      const predictions = validate(extractPredictions(wrapper.result), job.id);
      return {
        ok: true,
        id: job.id,
        run: {
          id: job.id,
          model: job.name,
          modelVersion: actualVersion,
          reasoningEffort: job.reasoning,
          promptVersion,
          oddsSource,
          publisher: 'Claude Code 2.1.206',
          notes:
            'Isolated ephemeral directory outside the repo; all built-in tools disabled; empty strict MCP config; ' +
            `no result data supplied; MAX_THINKING_TOKENS=${job.thinkingTokens}; telemetry confirmed zero web searches.`,
          createdAt: new Date().toISOString(),
          predictions,
        },
      };
    } catch (cause) {
      if (attempt === 2) return { ok: false, id: job.id, error: cause.message };
    }
  }
  return { ok: false, id: job.id, error: 'exhausted retries' };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const jobs = [];
  for (const [alias, name] of models) {
    for (const [reasoning, thinkingTokens] of reasoningLevels) {
      for (let n = 1; n <= runsPerCell; n += 1) {
        jobs.push({ id: `claude-${alias}-${reasoning}-bet365-cli-run${n}`, alias, name, reasoning, thinkingTokens });
      }
    }
  }

  console.log(`Running ${jobs.length} isolated jobs (${runsPerCell}/cell, concurrency ${concurrency})…`);
  const results = [];
  let cursor = 0;
  let done = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      const result = await runJob(job);
      done += 1;
      results.push(result);
      console.log(`[${done}/${jobs.length}] ${result.ok ? 'OK  ' : 'FAIL'} ${job.id}${result.ok ? '' : ` — ${result.error}`}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));

  const runs = results.filter((r) => r.ok).map((r) => r.run);
  const failures = results.filter((r) => !r.ok);
  await writeFile(join(outDir, 'results.json'), JSON.stringify(runs, null, 2));
  await writeFile(join(outDir, 'failures.json'), JSON.stringify(failures, null, 2));
  console.log(`\nDone. ${runs.length}/${jobs.length} valid runs → ${join(outDir, 'results.json')}`);
  if (failures.length) console.log(`${failures.length} failures → ${join(outDir, 'failures.json')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
