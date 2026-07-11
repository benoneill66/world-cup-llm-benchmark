export type Outcome = 'H' | 'D' | 'A';
export type Bet = Outcome | 'PASS';
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

export interface OutcomeProbs {
  H: number;
  D: number;
  A: number;
}

// A single match decision in the profit benchmark: which side to back (or PASS),
// how much to stake (0..MAX_STAKE), and the model's own probability estimate.
export interface Wager {
  matchId: string;
  bet: Bet;
  stake: number;
  probs: OutcomeProbs;
}

export interface EvaluationRun {
  id: string;
  model: string;
  createdAt: string;
  wagers: Wager[];
  notes?: string;
  modelVersion?: string;
  reasoningEffort?: string;
  promptVersion?: string;
  publisher?: string;
  publishedAt?: string;
}

export interface SettledWager {
  match: Match;
  bet: Bet;
  actual: Outcome;
  probs: OutcomeProbs;
  stake: number;
  odds: number;           // best available decimal price for the chosen side (0 if PASS)
  impliedProb: number;    // 1 / odds (0 if PASS)
  edge: number;           // model prob for the backed side − implied prob
  isValue: boolean;       // model believed the backed side was +EV
  won: boolean;
  pnl: number;
  cumulativePnl: number;
}

export interface RunMetrics {
  settled: SettledWager[];
  matches: number;        // matches with a decision recorded
  betsPlaced: number;
  passes: number;
  totalStaked: number;
  totalPnl: number;
  startingBankroll: number;
  finalBankroll: number;
  roiTurnover: number;    // pnl / total staked
  returnOnBankroll: number; // pnl / starting bankroll
  hitRate: number;        // won / betsPlaced
  averageStake: number;
  averageOdds: number;
  valueBets: number;      // placed bets the model judged +EV
  brier: number;          // mean multiclass Brier score over decisions with probs (lower = better)
  longestWinStreak: number;
}

export interface ModelSummary {
  model: string;
  reasoningEffort: string;
  runs: number;
  betsPlaced: number;
  averagePnl: number;
  averageRoi: number;      // mean turnover ROI
  averageBrier: number;
  bestPnl: number;
  bestRunId: string;
}

export interface ModelFamilySummary {
  model: string;
  runs: number;
  betsPlaced: number;
  averagePnl: number;
  averageRoi: number;
  averageBrier: number;
  bestPnl: number;
  bestRunId: string;
  reasoningLevels: ModelSummary[];
}
