import type { EvaluationRun } from '../types';

const KEY = 'touchline-evaluation-runs-v2';

export function loadRuns(): EvaluationRun[] {
  try {
    const stored = localStorage.getItem(KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveRuns(runs: EvaluationRun[]) {
  localStorage.setItem(KEY, JSON.stringify(runs));
}
