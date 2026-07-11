import { describe, expect, it } from 'vitest';
import {
  aggregateModelFamilies,
  aggregateModels,
  bestOdds,
  buildProfitPrompt,
  evaluateRun,
  settleWager,
  validateWagers,
} from './benchmark';
import type { EvaluationRun, Match } from '../types';
import dataset from '../data/matches.json';

const match: Match = {
  id: '2026-A-01', group: 'A', kickoff: '2026-06-11T20:00:00Z', homeTeam: 'Mexico', awayTeam: 'South Africa',
  homeGoals: 2, awayGoals: 0, // actual outcome = H
  odds: {
    bet365: { home: 1.42, draw: 4.33, away: 8.5 },
    betfairExchange: { home: 1.45, draw: 4.6, away: 9.6 },
    marketAverage: { home: 1.41, draw: 4.33, away: 8.26 },
    marketBest: { home: 1.44, draw: 4.5, away: 9.1 },
  },
};

const probs = { H: 0.7, D: 0.2, A: 0.1 };

describe('line shopping', () => {
  it('takes the best price across every feed', () => {
    expect(bestOdds(match, 'H')).toBe(1.45);
    expect(bestOdds(match, 'D')).toBe(4.6);
    expect(bestOdds(match, 'A')).toBe(9.6);
  });
});

describe('settlement', () => {
  it('pays a winning stake at the best available price', () => {
    expect(settleWager(match, { matchId: match.id, bet: 'H', stake: 10, probs })).toMatchObject({
      won: true, odds: 1.45, pnl: 4.5,
    });
  });

  it('loses the stake on a losing bet', () => {
    expect(settleWager(match, { matchId: match.id, bet: 'A', stake: 6, probs })).toMatchObject({ won: false, pnl: -6 });
  });

  it('stakes nothing and returns zero P&L on a PASS', () => {
    expect(settleWager(match, { matchId: match.id, bet: 'PASS', stake: 0, probs })).toMatchObject({ pnl: 0, odds: 0 });
  });

  it('flags a value bet when model prob beats the implied price', () => {
    // Away implied = 1/9.6 ≈ 0.104; model says 0.2 → value.
    const value = settleWager(match, { matchId: match.id, bet: 'A', stake: 5, probs: { H: 0.5, D: 0.3, A: 0.2 } });
    expect(value.isValue).toBe(true);
    // Home implied = 1/1.45 ≈ 0.69; model says 0.5 → not value.
    const noValue = settleWager(match, { matchId: match.id, bet: 'H', stake: 5, probs: { H: 0.5, D: 0.3, A: 0.2 } });
    expect(noValue.isValue).toBe(false);
  });
});

describe('run metrics', () => {
  it('aggregates P&L, turnover ROI, passes, and Brier', () => {
    const run: EvaluationRun = {
      id: 'run', model: 'test', createdAt: '', wagers: [
        { matchId: match.id, bet: 'H', stake: 10, probs: { H: 1, D: 0, A: 0 } }, // wins 4.5, perfect Brier 0
      ],
    };
    const metrics = evaluateRun(run, [match]);
    expect(metrics).toMatchObject({ betsPlaced: 1, passes: 0, totalStaked: 10, totalPnl: 4.5, finalBankroll: 104.5 });
    expect(metrics.roiTurnover).toBeCloseTo(0.45);
    expect(metrics.brier).toBeCloseTo(0);
    expect(metrics.hitRate).toBe(1);
  });

  it('counts PASS decisions without staking', () => {
    const run: EvaluationRun = {
      id: 'r', model: 'test', createdAt: '', wagers: [{ matchId: match.id, bet: 'PASS', stake: 0, probs }],
    };
    expect(evaluateRun(run, [match])).toMatchObject({ betsPlaced: 0, passes: 1, totalStaked: 0, totalPnl: 0 });
  });

  it('deploys the full £100 bankroll across many bets (stakes normalised to 100)', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}`, group: 'A', kickoff: '', homeTeam: `H${i}`, awayTeam: `A${i}`,
      homeGoals: 1, awayGoals: 0, // home wins each
      odds: match.odds,
    }));
    const run: EvaluationRun = {
      id: 'r', model: 'test', createdAt: '',
      // model asks for £10 on all 20 (=£200); must be scaled to £100 total.
      wagers: many.map((m) => ({ matchId: m.id, bet: 'H' as const, stake: 10, probs: { H: 1, D: 0, A: 0 } })),
    };
    const metrics = evaluateRun(run, many);
    expect(metrics.totalStaked).toBeCloseTo(100, 1);
    expect(metrics.betsPlaced).toBe(20);
  });
});

describe('wager validation', () => {
  it('clamps stakes, defaults probs, and maps aliases', () => {
    const [wager] = validateWagers([{ matchId: match.id, bet: 'WIN', stake: 999, probs: { H: 2, D: 1, A: 1 } }], [match]);
    expect(wager.bet).toBe('H');
    expect(wager.stake).toBe(10); // clamped to MAX_STAKE
    expect(wager.probs.H).toBeCloseTo(0.5); // normalised 2/(2+1+1)
  });

  it('forces PASS stakes to zero and rejects unknown matches', () => {
    const [wager] = validateWagers([{ matchId: match.id, bet: 'PASS', stake: 5, probs }], [match]);
    expect(wager.stake).toBe(0);
    expect(() => validateWagers([{ matchId: 'nope', bet: 'H', stake: 1, probs }], [match])).toThrow('unknown matchId');
  });
});

describe('profit prompt', () => {
  it('frames a profit objective and never leaks results', () => {
    const prompt = buildProfitPrompt([match]);
    expect(prompt).toContain('MAXIMISE PROFIT');
    expect(prompt).toContain('value bet');
    expect(prompt).toContain('PASS');
    expect(prompt).toContain('bestAvailable');
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
});

describe('model aggregation', () => {
  const mk = (id: string, model: string, reasoning: string, bet: 'H' | 'A', stake: number): EvaluationRun => ({
    id, model, reasoningEffort: reasoning, createdAt: '', wagers: [{ matchId: match.id, bet, stake, probs }],
  });

  it('ranks reasoning cohorts by average P&L', () => {
    const summaries = aggregateModels([mk('a', 'M', 'low', 'H', 10), mk('b', 'M', 'high', 'A', 10)], [match]);
    expect(summaries).toHaveLength(2);
    expect(summaries[0].averagePnl).toBeGreaterThan(summaries[1].averagePnl); // low (win) ranks above high (loss)
  });

  it('groups reasoning levels under one model family', () => {
    const families = aggregateModelFamilies(
      [mk('a', 'M', 'low', 'H', 10), mk('b', 'M', 'high', 'A', 10), mk('c', 'N', 'low', 'H', 10)],
      [match],
    );
    expect(families.map((f) => f.model).sort()).toEqual(['M', 'N']);
    const familyM = families.find((f) => f.model === 'M')!;
    expect(familyM.runs).toBe(2);
    expect(familyM.reasoningLevels.map((l) => l.reasoningEffort).sort()).toEqual(['high', 'low']);
  });
});
