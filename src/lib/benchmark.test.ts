import { describe, expect, it } from 'vitest';
import { aggregateModelFamilies, aggregateModels, buildPrompt, evaluateRun, settlePrediction, validatePredictions } from './benchmark';
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
    const run: EvaluationRun = { id: 'run', model: 'test', oddsSource: 'bet365', createdAt: '', predictions: [{ matchId: match.id, outcome: 'H' }] };
    expect(evaluateRun(run, [match])).toMatchObject({ matches: 1, correct: 1, accuracy: 1, totalPnl: 0.42, roi: 0.42 });
  });
});

describe('benchmark inputs', () => {
  it('rejects duplicate or invalid predictions', () => {
    expect(() => validatePredictions([{ matchId: match.id, outcome: 'X' }], [match])).toThrow('WIN, DRAW, or LOSS');
    expect(validatePredictions([{ matchId: match.id, outcome: 'WIN' }], [match])).toEqual([{ matchId: match.id, outcome: 'H' }]);
    expect(validatePredictions([{ matchId: match.id, outcome: 'LOSS' }], [match])).toEqual([{ matchId: match.id, outcome: 'A' }]);
    expect(() => validatePredictions([{ matchId: match.id, outcome: 'WIN' }, { matchId: match.id, outcome: 'DRAW' }], [match])).toThrow('Duplicate');
  });

  it('always includes odds without leaking the actual result', () => {
    const prompt = buildPrompt([match], 'bet365');
    expect(prompt).toContain('Do not browse the web');
    expect(prompt).toContain('Do not look up or reveal actual match results');
    expect(prompt).toContain('before 11 June 2026');
    expect(prompt).not.toContain('homeGoals');
    expect(prompt).toContain('closingOdds');
    expect(prompt).toContain('1.42');
    expect(prompt).toContain('WIN, DRAW, or LOSS');
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

describe('model comparison', () => {
  it('aggregates repeated runs by model', () => {
    const first: EvaluationRun = { id: 'a', model: 'Model A', reasoningEffort: 'low', oddsSource: 'bet365', createdAt: '', predictions: [{ matchId: match.id, outcome: 'H' }] };
    const second: EvaluationRun = { ...first, id: 'b', predictions: [{ matchId: match.id, outcome: 'D' }] };
    const [summary] = aggregateModels([first, second], [match]);
    expect(summary).toMatchObject({ model: 'Model A', reasoningEffort: 'low', runs: 2, predictions: 2, bestRoi: 0.42, bestRunId: 'a' });
    expect(summary.averageRoi).toBeCloseTo(-0.29);
  });

  it('separates reasoning levels for the same model', () => {
    const low: EvaluationRun = { id: 'low', model: 'Model A', reasoningEffort: 'low', oddsSource: 'bet365', createdAt: '', predictions: [{ matchId: match.id, outcome: 'H' }] };
    const high: EvaluationRun = { ...low, id: 'high', reasoningEffort: 'high', predictions: [{ matchId: match.id, outcome: 'D' }] };
    const summaries = aggregateModels([low, high], [match]);
    expect(summaries).toHaveLength(2);
    expect(summaries.map((item) => `${item.model}/${item.reasoningEffort}`).sort()).toEqual(['Model A/high', 'Model A/low']);
  });

  it('groups reasoning levels under one model family', () => {
    const low: EvaluationRun = { id: 'low', model: 'Model A', reasoningEffort: 'low', oddsSource: 'bet365', createdAt: '', predictions: [{ matchId: match.id, outcome: 'H' }] };
    const high: EvaluationRun = { ...low, id: 'high', reasoningEffort: 'high', predictions: [{ matchId: match.id, outcome: 'D' }] };
    const other: EvaluationRun = { ...low, id: 'other', model: 'Model B', reasoningEffort: 'low', predictions: [{ matchId: match.id, outcome: 'H' }] };
    const families = aggregateModelFamilies([low, high, other], [match]);
    expect(families.map((item) => item.model).sort()).toEqual(['Model A', 'Model B']);
    const familyA = families.find((item) => item.model === 'Model A')!;
    expect(familyA.runs).toBe(2);
    expect(familyA.reasoningLevels.map((level) => level.reasoningEffort).sort()).toEqual(['high', 'low']);
    // best-performing reasoning level is listed first
    expect(familyA.reasoningLevels[0].reasoningEffort).toBe('low');
    expect(familyA.bestRoi).toBeCloseTo(0.42);
  });
});
