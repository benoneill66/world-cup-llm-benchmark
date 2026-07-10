# Touchline — 2026 World Cup LLM betting benchmark

Touchline measures how well language models predict the **90-minute 1X2 result** of all 72 matches in the 2026 FIFA World Cup group stage. Every model receives fixtures plus one selected set of closing 1X2 prices, then chooses `WIN`, `DRAW`, or `LOSS` from the listed home team's perspective.

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

1. Open **Prompt lab** and choose which closing-odds feed to show the model.
2. Copy or download the generated prompt and run it against an LLM in a clean session.
3. Open **New evaluation**, record the model, version, and settlement line.
4. Paste the returned JSON array, then import and settle it.
5. Compare P&L, ROI, accuracy, cumulative returns, and every individual £1 bet on the dashboard.

The accepted response format is:

```json
[
  { "matchId": "2026-A-01", "outcome": "WIN" },
  { "matchId": "2026-A-02", "outcome": "DRAW" }
]
```

`WIN` means the listed home team wins, `DRAW` means the match is drawn, and `LOSS` means the home team loses. Partial runs are accepted for development, while complete benchmark comparisons should contain all 72 match IDs exactly once.

The public site is **browse-only**: anyone can explore the published benchmark and generate the prompt, but nobody can publish results to it. Your own evaluations stay in your browser's `localStorage` — paste a model's answers to see how it would have scored, entirely privately. The closing-favourite strategy is included as a clearly labelled reference baseline; it is not presented as an LLM result.

## Browsing and model comparison

- **Published runs** is the browseable experiment catalogue, with model and closing-line search and links into every bet ledger.
- **Models** groups the published runs by **model family**. Each family shows its aggregate ROI and accuracy; selecting one drills into its **reasoning levels** (e.g. `low`, `medium`, `high`), and selecting a level lists every individual run beneath it.
- **New evaluation** and **Prompt lab** let visitors reproduce the benchmark against their own model locally — no account, no publishing.

## Results storage

Published results are a JSON file committed to the repo at [`src/data/published-runs.json`](src/data/published-runs.json). This single file is the source of truth: it is bundled into the static build (so the public site needs no backend) and is what the curator server reads and writes. To publish or amend a run, edit this file — directly, or via the local curator server below — and commit it.

### Curator server (optional, local only)

`server/` is a small Express service used only for curation. It is browse-only by default; set `TOUCHLINE_ALLOW_PUBLISH=1` to enable writes, then seed the catalogue with `scripts/publish-cli-results.mjs`.

- `GET /api/health`
- `GET /api/runs`
- `GET /api/runs/:id`
- `POST /api/runs` — returns `403` unless `TOUCHLINE_ALLOW_PUBLISH=1`

Writes go to `src/data/published-runs.json` atomically. The hosted public site never runs this server.

## Deployment

The site is a static single-page app deployed to **GitHub Pages** via `.github/workflows/deploy.yml` on every push to `main` (Vite uses a relative `base`, so it works from a project subpath). Because the catalogue is committed JSON, the deployed site is fully self-contained and read-only.

### Isolated CLI benchmark runs

`scripts/export-evaluation-prompt.mjs` emits the result-free 72-match fixture and odds pack used for isolated CLI evaluations. `scripts/prediction-output-schema.json` defines the required 72-pick structured response, and `scripts/publish-cli-results.mjs` validates and publishes completed Codex/Claude CLI batches. Published metadata includes the exact model version and reasoning-effort setting.

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
- `src/lib/api.ts` — published catalogue client
- `server/app.mjs` — validated publication and browsing API
- `server/store.mjs` — atomic published-run persistence

To benchmark another tournament, supply the same `Match` shape defined in `src/types.ts`; the evaluation and dashboard layers do not contain tournament-specific settlement logic.

## Experimental discipline

- Freeze the prompt and model settings before comparing models.
- Never expose the built app, source dataset, or dashboard to a model during an evaluation run.
- Disable web search, browsing, retrieval, connectors, code execution, and other tools at the model/API level. The generated prompt explicitly prohibits using them, but prompt text alone cannot enforce tool access.
- For a valid retrospective evaluation, use a model snapshot with a knowledge cutoff before 11 June 2026. A current model may already contain tournament results in its training data even when tools are disabled.
- Record model version, run date, temperature, tools/search access, and prompt revision in the run notes.
- Use the same closing-odds source when comparing models, or clearly report the selected source alongside the result.
- Do not treat retrospective P&L as evidence that a strategy will remain profitable.
