export type Outcome = 'H' | 'D' | 'A';
export type OddsSource = 'bet365' | 'betfairExchange' | 'marketAverage' | 'marketBest';

export interface OddsLine {
  home: number;
  draw: number;
  away: number;
}

export interface Match {
  id: string;
  group: string;
  kickoff: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  odds: Record<OddsSource, OddsLine>;
}

export interface Prediction {
  matchId: string;
  outcome: Outcome;
}

export interface EvaluationRun {
  id: string;
  model: string;
  oddsSource: OddsSource;
  createdAt: string;
  predictions: Prediction[];
  notes?: string;
  modelVersion?: string;
  reasoningEffort?: string;
  promptVersion?: string;
  publisher?: string;
  publishedAt?: string;
}

export interface ModelSummary {
  model: string;
  reasoningEffort: string;
  runs: number;
  predictions: number;
  averageAccuracy: number;
  averageRoi: number;
  bestRoi: number;
  bestRunId: string;
}

export interface ModelFamilySummary {
  model: string;
  runs: number;
  predictions: number;
  averageAccuracy: number;
  averageRoi: number;
  bestRoi: number;
  bestRunId: string;
  reasoningLevels: ModelSummary[];
}

export interface SettledPrediction {
  match: Match;
  predicted: Outcome;
  actual: Outcome;
  odds: number;
  correct: boolean;
  pnl: number;
  cumulativePnl: number;
}

export interface RunMetrics {
  settled: SettledPrediction[];
  matches: number;
  correct: number;
  accuracy: number;
  totalPnl: number;
  roi: number;
  averageOdds: number;
  longestWinStreak: number;
}
