import type {
  Bet,
  EvaluationRun,
  Match,
  ModelFamilySummary,
  ModelSummary,
  Outcome,
  OutcomeProbs,
  OddsSource,
  RunMetrics,
  SettledWager,
  Wager,
} from '../types';

export const STARTING_BANKROLL = 100;
export const MAX_STAKE = 10;
const ODDS_FEEDS: OddsSource[] = ['bet365', 'betfairExchange', 'marketAverage', 'marketBest'];

export const OUTCOME_LABELS: Record<Outcome, string> = { H: 'Home', D: 'Draw', A: 'Away' };
export const BET_LABELS: Record<Bet, string> = { H: 'Home', D: 'Draw', A: 'Away', PASS: 'Pass' };

export function actualOutcome(match: Match): Outcome {
  if (match.homeGoals > match.awayGoals) return 'H';
  if (match.homeGoals < match.awayGoals) return 'A';
  return 'D';
}

const priceForOutcome = (line: { home: number; draw: number; away: number }, outcome: Outcome): number =>
  outcome === 'H' ? line.home : outcome === 'D' ? line.draw : line.away;

// Line shopping: the best (highest) decimal price available across every feed for the chosen side.
export function bestOdds(match: Match, outcome: Outcome): number {
  return Math.max(...ODDS_FEEDS.map((feed) => priceForOutcome(match.odds[feed], outcome)));
}

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

// The whole bankroll must be deployed. Scale the model's stakes so they sum to the
// bankroll: over-budget allocations shrink proportionally; under-budget ones grow
// (water-filling, respecting the per-match cap). PASS / £0 matches never receive money.
// If fewer than BANKROLL/MAX_STAKE matches are backed, the full budget cannot be
// reached — the shortfall is the model's own under-diversification and is left idle.
export function fitStakesToBudget(stakes: number[], budget = STARTING_BANKROLL, cap = MAX_STAKE): number[] {
  const s = stakes.map((value) => Math.max(0, Math.min(cap, Number.isFinite(value) ? value : 0)));
  const total = s.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return s;
  if (total > budget) return s.map((value) => round2((value * budget) / total));
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const current = s.reduce((sum, value) => sum + value, 0);
    if (budget - current < 1e-6) break;
    const fixed = s.reduce((sum, value) => sum + (value >= cap - 1e-9 ? value : 0), 0);
    const freeIdx = s.map((value, index) => (value > 0 && value < cap - 1e-9 ? index : -1)).filter((index) => index >= 0);
    const freeSum = freeIdx.reduce((sum, index) => sum + s[index], 0);
    if (!freeIdx.length || freeSum <= 0) break;
    const factor = (budget - fixed) / freeSum;
    if (factor <= 1 + 1e-9) break;
    for (const index of freeIdx) s[index] = Math.min(cap, s[index] * factor);
  }
  return s.map(round2);
}

export function settleWager(match: Match, wager: Wager) {
  const actual = actualOutcome(match);
  if (wager.bet === 'PASS' || wager.stake <= 0) {
    return { actual, odds: 0, impliedProb: 0, edge: 0, isValue: false, won: false, pnl: 0 };
  }
  const odds = bestOdds(match, wager.bet);
  const impliedProb = 1 / odds;
  const modelProb = wager.probs[wager.bet];
  const edge = modelProb - impliedProb;
  const won = wager.bet === actual;
  return {
    actual,
    odds,
    impliedProb,
    edge,
    isValue: modelProb * odds > 1,
    won,
    pnl: round2(won ? wager.stake * (odds - 1) : -wager.stake),
  };
}

function brierScore(probs: OutcomeProbs, actual: Outcome): number {
  return (['H', 'D', 'A'] as Outcome[]).reduce((sum, outcome) => {
    const indicator = outcome === actual ? 1 : 0;
    return sum + (probs[outcome] - indicator) ** 2;
  }, 0);
}

export function evaluateRun(run: EvaluationRun, matches: Match[]): RunMetrics {
  const byId = new Map(matches.map((match) => [match.id, match]));
  const scored = run.wagers.filter((wager) => byId.has(wager.matchId));
  // Deploy the whole bankroll across the backed matches.
  const stakes = fitStakesToBudget(scored.map((wager) => (wager.bet === 'PASS' ? 0 : wager.stake)));

  let cumulativePnl = 0;
  let currentWinStreak = 0;
  let longestWinStreak = 0;
  let brierSum = 0;
  let brierCount = 0;

  const settled = scored.reduce<SettledWager[]>((rows, wager, index) => {
    const match = byId.get(wager.matchId)!;
    const staked = { ...wager, stake: stakes[index] };
    const result = settleWager(match, staked);
    cumulativePnl = round2(cumulativePnl + result.pnl);
    if (staked.bet !== 'PASS' && staked.stake > 0) {
      currentWinStreak = result.won ? currentWinStreak + 1 : 0;
      longestWinStreak = Math.max(longestWinStreak, currentWinStreak);
    }
    if (wager.probs) {
      brierSum += brierScore(wager.probs, result.actual);
      brierCount += 1;
    }
    rows.push({ match, bet: staked.bet, stake: staked.stake, probs: wager.probs, ...result, cumulativePnl });
    return rows;
  }, []);

  const placed = settled.filter((row) => row.bet !== 'PASS' && row.stake > 0);
  const totalStaked = round2(placed.reduce((sum, row) => sum + row.stake, 0));
  const totalPnl = round2(settled.reduce((sum, row) => sum + row.pnl, 0));
  const wins = placed.filter((row) => row.won).length;

  return {
    settled,
    matches: settled.length,
    betsPlaced: placed.length,
    passes: settled.length - placed.length,
    totalStaked,
    totalPnl,
    startingBankroll: STARTING_BANKROLL,
    finalBankroll: round2(STARTING_BANKROLL + totalPnl),
    roiTurnover: totalStaked ? totalPnl / totalStaked : 0,
    returnOnBankroll: totalPnl / STARTING_BANKROLL,
    hitRate: placed.length ? wins / placed.length : 0,
    averageStake: placed.length ? totalStaked / placed.length : 0,
    averageOdds: placed.length ? placed.reduce((sum, row) => sum + row.odds, 0) / placed.length : 0,
    valueBets: placed.filter((row) => row.isValue).length,
    brier: brierCount ? brierSum / brierCount : 0,
    longestWinStreak,
  };
}

const OUTCOME_ALIAS: Record<string, Bet> = {
  H: 'H', D: 'D', A: 'A', PASS: 'PASS',
  WIN: 'H', DRAW: 'D', LOSS: 'A', HOME: 'H', AWAY: 'A', NONE: 'PASS', SKIP: 'PASS',
};

function coerceProbs(input: unknown): OutcomeProbs {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const read = (...keys: string[]): number => {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return 0;
  };
  let H = read('H', 'home', 'WIN', 'win');
  let D = read('D', 'draw', 'DRAW');
  let A = read('A', 'away', 'LOSS', 'loss');
  const total = H + D + A;
  if (total > 0) { H /= total; D /= total; A /= total; } // normalise to a distribution
  return { H, D, A };
}

export function validateWagers(input: unknown, matches: Match[]): Wager[] {
  if (!Array.isArray(input)) throw new Error('Wagers must be a JSON array.');
  const validIds = new Set(matches.map((match) => match.id));
  const seen = new Set<string>();
  return input.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`Wager ${index + 1} is not an object.`);
    const { matchId, bet: rawBet, outcome, stake: rawStake, probs, probabilities } = item as Record<string, unknown>;
    if (typeof matchId !== 'string' || !validIds.has(matchId)) throw new Error(`Wager ${index + 1} has an unknown matchId.`);
    if (seen.has(matchId)) throw new Error(`Duplicate wager for ${matchId}.`);
    seen.add(matchId);

    const bet = OUTCOME_ALIAS[String(rawBet ?? outcome ?? 'PASS').toUpperCase()];
    if (!bet) throw new Error(`Wager ${index + 1} bet must be H, D, A, or PASS.`);

    let stake = typeof rawStake === 'number' && Number.isFinite(rawStake) ? rawStake : 0;
    stake = Math.max(0, Math.min(MAX_STAKE, round2(stake)));
    if (bet === 'PASS') stake = 0;

    return { matchId, bet, stake, probs: coerceProbs(probs ?? probabilities) };
  });
}

export function buildProfitPrompt(matches: Match[]): string {
  const fixtures = matches.map((match) => ({
    matchId: match.id,
    group: match.group,
    kickoff: match.kickoff,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    // Show every feed so the model can see the best obtainable price per side.
    closingOdds: {
      bet365: match.odds.bet365,
      betfairExchange: match.odds.betfairExchange,
      marketAverage: match.odds.marketAverage,
      bestAvailable: {
        home: bestOdds(match, 'H'),
        draw: bestOdds(match, 'D'),
        away: bestOdds(match, 'A'),
      },
    },
  }));

  return [
    'ROLE: You are a professional football bettor. Your only objective is to MAXIMISE PROFIT — not accuracy.',
    '',
    'RULES OF THE GAME:',
    `- You have a £${STARTING_BANKROLL} bankroll to allocate across the 72 group-stage matches of the 2026 FIFA World Cup.`,
    `- For each match you may back the HOME win (H), DRAW (D), or AWAY win (A), or PASS (no bet).`,
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
}

// A reference bettor: flat MAX_STAKE on the best-priced favourite in every match.
// Shows what blindly backing favourites (even with line shopping) yields against the margin.
export function favouriteBaselineWagers(matches: Match[]): Wager[] {
  return matches.map((match) => {
    const best = { H: bestOdds(match, 'H'), D: bestOdds(match, 'D'), A: bestOdds(match, 'A') };
    const shortest = Math.min(best.H, best.D, best.A);
    const bet: Bet = best.H === shortest ? 'H' : best.D === shortest ? 'D' : 'A';
    const implied = { H: 1 / best.H, D: 1 / best.D, A: 1 / best.A };
    const total = implied.H + implied.D + implied.A;
    return {
      matchId: match.id,
      bet,
      stake: MAX_STAKE,
      probs: { H: implied.H / total, D: implied.D / total, A: implied.A / total },
    };
  });
}

const reasoningLabel = (run: EvaluationRun) => run.reasoningEffort?.trim() || 'unspecified';
const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

function summariseRuns(runs: EvaluationRun[], matches: Match[]) {
  const evaluated = runs.map((run) => ({ run, metrics: evaluateRun(run, matches) }));
  const best = [...evaluated].sort((a, b) => b.metrics.totalPnl - a.metrics.totalPnl)[0];
  return {
    runs: runs.length,
    betsPlaced: evaluated.reduce((sum, item) => sum + item.metrics.betsPlaced, 0),
    averagePnl: mean(evaluated.map(({ metrics }) => metrics.totalPnl)),
    averageRoi: mean(evaluated.map(({ metrics }) => metrics.returnOnBankroll)),
    averageBrier: mean(evaluated.map(({ metrics }) => metrics.brier)),
    bestPnl: best.metrics.totalPnl,
    bestRunId: best.run.id,
  };
}

export function aggregateModels(runs: EvaluationRun[], matches: Match[]): ModelSummary[] {
  const grouped = new Map<string, EvaluationRun[]>();
  for (const run of runs) {
    const key = `${run.model} ${reasoningLabel(run)}`;
    grouped.set(key, [...(grouped.get(key) ?? []), run]);
  }
  return [...grouped.values()].map((modelRuns) => ({
    model: modelRuns[0].model,
    reasoningEffort: reasoningLabel(modelRuns[0]),
    ...summariseRuns(modelRuns, matches),
  })).sort((a, b) => b.averagePnl - a.averagePnl);
}

export function aggregateModelFamilies(runs: EvaluationRun[], matches: Match[]): ModelFamilySummary[] {
  const grouped = new Map<string, EvaluationRun[]>();
  for (const run of runs) grouped.set(run.model, [...(grouped.get(run.model) ?? []), run]);
  return [...grouped.values()].map((familyRuns) => ({
    model: familyRuns[0].model,
    ...summariseRuns(familyRuns, matches),
    reasoningLevels: aggregateModels(familyRuns, matches),
  })).sort((a, b) => b.averagePnl - a.averagePnl);
}
