// Isolated profit-benchmark batch runner.
//
// Runs each model N times per reasoning level in a fresh ephemeral directory
// OUTSIDE the repo, all built-in tools disabled, empty strict MCP config, so the
// model cannot read src/data/matches.json (the results) or reach the web.
// Reasoning level is set via MAX_THINKING_TOKENS. Zero web searches is enforced.
//
// Usage:
//   node scripts/run-profit-benchmark.mjs <outDir> [runsPerCell] [concurrency] [modelFilter] [reasoningFilter]
//   e.g. node scripts/run-profit-benchmark.mjs .out 5 4 opus medium
//
// Writes <outDir>/results.json — validated, publish-ready run objects (wagers).

import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import matches from '../src/data/matches.json' with { type: 'json' };

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.argv[2] || join(here, '../.profit-out'));
const runsPerCell = Number(process.argv[3] || 5);
const concurrency = Number(process.argv[4] || 4);
const modelFilter = (process.argv[5] || '').toLowerCase();
const reasoningFilter = (process.argv[6] || '').toLowerCase();

const validIds = new Set(matches.map((match) => match.id));
const promptVersion = 'profit-v1';
const MAX_STAKE = 10;
const STARTING_BANKROLL = 100;
const FEEDS = ['bet365', 'betfairExchange', 'marketAverage', 'marketBest'];
const price = (line, o) => (o === 'H' ? line.home : o === 'D' ? line.draw : line.away);
const bestOdds = (match, o) => Math.max(...FEEDS.map((f) => price(match.odds[f], o)));

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

const fixtures = matches.map((match) => ({
  matchId: match.id,
  group: match.group,
  kickoff: match.kickoff,
  homeTeam: match.homeTeam,
  awayTeam: match.awayTeam,
  closingOdds: {
    bet365: match.odds.bet365,
    betfairExchange: match.odds.betfairExchange,
    marketAverage: match.odds.marketAverage,
    bestAvailable: { home: bestOdds(match, 'H'), draw: bestOdds(match, 'D'), away: bestOdds(match, 'A') },
  },
}));

const basePrompt = [
  'ROLE: You are a professional football bettor. Your only objective is to MAXIMISE PROFIT — not accuracy.',
  '',
  'RULES OF THE GAME:',
  `- You have a £${STARTING_BANKROLL} bankroll to allocate across the 72 group-stage matches of the 2026 FIFA World Cup.`,
  '- For each match you may back the HOME win (H), DRAW (D), or AWAY win (A), or PASS (no bet).',
  `- You MUST stake your ENTIRE £${STARTING_BANKROLL} bankroll: the stakes across all matches must sum to exactly £${STARTING_BANKROLL}.`,
  `- Maximum £${MAX_STAKE} on any single match, so you must spread the £${STARTING_BANKROLL} across at least ${STARTING_BANKROLL / MAX_STAKE} matches. PASS (£0) on the rest.`,
  '- Each winning bet is settled at the BEST AVAILABLE decimal price we list (bestAvailable). Payout = best odds × stake.',
  '- A winning £s stake at decimal odds o returns a net profit of s×(o−1); a losing bet loses the stake.',
  '',
  'HOW TO WIN THIS GAME:',
  '- This is a bankroll-allocation problem: every £1 you put on one match is £1 you cannot put on another, so concentrate your money on your strongest value bets.',
  '- The listed prices are efficient, so blindly backing favourites loses money to the margin over time.',
  '- A value bet is one where YOUR estimated probability of an outcome is HIGHER than the price implies (implied prob = 1 / best odds) — positive expected value.',
  '- Stake most on your highest-edge, highest-confidence value bets, less on thinner edges, and PASS on matches with no edge. Taking calculated risks on longer prices is rewarded when the value is real.',
  '',
  'RULES OF CONDUCT:',
  '- Treat every fixture as not yet played. Do not browse, search, call tools, use retrieval, inspect files, or access any external source.',
  '- Do not use remembered actual results. If you recognise a result, ignore it and reason as a pre-match bettor.',
  '- Use only the fixture data, the odds below, and football knowledge available before 11 June 2026.',
  '',
  'OUTPUT: Return ONLY a JSON array, one object per match, every matchId included exactly once:',
  '[{"matchId":"2026-A-01","bet":"A","stake":6.5,"probs":{"H":0.30,"D":0.28,"A":0.42}}]',
  '- "bet": one of "H","D","A","PASS".  "stake": number £0–£' + MAX_STAKE + ' (0 when PASS); all stakes must sum to £' + STARTING_BANKROLL + '.',
  '- "probs": YOUR probabilities for H, D and A; they must sum to 1.',
  '',
  JSON.stringify(fixtures, null, 2),
].join('\n');

const isolationSystemPrompt =
  'You are running in an isolated profit benchmark. You have no tools, no web access, and no file access. ' +
  'Do not attempt to use any. Return only the requested JSON array.';

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
    execFile('claude', args, {
      cwd: jobDir,
      env: { ...process.env, MAX_THINKING_TOKENS: String(thinkingTokens) },
      maxBuffer: 64 * 1024 * 1024,
      timeout: 12 * 60 * 1000,
    }, (error, stdout, stderr) => {
      if (error) return resolvePromise({ error: `${error.message}\n${stderr}`.slice(0, 500) });
      try { resolvePromise({ wrapper: JSON.parse(stdout) }); }
      catch { resolvePromise({ error: `Unparseable CLI output: ${stdout.slice(0, 200)}` }); }
    });
  });
}

const BET_ALIAS = { H: 'H', D: 'D', A: 'A', PASS: 'PASS', WIN: 'H', DRAW: 'D', LOSS: 'A', HOME: 'H', AWAY: 'A', NONE: 'PASS', SKIP: 'PASS' };
const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

function extractArray(resultText) {
  let text = String(resultText ?? '').replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  let parsed;
  try { parsed = JSON.parse(text); }
  catch {
    const start = text.indexOf('['), end = text.lastIndexOf(']');
    if (start < 0 || end < start) throw new Error('No JSON array found in response.');
    parsed = JSON.parse(text.slice(start, end + 1));
  }
  const array = Array.isArray(parsed) ? parsed : parsed.wagers || parsed.bets || parsed.predictions;
  if (!Array.isArray(array)) throw new Error('Response did not contain a wager array.');
  return array;
}

function validate(rawWagers, label) {
  if (rawWagers.length !== 72) throw new Error(`${label}: expected 72 wagers, got ${rawWagers.length}.`);
  const seen = new Set();
  return rawWagers.map((w) => {
    const matchId = w.matchId ?? w.id;
    if (!validIds.has(matchId)) throw new Error(`${label}: unknown match ${matchId}.`);
    if (seen.has(matchId)) throw new Error(`${label}: duplicate match ${matchId}.`);
    seen.add(matchId);
    const bet = BET_ALIAS[String(w.bet ?? w.outcome ?? 'PASS').toUpperCase()];
    if (!bet) throw new Error(`${label}: invalid bet "${w.bet}" for ${matchId}.`);
    let stake = bet === 'PASS' ? 0 : Math.max(0, Math.min(MAX_STAKE, round2(Number(w.stake) || 0)));
    const raw = w.probs || w.probabilities || {};
    let H = Number(raw.H ?? raw.home) || 0, D = Number(raw.D ?? raw.draw) || 0, A = Number(raw.A ?? raw.away) || 0;
    const total = H + D + A;
    if (total > 0) { H /= total; D /= total; A /= total; }
    return { matchId, bet, stake, probs: { H, D, A } };
  });
}

async function runJob(job) {
  const jobDir = join(outDir, job.id);
  await mkdir(jobDir, { recursive: true });
  await writeFile(join(jobDir, 'empty-mcp.json'), '{"mcpServers":{}}\n');
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { wrapper, error } = await runClaude(jobDir, job.alias, job.thinkingTokens);
    if (error) { if (attempt === 2) return { ok: false, id: job.id, error }; continue; }
    await writeFile(join(jobDir, 'response.json'), JSON.stringify(wrapper, null, 2));
    try {
      const usage = wrapper.modelUsage || {};
      const webSearches = Object.values(usage).reduce((total, item) => total + (item.webSearchRequests || 0), 0);
      if (webSearches) throw new Error(`${job.id}: reported ${webSearches} web searches.`);
      const actualVersion = Object.keys(usage).find((v) => v.includes(`-${job.alias}-`)) || Object.keys(usage).at(-1) || job.alias;
      const wagers = validate(extractArray(wrapper.result), job.id);
      return {
        ok: true, id: job.id,
        run: {
          id: job.id, model: job.name, modelVersion: actualVersion, reasoningEffort: job.reasoning,
          promptVersion, publisher: 'Claude Code 2.1.206',
          notes:
            'Isolated ephemeral directory outside the repo; all built-in tools disabled; empty strict MCP config; ' +
            `no result data supplied; MAX_THINKING_TOKENS=${job.thinkingTokens}; telemetry confirmed zero web searches.`,
          createdAt: new Date().toISOString(), wagers,
        },
      };
    } catch (cause) { if (attempt === 2) return { ok: false, id: job.id, error: cause.message }; }
  }
  return { ok: false, id: job.id, error: 'exhausted retries' };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const jobs = [];
  for (const [alias, name] of models) {
    if (modelFilter && alias !== modelFilter) continue;
    for (const [reasoning, thinkingTokens] of reasoningLevels) {
      if (reasoningFilter && reasoning !== reasoningFilter) continue;
      for (let n = 1; n <= runsPerCell; n += 1) {
        jobs.push({ id: `claude-${alias}-${reasoning}-profit-run${n}`, alias, name, reasoning, thinkingTokens });
      }
    }
  }
  console.log(`Running ${jobs.length} isolated profit jobs (${runsPerCell}/cell, concurrency ${concurrency})…`);

  const results = [];
  let cursor = 0, done = 0;
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

main().catch((error) => { console.error(error); process.exit(1); });
