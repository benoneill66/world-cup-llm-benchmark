import type {
  EvaluationRun,
  Match,
  ModelFamilySummary,
  ModelSummary,
  OddsLine,
  OddsSource,
  Outcome,
  Prediction,
  RunMetrics,
  SettledPrediction,
} from '../types';

export const OUTCOME_LABELS: Record<Outcome, string> = {
  H: 'Win',
  D: 'Draw',
  A: 'Loss',
};

export const ODDS_SOURCE_LABELS: Record<OddsSource, string> = {
  bet365: 'Bet365 close',
  betfairExchange: 'Betfair Exchange close',
  marketAverage: 'Market average close',
  marketBest: 'Best market close',
};

export function actualOutcome(match: Match): Outcome {
  if (match.homeGoals > match.awayGoals) return 'H';
  if (match.homeGoals < match.awayGoals) return 'A';
  return 'D';
}

export function selectedOdds(line: OddsLine, outcome: Outcome): number {
  if (outcome === 'H') return line.home;
  if (outcome === 'D') return line.draw;
  return line.away;
}

function toPennies(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function settlePrediction(match: Match, prediction: Outcome, oddsSource: OddsSource) {
  const actual = actualOutcome(match);
  const odds = selectedOdds(match.odds[oddsSource], prediction);
  const correct = prediction === actual;
  return { actual, odds, correct, pnl: correct ? toPennies(odds - 1) : -1 };
}

export function evaluateRun(run: EvaluationRun, matches: Match[]): RunMetrics {
  const byId = new Map(matches.map((match) => [match.id, match]));
  let cumulativePnl = 0;
  let longestWinStreak = 0;
  let currentWinStreak = 0;

  const settled = run.predictions.reduce<SettledPrediction[]>((rows, prediction) => {
    const match = byId.get(prediction.matchId);
    if (!match) return rows;
    const result = settlePrediction(match, prediction.outcome, run.oddsSource);
    cumulativePnl = toPennies(cumulativePnl + result.pnl);
    currentWinStreak = result.correct ? currentWinStreak + 1 : 0;
    longestWinStreak = Math.max(longestWinStreak, currentWinStreak);
    rows.push({
      match,
      predicted: prediction.outcome,
      ...result,
      cumulativePnl,
    });
    return rows;
  }, []);

  const correct = settled.filter((row) => row.correct).length;
  const totalPnl = toPennies(settled.reduce((sum, row) => sum + row.pnl, 0));
  const averageOdds = settled.length
    ? settled.reduce((sum, row) => sum + row.odds, 0) / settled.length
    : 0;

  return {
    settled,
    matches: settled.length,
    correct,
    accuracy: settled.length ? correct / settled.length : 0,
    totalPnl,
    roi: settled.length ? totalPnl / settled.length : 0,
    averageOdds,
    longestWinStreak,
  };
}

export function validatePredictions(input: unknown, matches: Match[]): Prediction[] {
  if (!Array.isArray(input)) throw new Error('Predictions must be a JSON array.');
  const validIds = new Set(matches.map((match) => match.id));
  const seen = new Set<string>();
  return input.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`Prediction ${index + 1} is not an object.`);
    const { matchId, outcome: inputOutcome } = item as Record<string, unknown>;
    if (typeof matchId !== 'string' || !validIds.has(matchId)) {
      throw new Error(`Prediction ${index + 1} has an unknown matchId.`);
    }
    const outcome = inputOutcome === 'WIN' ? 'H' : inputOutcome === 'DRAW' ? 'D' : inputOutcome === 'LOSS' ? 'A' : inputOutcome;
    if (outcome !== 'H' && outcome !== 'D' && outcome !== 'A') throw new Error(`Prediction ${index + 1} outcome must be WIN, DRAW, or LOSS.`);
    if (seen.has(matchId)) throw new Error(`Duplicate prediction for ${matchId}.`);
    seen.add(matchId);
    return { matchId, outcome };
  });
}

export function buildPrompt(matches: Match[], oddsSource: OddsSource): string {
  const fixtures = matches.map((match) => ({
    matchId: match.id,
    group: match.group,
    kickoff: match.kickoff,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    closingOdds: match.odds[oddsSource],
  }));

  return [
    'IMPORTANT EVALUATION RULES:',
    '- Treat every fixture as not yet played.',
    '- Do not browse the web, search for information, call tools, use retrieval, or access any external source.',
    '- Do not look up or reveal actual match results. If you recognise or remember a result, ignore that knowledge and make a pre-match prediction instead.',
    '- Base your answer only on the fixture information below and football knowledge available before 11 June 2026.',
    '',
    'Predict the 90-minute result of every listed 2026 FIFA World Cup group-stage match.',
    'For each match choose exactly one outcome from the home team perspective: WIN, DRAW, or LOSS.',
    'WIN means the listed home team wins; LOSS means the listed home team loses and the away team wins.',
    'Return only a valid JSON array in this exact shape:',
    '[{"matchId":"2026-A-01","outcome":"WIN"}]',
    '',
    JSON.stringify(fixtures, null, 2),
  ].join('\n');
}

export function favouritePredictions(matches: Match[], oddsSource: OddsSource): Prediction[] {
  return matches.map((match) => {
    const line = match.odds[oddsSource];
    const lowest = Math.min(line.home, line.draw, line.away);
    const outcome: Outcome = line.home === lowest ? 'H' : line.draw === lowest ? 'D' : 'A';
    return { matchId: match.id, outcome };
  });
}

const reasoningLabel = (run: EvaluationRun) => run.reasoningEffort?.trim() || 'unspecified';
const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

function summariseRuns(runs: EvaluationRun[], matches: Match[]) {
  const evaluated = runs.map((run) => ({ run, metrics: evaluateRun(run, matches) }));
  const best = [...evaluated].sort((a, b) => b.metrics.roi - a.metrics.roi)[0];
  return {
    runs: runs.length,
    predictions: evaluated.reduce((sum, item) => sum + item.metrics.matches, 0),
    averageAccuracy: mean(evaluated.map(({ metrics }) => metrics.accuracy)),
    averageRoi: mean(evaluated.map(({ metrics }) => metrics.roi)),
    bestRoi: best.metrics.roi,
    bestRunId: best.run.id,
  };
}

export function aggregateModels(runs: EvaluationRun[], matches: Match[]): ModelSummary[] {
  const grouped = new Map<string, EvaluationRun[]>();
  for (const run of runs) {
    const key = `${run.model}\u0000${reasoningLabel(run)}`;
    grouped.set(key, [...(grouped.get(key) ?? []), run]);
  }

  return [...grouped.values()].map((modelRuns) => ({
    model: modelRuns[0].model,
    reasoningEffort: reasoningLabel(modelRuns[0]),
    ...summariseRuns(modelRuns, matches),
  })).sort((a, b) => b.averageRoi - a.averageRoi);
}

export function aggregateModelFamilies(runs: EvaluationRun[], matches: Match[]): ModelFamilySummary[] {
  const grouped = new Map<string, EvaluationRun[]>();
  for (const run of runs) grouped.set(run.model, [...(grouped.get(run.model) ?? []), run]);

  return [...grouped.values()].map((familyRuns) => ({
    model: familyRuns[0].model,
    ...summariseRuns(familyRuns, matches),
    reasoningLevels: aggregateModels(familyRuns, matches),
  })).sort((a, b) => b.averageRoi - a.averageRoi);
}
