import type {
  EvaluationMode,
  EvaluationRun,
  Match,
  OddsLine,
  OddsSource,
  Outcome,
  Prediction,
  RunMetrics,
  SettledPrediction,
} from '../types';

export const OUTCOME_LABELS: Record<Outcome, string> = {
  H: 'Home win',
  D: 'Draw',
  A: 'Away win',
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
    const { matchId, outcome } = item as Record<string, unknown>;
    if (typeof matchId !== 'string' || !validIds.has(matchId)) {
      throw new Error(`Prediction ${index + 1} has an unknown matchId.`);
    }
    if (outcome !== 'H' && outcome !== 'D' && outcome !== 'A') {
      throw new Error(`Prediction ${index + 1} outcome must be H, D, or A.`);
    }
    if (seen.has(matchId)) throw new Error(`Duplicate prediction for ${matchId}.`);
    seen.add(matchId);
    return { matchId, outcome };
  });
}

export function buildPrompt(matches: Match[], mode: EvaluationMode, oddsSource: OddsSource): string {
  const fixtures = matches.map((match) => ({
    matchId: match.id,
    group: match.group,
    kickoff: match.kickoff,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    ...(mode === 'odds-visible' ? { closingOdds: match.odds[oddsSource] } : {}),
  }));

  return [
    'Predict the 90-minute result of every listed 2026 FIFA World Cup group-stage match.',
    'For each match choose exactly one outcome: H (home win), D (draw), or A (away win).',
    'Return only a valid JSON array in this exact shape:',
    '[{"matchId":"2026-A-01","outcome":"H"}]',
    `Evaluation mode: ${mode}.`,
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
