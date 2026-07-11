# Touchline — 2026 World Cup LLM betting benchmark

Touchline measures how well language models **turn a profit betting** on the 72 group-stage matches of the 2026 FIFA World Cup. Rather than asking a model to predict results (which just rewards copying the betting favourite), it hands the model a **£100 bankroll** and asks it to **maximise profit** by finding value in the closing prices.

## The profit challenge

Each model receives all 72 fixtures with four sets of closing 1X2 prices, and must return, per match:

- a **bet** — back Home (`H`), Draw (`D`), Away (`A`), or `PASS`;
- a **stake** — £0–£10, where **all stakes must sum to the full £100 bankroll**;
- its own **probabilities** for H / D / A.

Winning bets settle at the **best available price** across the four feeds (line shopping). A winning £s stake at decimal odds `o` returns `s × (o − 1)`; a losing bet loses the stake. Because the whole bankroll must be deployed (max £10 per match, so ≥10 positions), it is a **bankroll-allocation problem**: money on one match is money withheld from another, so the model must concentrate on its strongest value bets and pass on the rest.

This design targets the failure mode of the naive version: with a fixed £1 forced bet and a "predict the result" prompt, every model just backs the favourite (~98% of the time) and there is no way to express conviction. Here, profit only comes from probability estimates that genuinely beat the market.

## Metrics

- **Net P&L / return on bankroll** — profit on the £100 (headline).
- **Hit rate** and **average odds** — you can profit with a low hit rate if the winners pay enough.
- **Brier score** — grades the model's own H/D/A probabilities (0 = perfect, 0.667 = uniform guess), measuring calibration independently of betting luck.
- **Value bets** — placed bets the model itself judged +EV (its probability beat the implied price).

A **flat-favourite baseline** (the £100 spread evenly across the best-priced favourite every match) is included as a clearly-labelled reference; beat it by finding value.

## Run it

```bash
npm install
npm run dev      # web app + curator API
npm test         # scoring, prompt, store, and UI tests
npm run build    # static production build
```

## Evaluation workflow

1. Open **Prompt lab**, copy or download the result-free profit prompt.
2. Run it against an LLM in a clean, tool-free session (see *Experimental discipline*).
3. Open **New evaluation**, paste the returned JSON array of wagers; it's scored instantly and stored locally in your browser.
4. Compare P&L, ROI, hit rate, Brier, and the full wager ledger on the dashboard.

Accepted response format:

```json
[{ "matchId": "2026-A-01", "bet": "A", "stake": 6.5, "probs": { "H": 0.30, "D": 0.28, "A": 0.42 } }]
```

Stakes are normalised to sum to £100 at scoring time (over-budget scaled down, under-budget scaled up, capped at £10/match), so a run is graded on exactly the same bankroll regardless of small arithmetic slips.

## Browse-only public site

The deployed site is **browse-only**: anyone can explore published runs and copy the prompt, but nobody can publish to it. Your own evaluations stay in your browser. The catalogue is a JSON file committed to the repo (`src/data/published-runs.json`), bundled into the static build, so the public site needs no backend.

- **Published runs** — the browseable catalogue of complete 72-match profit runs.
- **Models** — groups runs by model family; drill into each reasoning level and its individual runs, ranked by net P&L.
- The site deploys to **GitHub Pages** via `.github/workflows/deploy.yml` on every push to `main`.

## Curator server (optional, local only)

`server/` is a small Express service used only for curation, browse-only by default. Set `TOUCHLINE_ALLOW_PUBLISH=1` to enable writes (`POST /api/runs` otherwise returns `403`). It reads and writes the same committed `src/data/published-runs.json`.

## Generating benchmark runs

`scripts/run-profit-benchmark.mjs` runs models through the profit challenge in **fully isolated** conditions and validates their output; `scripts/publish-batch.mjs` appends validated runs to the catalogue.

```bash
# 4 Claude models × {low,medium} reasoning × 5 runs, or filter to one cell:
node scripts/run-profit-benchmark.mjs .profit-out 5 4 opus medium
node scripts/publish-batch.mjs .profit-out/results.json
```

Each run executes `claude -p` in a fresh ephemeral directory **outside the repo**, with all built-in tools disabled and an empty strict MCP config, so the model cannot read `src/data/matches.json` (which holds the actual results) or reach the web. Reasoning level is set via `MAX_THINKING_TOKENS` (low = 2000, medium = 10000), and telemetry is checked to confirm zero web searches on every run.

## Dataset and closing odds

The locked snapshot at [`src/data/matches.json`](src/data/matches.json) contains 72 group-stage fixtures, their 90-minute outcomes, and four price feeds (Bet365, Betfair Exchange, market average, best available) — source: [Football-Data.co.uk World Cup 2026 workbook](https://www.football-data.co.uk/WorldCup2026.xlsx). Scores are retained only to derive the authoritative `H`/`D`/`A` outcome; generated prompts never contain scores or results.

## Experimental discipline

- Disable web search, browsing, retrieval, connectors, and code execution at the model/API level. The prompt forbids them, but prompt text alone cannot enforce tool access.
- For a valid retrospective run, use a model snapshot with a knowledge cutoff before 11 June 2026 — a current model may already contain results in its training data.
- Freeze the prompt and settings before comparing models, and record model version, reasoning effort, and run date.
- Retrospective P&L is not evidence a strategy will remain profitable; closing lines are efficient and variance on longshots is high.

## Architecture

- `src/data/matches.json` — locked match/result/odds snapshot
- `src/lib/benchmark.ts` — profit prompt, wager validation, best-price settlement, bankroll fitting, and metrics
- `src/App.tsx` — dashboard, leaderboard, wager ledger, model drill-down, prompt lab, importer
- `server/` — browse-only curator API and atomic run store
- `scripts/` — isolated run generation and batch publishing
