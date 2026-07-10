import { describe, expect, it } from 'vitest';
import { buildPrompt, evaluateRun, settlePrediction, validatePredictions } from './benchmark';
import type { EvaluationRun, Match } from '../types';
import dataset from '../data/matches.json';

const match: Match = {
  id: '2026-A-01', group: 'A', kickoff: '2026-06-11T20:00:00Z', homeTeam: 'Mexico', awayTeam: 'South Africa',
  homeGoals: 2, awayGoals: 0,
  odds: {
    bet365: { home: 1.42, draw: 4.33, away: 8.5 },
    betfairExchange: { home: 1.45, draw: 4.6, away: 9.6 },
    marketAverage: { home: 1.41, draw: 4.33, away: 8.26 },
    marketBest: { home: 1.44, draw: 4.5, away: 9.1 },
  },
};

describe('settlement', () => {
  it('returns net profit for a winning £1 bet', () => {
    expect(settlePrediction(match, 'H', 'bet365')).toMatchObject({ correct: true, odds: 1.42, pnl: 0.42 });
  });

  it('loses the £1 stake for an incorrect result', () => {
    expect(settlePrediction(match, 'D', 'bet365')).toMatchObject({ correct: false, pnl: -1 });
  });

  it('aggregates accuracy, ROI, and P&L', () => {
    const run: EvaluationRun = { id: 'run', model: 'test', mode: 'blind', oddsSource: 'bet365', createdAt: '', predictions: [{ matchId: match.id, outcome: 'H' }] };
    expect(evaluateRun(run, [match])).toMatchObject({ matches: 1, correct: 1, accuracy: 1, totalPnl: 0.42, roi: 0.42 });
  });
});

describe('benchmark inputs', () => {
  it('rejects duplicate or invalid predictions', () => {
    expect(() => validatePredictions([{ matchId: match.id, outcome: 'X' }], [match])).toThrow('H, D, or A');
    expect(() => validatePredictions([{ matchId: match.id, outcome: 'H' }, { matchId: match.id, outcome: 'D' }], [match])).toThrow('Duplicate');
  });

  it('does not leak outcomes or odds in blind prompts', () => {
    const prompt = buildPrompt([match], 'blind', 'bet365');
    expect(prompt).not.toContain('homeGoals');
    expect(prompt).not.toContain('closingOdds');
    expect(prompt).not.toContain('1.42');
  });

  it('includes the selected close in odds-visible prompts without results', () => {
    const prompt = buildPrompt([match], 'odds-visible', 'bet365');
    expect(prompt).toContain('closingOdds');
    expect(prompt).toContain('1.42');
    expect(prompt).not.toContain('homeGoals');
  });
});

describe('locked 2026 dataset', () => {
  const worldCupMatches = dataset as Match[];

  it('contains 72 unique group-stage fixtures, six per group', () => {
    expect(worldCupMatches).toHaveLength(72);
    expect(new Set(worldCupMatches.map((item) => item.id)).size).toBe(72);
    for (const group of 'ABCDEFGHIJKL') {
      expect(worldCupMatches.filter((item) => item.group === group)).toHaveLength(6);
    }
  });

  it('has complete, valid decimal prices for every settlement feed', () => {
    for (const item of worldCupMatches) {
      for (const line of Object.values(item.odds)) {
        expect(line.home).toBeGreaterThan(1);
        expect(line.draw).toBeGreaterThan(1);
        expect(line.away).toBeGreaterThan(1);
      }
    }
  });
});
