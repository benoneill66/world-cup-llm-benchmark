# Touchline — 2026 World Cup LLM betting benchmark

Touchline measures how well language models predict the **90-minute 1X2 result** of all 72 matches in the 2026 FIFA World Cup group stage. It supports two controlled conditions:

- **Blind:** the model receives fixtures, groups, and kickoff times, but no prices or outcomes.
- **Odds visible:** the model receives the same fixtures plus one selected set of closing 1X2 prices.

Each prediction is settled as a £1 flat-stake bet at the chosen close. There are no exact-score predictions or exact-score markets.

## Run it

```bash
npm install
npm run dev
```

Production and test checks:

```bash
npm test
npm run build
```

## Evaluation workflow

1. Open **Prompt lab** and choose `Blind` or `Odds visible`.
2. Copy or download the generated prompt and run it against an LLM in a clean session.
3. Open **New evaluation**, record the model, information condition, and settlement line.
4. Paste the returned JSON array, then import and settle it.
5. Compare P&L, ROI, accuracy, cumulative returns, and every individual £1 bet on the dashboard.

The accepted response format is:

```json
[
  { "matchId": "2026-A-01", "outcome": "H" },
  { "matchId": "2026-A-02", "outcome": "D" }
]
```

`H` means home win, `D` means draw, and `A` means away win. Partial runs are accepted for development, while complete benchmark comparisons should contain all 72 match IDs exactly once.

Runs are stored in browser `localStorage`, making the app self-contained. The closing-favourite strategy is included as a clearly labelled reference baseline; it is not presented as an LLM result.

## Settlement rules

For a £1 stake at decimal odds `o`:

- correct prediction: net P&L = `o − 1`
- incorrect prediction: net P&L = `−1`

All monetary settlement and cumulative balances are rounded to pennies. ROI is total net P&L divided by total stake. The benchmark always uses the result after 90 minutes, consistent with a standard football 1X2 market.

## Dataset and closing odds

The locked snapshot at [`src/data/matches.json`](src/data/matches.json) contains 72 group-stage fixtures, their 90-minute outcomes, and four price feeds:

- Bet365 closing 1X2
- Betfair Exchange closing 1X2
- average bookmaker closing 1X2
- best available bookmaker closing 1X2

Source: [Football-Data.co.uk World Cup 2026 workbook](https://www.football-data.co.uk/WorldCup2026.xlsx), retrieved 10 July 2026. Football-Data describes its `C`-labelled prices as closing odds in its [dataset notes](https://www.football-data.co.uk/downloadm.php). The workbook's `WorldCup2026` sheet was filtered to the first 72 chronological fixtures (11–28 June), and teams were assigned to Groups A–L from their six-match round-robin fixture sets.

The raw score is retained only to derive the authoritative `H`/`D`/`A` outcome. Models are never asked to predict an exact score, and generated prompts never contain scores or outcomes.

## Architecture

- `src/data/matches.json` — locked match/result/odds snapshot
- `src/lib/benchmark.ts` — prompt construction, input validation, and deterministic bet settlement
- `src/lib/benchmark.test.ts` — leakage, validation, and accounting tests
- `src/App.tsx` — run ingestion, prompt lab, leaderboard, charts, and bet ledger
- `src/lib/storage.ts` — local evaluation persistence

To benchmark another tournament, supply the same `Match` shape defined in `src/types.ts`; the evaluation and dashboard layers do not contain tournament-specific settlement logic.

## Experimental discipline

- Freeze the prompt and model settings before comparing models.
- Never expose the built app, source dataset, or dashboard to a model during a blind run.
- Record model version, run date, temperature, tools/search access, and prompt revision in the run notes.
- Compare blind and odds-visible runs as separate conditions; odds visibility changes the task materially.
- Do not treat retrospective P&L as evidence that a strategy will remain profitable.
