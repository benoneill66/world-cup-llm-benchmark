import { useEffect, useMemo, useState } from 'react';
import matchesData from './data/matches.json';
import {
  BET_LABELS,
  MAX_STAKE,
  STARTING_BANKROLL,
  aggregateModelFamilies,
  buildProfitPrompt,
  evaluateRun,
  favouriteBaselineWagers,
  validateWagers,
} from './lib/benchmark';
import { fetchPublishedRuns } from './lib/api';
import { loadRuns, saveRuns } from './lib/storage';
import type { Bet, EvaluationRun, Match, ModelFamilySummary, RunMetrics } from './types';

const matches = matchesData as Match[];
const BASELINE_ID = 'favourite-baseline';

const baseline: EvaluationRun = {
  id: BASELINE_ID,
  model: 'Flat-favourite baseline',
  createdAt: '2026-06-28T04:00:00Z',
  wagers: favouriteBaselineWagers(matches),
  notes: `Reference: the £${STARTING_BANKROLL} bankroll spread evenly across the best-priced favourite in every match. Not an LLM.`,
};

type View = 'dashboard' | 'published' | 'models' | 'new-run' | 'prompt';

const money = (value: number) => `${value >= 0 ? '+' : '−'}£${Math.abs(value).toFixed(2)}`;
const gbp = (value: number) => `£${value.toFixed(2)}`;
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

function App() {
  const [view, setView] = useState<View>('dashboard');
  const [userRuns, setUserRuns] = useState<EvaluationRun[]>(loadRuns);
  const [publishedRuns, setPublishedRuns] = useState<EvaluationRun[]>([]);
  const runs = useMemo(() => {
    const ids = new Set<string>();
    return [baseline, ...publishedRuns, ...userRuns].filter((run) => !ids.has(run.id) && Boolean(ids.add(run.id)));
  }, [publishedRuns, userRuns]);
  const [selectedId, setSelectedId] = useState(BASELINE_ID);
  const selectedRun = runs.find((run) => run.id === selectedId) ?? runs[0];

  useEffect(() => saveRuns(userRuns), [userRuns]);
  useEffect(() => { fetchPublishedRuns().then(setPublishedRuns).catch(() => setPublishedRuns([])); }, []);

  const addRun = (run: EvaluationRun) => {
    setUserRuns((current) => [run, ...current]);
    setSelectedId(run.id);
    setView('dashboard');
  };

  const deleteRun = () => {
    if (selectedRun.id === BASELINE_ID || selectedRun.publishedAt) return;
    if (!window.confirm(`Delete ${selectedRun.model}?`)) return;
    setUserRuns((current) => current.filter((run) => run.id !== selectedRun.id));
    setSelectedId(BASELINE_ID);
  };

  const openRun = (id: string) => { setSelectedId(id); setView('dashboard'); };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">T</div>
          <div><strong>TOUCHLINE</strong><span>LLM betting benchmark</span></div>
        </div>
        <nav>
          <button className={view === 'dashboard' ? 'active' : ''} onClick={() => setView('dashboard')}><span>◫</span> Run detail</button>
          <button className={view === 'published' ? 'active' : ''} onClick={() => setView('published')}><span>◎</span> Published runs</button>
          <button className={view === 'models' ? 'active' : ''} onClick={() => setView('models')}><span>≋</span> Models</button>
          <button className={view === 'new-run' ? 'active' : ''} onClick={() => setView('new-run')}><span>＋</span> New evaluation</button>
          <button className={view === 'prompt' ? 'active' : ''} onClick={() => setView('prompt')}><span>⌘</span> Prompt lab</button>
        </nav>
        <div className="sidebar-note">
          <span className="live-dot" /> PROFIT CHALLENGE
          <strong>World Cup 2026</strong>
          <p>72 matches · £{STARTING_BANKROLL} bankroll<br />£0–£{MAX_STAKE}/match · best-price settle</p>
        </div>
      </aside>

      <main>
        {view === 'dashboard' && (
          <Dashboard run={selectedRun} runs={runs} onSelect={setSelectedId} onNew={() => setView('new-run')} onDelete={deleteRun} />
        )}
        {view === 'published' && <PublishedRuns runs={publishedRuns} onOpen={openRun} />}
        {view === 'models' && <ModelsComparison runs={publishedRuns} onOpen={openRun} />}
        {view === 'new-run' && <RunBuilder onSave={addRun} onCancel={() => setView('dashboard')} />}
        {view === 'prompt' && <PromptLab />}
      </main>
    </div>
  );
}

function Dashboard({ run, runs, onSelect, onNew, onDelete }: {
  run: EvaluationRun;
  runs: EvaluationRun[];
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: () => void;
}) {
  const metrics = useMemo(() => evaluateRun(run, matches), [run]);
  const comparisons = runs.map((item) => ({ run: item, metrics: evaluateRun(item, matches) }));
  const publishedOptions = runs.filter((item) => item.publishedAt);
  const draftOptions = runs.filter((item) => item.id !== BASELINE_ID && !item.publishedAt);
  const runStatus = run.id === BASELINE_ID ? 'REFERENCE BASELINE' : run.publishedAt ? 'PUBLISHED RUN' : 'YOUR LOCAL RUN';

  return (
    <div className="page">
      <header className="page-header">
        <div><p className="eyebrow">{runStatus} · WORLD CUP 2026</p><h1>{run.model}</h1><p>{run.modelVersion ? `${run.modelVersion} · ` : ''}{run.reasoningEffort ? `${run.reasoningEffort} reasoning · ` : ''}£{STARTING_BANKROLL} bankroll · maximise profit</p></div>
        <button className="primary" onClick={onNew}>＋ New evaluation</button>
      </header>

      <section className={`run-context ${run.id === BASELINE_ID ? 'reference' : run.publishedAt ? 'published' : 'draft'}`}>
        <strong>{run.id === BASELINE_ID ? 'This is not an LLM result' : run.publishedAt ? 'Official benchmark result' : 'Your private local run'}</strong>
        <span>{run.id === BASELINE_ID ? `A reference that spreads the £${STARTING_BANKROLL} bankroll evenly across the shortest-priced (favourite) side every match, at the best available price. Beat it by finding value.` : run.publishedAt ? `Published ${new Date(run.publishedAt).toLocaleDateString()}${run.publisher ? ` via ${run.publisher}` : ''}.` : 'Only stored in this browser. Copy the Prompt lab pack, run your own model, and paste its wagers to see its P&L.'}</span>
      </section>

      <section className="run-toolbar panel">
        <div className="select-wrap">
          <label>Evaluation run</label>
          <select value={run.id} onChange={(event) => onSelect(event.target.value)}>
            {draftOptions.length > 0 && <optgroup label="Your local runs">{draftOptions.map((item) => <option value={item.id} key={item.id}>{item.model}{item.modelVersion ? ` · ${item.modelVersion}` : ''}</option>)}</optgroup>}
            {publishedOptions.length > 0 && <optgroup label="Published runs">{publishedOptions.map((item) => <option value={item.id} key={item.id}>{item.model}{item.reasoningEffort ? ` · ${item.reasoningEffort}` : ''}</option>)}</optgroup>}
            <optgroup label="Reference only"><option value={baseline.id}>{baseline.model} · not an LLM</option></optgroup>
          </select>
        </div>
        <div className="run-meta"><BankrollPill value={metrics.finalBankroll} />{run.publishedAt && <span className="published-pill">✓ PUBLISHED</span>}<span>{metrics.betsPlaced} bets · {metrics.passes} pass</span><span>£{metrics.totalStaked.toFixed(0)} staked</span></div>
        {run.id !== BASELINE_ID && !run.publishedAt && <div className="run-actions"><button className="text-button danger" onClick={onDelete}>Delete</button></div>}
      </section>

      <section className="metric-grid">
        <Metric label="Net profit" value={money(metrics.totalPnl)} note={`bankroll ${gbp(metrics.finalBankroll)}`} tone={metrics.totalPnl >= 0 ? 'positive' : 'negative'} />
        <Metric label="Return on bankroll" value={pct(metrics.returnOnBankroll)} note={`£${metrics.totalStaked.toFixed(0)} of £${STARTING_BANKROLL} staked`} tone={metrics.returnOnBankroll >= 0 ? 'positive' : 'negative'} />
        <Metric label="Hit rate" value={pct(metrics.hitRate)} note={`${metrics.betsPlaced} bets · avg ${metrics.averageOdds.toFixed(2)}`} />
        <Metric label="Brier score" value={metrics.brier.toFixed(3)} note="calibration · lower is better" tone={metrics.brier <= 0.6 ? 'positive' : undefined} />
      </section>

      <section className="dashboard-grid">
        <div className="panel chart-panel">
          <PanelTitle title="Cumulative profit" detail="Bankroll P&L after each settled wager" />
          <ProfitChart metrics={metrics} />
        </div>
        <div className="panel comparison-panel">
          <PanelTitle title="Profit leaderboard" detail="Reference, your local, and published runs by net P&L" />
          {[...comparisons].sort((a, b) => b.metrics.totalPnl - a.metrics.totalPnl).map(({ run: item, metrics: itemMetrics }, index) => (
            <button className={`leader-row ${item.id === run.id ? 'selected' : ''}`} key={item.id} onClick={() => onSelect(item.id)}>
              <span className="rank">{String(index + 1).padStart(2, '0')}</span>
              <span className="leader-name"><strong>{item.model}</strong><small>{itemMetrics.betsPlaced} bets · {pct(itemMetrics.hitRate)} hit</small></span>
              <span className={itemMetrics.totalPnl >= 0 ? 'positive-text' : 'negative-text'}>{money(itemMetrics.totalPnl)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel results-panel">
        <div className="results-heading">
          <PanelTitle title="Wager ledger" detail="Every decision settled at the best available price" />
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Match</th><th>Bet</th><th>Stake</th><th>Best odds</th><th>Model P(side)</th><th>Result</th><th>P&L</th></tr></thead>
            <tbody>
              {metrics.settled.map((row) => {
                const placed = row.bet !== 'PASS' && row.stake > 0;
                const backedProb = row.bet === 'PASS' ? 0 : row.probs[row.bet];
                return (
                  <tr key={row.match.id} className={placed ? '' : 'pass-row'}>
                    <td><div className="fixture"><span>GROUP {row.match.group}</span><strong>{row.match.homeTeam} <i>vs</i> {row.match.awayTeam}</strong></div></td>
                    <td><BetTag bet={row.bet} won={row.won} placed={placed} isValue={row.isValue} /></td>
                    <td className="mono">{placed ? gbp(row.stake) : '—'}</td>
                    <td className="mono">{placed ? row.odds.toFixed(2) : '—'}</td>
                    <td className="mono">{placed ? pct(backedProb) : '—'}</td>
                    <td><strong>{outcomeName(row.actual, row.match)}</strong></td>
                    <td className={`mono pnl ${row.pnl > 0 ? 'positive-text' : row.pnl < 0 ? 'negative-text' : ''}`}>{placed ? money(row.pnl) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <p className="method-note">The whole £{STARTING_BANKROLL} bankroll is deployed — stakes are normalised to sum to £{STARTING_BANKROLL}, capped at £{MAX_STAKE} per match. A winning £s bet at best decimal odds o returns s×(o−1); a losing bet loses s. Return on bankroll is net P&L over £{STARTING_BANKROLL}; the Brier score grades the model's H/D/A probabilities (0 = perfect, 0.667 = uniform guess).</p>
    </div>
  );
}

function PublishedRuns({ runs, onOpen }: { runs: EvaluationRun[]; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const filtered = runs.filter((run) => !query || `${run.model} ${run.modelVersion ?? ''} ${run.reasoningEffort ?? ''} ${run.publisher ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="page catalogue-page">
      <header className="page-header"><div><p className="eyebrow">PUBLIC BENCHMARK LEDGER</p><h1>Published runs</h1><p>Browse complete, reproducible 72-match profit runs by model.</p></div><span className="catalogue-count">{runs.length} RUN{runs.length === 1 ? '' : 'S'}</span></header>
      <section className="panel catalogue-toolbar catalogue-toolbar-single">
        <input aria-label="Search published runs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search model, version, reasoning, or publisher…" />
      </section>
      {!filtered.length && <div className="catalogue-state"><strong>{runs.length ? 'No runs match your search' : 'No published runs yet'}</strong><span>{runs.length ? 'Clear the search to see the full catalogue.' : 'Published profit runs will appear here.'}</span></div>}
      <section className="run-card-grid">
        {filtered.map((run) => {
          const metrics = evaluateRun(run, matches);
          return <button className="run-card panel" key={run.id} onClick={() => onOpen(run.id)}>
            <div className="run-card-head"><BankrollPill value={metrics.finalBankroll} /><span>{run.publishedAt ? new Date(run.publishedAt).toLocaleDateString() : ''}</span></div>
            <h2>{run.model}</h2><p>{run.modelVersion || 'Version not specified'}{run.reasoningEffort ? ` · ${run.reasoningEffort} reasoning` : ''}</p>
            <div className="run-card-metrics"><span><small>Net P&L</small><strong className={metrics.totalPnl >= 0 ? 'positive-text' : 'negative-text'}>{money(metrics.totalPnl)}</strong></span><span><small>ROI</small><strong>{pct(metrics.returnOnBankroll)}</strong></span><span><small>Brier</small><strong>{metrics.brier.toFixed(3)}</strong></span></div>
            <div className="run-card-foot"><span>{metrics.betsPlaced} bets · {metrics.passes} pass</span><span>View ledger →</span></div>
          </button>;
        })}
      </section>
    </div>
  );
}

function ModelsComparison({ runs, onOpen }: { runs: EvaluationRun[]; onOpen: (id: string) => void }) {
  const families = useMemo(() => aggregateModelFamilies(runs, matches), [runs]);
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedReasoning, setSelectedReasoning] = useState('');

  const family: ModelFamilySummary | undefined = families.find((item) => item.model === selectedModel) ?? families[0];
  const level = family?.reasoningLevels.find((item) => item.reasoningEffort === selectedReasoning) ?? family?.reasoningLevels[0];
  const levelRuns = family && level
    ? runs
      .filter((run) => run.model === family.model && (run.reasoningEffort?.trim() || 'unspecified') === level.reasoningEffort)
      .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    : [];

  const selectFamily = (model: string) => { setSelectedModel(model); setSelectedReasoning(''); };

  return (
    <div className="page models-page">
      <header className="page-header"><div><p className="eyebrow">MODEL COMPARISON</p><h1>Who turns the biggest profit?</h1><p>Rank models by average net P&L, then drill into each reasoning level and its runs.</p></div></header>
      {!families.length ? <div className="catalogue-state"><strong>No models to compare yet</strong><span>Published runs will appear here automatically.</span></div> : <>
        <section className="panel model-table-wrap"><table className="model-table"><thead><tr><th>Model</th><th>Reasoning levels</th><th>Runs</th><th>Bets</th><th>Avg. P&L</th><th>Avg. ROI</th><th>Brier</th><th>Best P&L</th></tr></thead><tbody>
          {families.map((item, index) => <tr key={item.model} className={item.model === family?.model ? 'selected-model' : ''} onClick={() => selectFamily(item.model)}>
            <td><span className="model-rank">{String(index + 1).padStart(2, '0')}</span><strong>{item.model}</strong></td>
            <td><span className="reasoning-badge">{item.reasoningLevels.length} level{item.reasoningLevels.length === 1 ? '' : 's'}</span></td>
            <td className="mono">{item.runs}</td><td className="mono">{item.betsPlaced}</td>
            <td className={`mono ${item.averagePnl >= 0 ? 'positive-text' : 'negative-text'}`}>{money(item.averagePnl)}</td>
            <td className={`mono ${item.averageRoi >= 0 ? 'positive-text' : 'negative-text'}`}>{pct(item.averageRoi)}</td>
            <td className="mono">{item.averageBrier.toFixed(3)}</td><td className={`mono ${item.bestPnl >= 0 ? 'positive-text' : 'negative-text'}`}>{money(item.bestPnl)}</td>
          </tr>)}
        </tbody></table></section>
        {family && <section className="model-breakdown">
          <div className="model-hero panel"><div><span className="eyebrow">SELECTED MODEL</span><h2>{family.model}</h2><p>{family.reasoningLevels.length} reasoning level{family.reasoningLevels.length === 1 ? '' : 's'} · {family.runs} run{family.runs === 1 ? '' : 's'} · {family.betsPlaced} bets placed</p></div><div className="condition-compare"><span><small>Average P&L</small><strong className={family.averagePnl >= 0 ? 'positive-text' : 'negative-text'}>{money(family.averagePnl)}</strong></span><i>vs</i><span><small>Best P&L</small><strong className={family.bestPnl >= 0 ? 'positive-text' : 'negative-text'}>{money(family.bestPnl)}</strong></span></div></div>
          <div className="panel reasoning-panel">
            <PanelTitle title="Reasoning levels" detail="Select an effort setting to compare its runs" />
            {family.reasoningLevels.map((item) => <button key={item.reasoningEffort} className={`reasoning-row ${item.reasoningEffort === level?.reasoningEffort ? 'selected' : ''}`} onClick={() => setSelectedReasoning(item.reasoningEffort)}>
              <span className="reasoning-badge">{item.reasoningEffort}</span>
              <span className="reasoning-meta"><small>{item.runs} run{item.runs === 1 ? '' : 's'}</small><small>Brier {item.averageBrier.toFixed(3)}</small></span>
              <span className={`mono ${item.averagePnl >= 0 ? 'positive-text' : 'negative-text'}`}>{money(item.averagePnl)}</span>
            </button>)}
          </div>
        </section>}
        {family && level && <section className="panel model-run-list model-run-list-full">
          <PanelTitle title="Run history" detail={`${family.model} · ${level.reasoningEffort} reasoning`} />
          {levelRuns.map((run) => { const metrics = evaluateRun(run, matches); return <button key={run.id} onClick={() => onOpen(run.id)}><span><strong>{run.modelVersion || run.model}</strong><small>{metrics.betsPlaced} bets · {pct(metrics.hitRate)} hit · {run.publisher ? `${run.publisher}` : 'CLI'}</small></span><span className="mono">{pct(metrics.returnOnBankroll)}</span><span className={`mono ${metrics.totalPnl >= 0 ? 'positive-text' : 'negative-text'}`}>{money(metrics.totalPnl)}</span><b>→</b></button>; })}
        </section>}
      </>}
    </div>
  );
}

function RunBuilder({ onSave, onCancel }: { onSave: (run: EvaluationRun) => void; onCancel: () => void }) {
  const [model, setModel] = useState('');
  const [modelVersion, setModelVersion] = useState('');
  const [reasoningEffort, setReasoningEffort] = useState('');
  const [promptVersion, setPromptVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [jsonInput, setJsonInput] = useState('');
  const [preview, setPreview] = useState<RunMetrics | null>(null);
  const [wagerCount, setWagerCount] = useState(0);
  const [error, setError] = useState('');
  const [imported, setImported] = useState<ReturnType<typeof validateWagers> | null>(null);

  const importJson = () => {
    try {
      const wagers = validateWagers(JSON.parse(jsonInput), matches);
      setImported(wagers);
      setWagerCount(wagers.length);
      setPreview(evaluateRun({ id: 'preview', model: 'preview', createdAt: '', wagers }, matches));
      setError('');
    } catch (cause) {
      setImported(null); setPreview(null);
      setError(cause instanceof Error ? cause.message : 'Could not parse wagers.');
    }
  };

  const save = () => {
    if (!model.trim()) return setError('Give this model or run a name.');
    if (!imported || !imported.length) return setError('Import a valid wager array first.');
    onSave({
      id: crypto.randomUUID(), model: model.trim(), createdAt: new Date().toISOString(), wagers: imported,
      notes: notes.trim() || undefined,
      modelVersion: modelVersion.trim() || undefined,
      reasoningEffort: reasoningEffort.trim() || undefined,
      promptVersion: promptVersion.trim() || undefined,
    });
  };

  return (
    <div className="page builder-page">
      <header className="page-header"><div><p className="eyebrow">NEW EVALUATION</p><h1>Load model wagers</h1><p>Paste the JSON array your model returned from the Prompt lab pack.</p></div><button className="text-button" onClick={onCancel}>← Back to results</button></header>
      <section className="panel setup-panel">
        <div className="form-grid">
          <label><span>Model family</span><input value={model} onChange={(event) => setModel(event.target.value)} placeholder="e.g. GPT-5" /></label>
          <label><span>Model version</span><input value={modelVersion} onChange={(event) => setModelVersion(event.target.value)} placeholder="e.g. gpt-5-2026-06" /></label>
          <label><span>Reasoning effort</span><input value={reasoningEffort} onChange={(event) => setReasoningEffort(event.target.value)} placeholder="e.g. low, medium, high" /></label>
          <label><span>Prompt version</span><input value={promptVersion} onChange={(event) => setPromptVersion(event.target.value)} placeholder="e.g. profit-v1" /></label>
          <label className="full-span"><span>Notes (optional)</span><input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Temperature, date, settings…" /></label>
        </div>
      </section>
      <section className="panel import-panel">
        <PanelTitle title="Wager import" detail='Expected: [{"matchId":"2026-A-01","bet":"A","stake":6.5,"probs":{"H":0.3,"D":0.28,"A":0.42}}]' />
        <textarea value={jsonInput} onChange={(event) => setJsonInput(event.target.value)} placeholder="Paste the model's JSON array here…" />
        <div className="import-actions"><button className="secondary" onClick={importJson}>Import & score</button><span>{wagerCount ? `${wagerCount} wagers loaded` : 'Importing scores the run instantly.'}</span></div>
      </section>
      {preview && (
        <section className="metric-grid">
          <Metric label="Net profit" value={money(preview.totalPnl)} note={`bankroll ${gbp(preview.finalBankroll)}`} tone={preview.totalPnl >= 0 ? 'positive' : 'negative'} />
          <Metric label="Return on bankroll" value={pct(preview.returnOnBankroll)} note={`£${preview.totalStaked.toFixed(0)} of £${STARTING_BANKROLL} staked`} tone={preview.returnOnBankroll >= 0 ? 'positive' : 'negative'} />
          <Metric label="Hit rate" value={pct(preview.hitRate)} note={`${preview.betsPlaced} bets · ${preview.passes} pass`} />
          <Metric label="Brier score" value={preview.brier.toFixed(3)} note="lower is better" />
        </section>
      )}
      {error && <div className="error-banner">{error}</div>}
      <div className="sticky-actions"><span>{imported ? `${imported.length}/72 wagers ready` : 'Import a wager array to continue'}</span><button className="primary" onClick={save}>Save evaluation →</button></div>
    </div>
  );
}

function PromptLab() {
  const [copied, setCopied] = useState(false);
  const prompt = useMemo(() => buildProfitPrompt(matches), []);
  const copy = async () => { await navigator.clipboard.writeText(prompt); setCopied(true); window.setTimeout(() => setCopied(false), 1600); };
  const download = () => {
    const url = URL.createObjectURL(new Blob([prompt], { type: 'text/plain' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'world-cup-2026-profit-prompt.txt'; anchor.click(); URL.revokeObjectURL(url);
  };
  return (
    <div className="page prompt-page">
      <header className="page-header"><div><p className="eyebrow">PROMPT LAB</p><h1>Run the profit challenge</h1><p>A result-free pack that asks a model to maximise profit, not accuracy.</p></div></header>
      <section className="prompt-layout">
        <div className="panel prompt-controls">
          <h2>The challenge</h2>
          <ul className="challenge-list">
            <li>Deploy the full £{STARTING_BANKROLL} bankroll — stakes must sum to £{STARTING_BANKROLL}, max £{MAX_STAKE} per match.</li>
            <li>Back Home / Draw / Away, or PASS (£0) on the rest.</li>
            <li>Winning bets settle at the best of four closing prices (line shopping).</li>
            <li>Only value bets win long term — the model must estimate its own probabilities.</li>
          </ul>
          <div className="guardrail"><strong>Leakage guard</strong><p>Fixtures include odds only — never scores or results. The prompt forbids browsing, search, retrieval, and tool use.</p></div>
          <div className="knowledge-warning"><strong>Knowledge-cutoff warning</strong><p>Use a model snapshot with a knowledge cutoff before 11 June 2026 and disable all tools at the API level, or results already in training data will leak.</p></div>
          <button className="primary full" onClick={copy}>{copied ? 'Copied ✓' : 'Copy prompt'}</button>
          <button className="secondary full" onClick={download}>Download .txt</button>
        </div>
        <div className="panel prompt-preview"><div className="preview-head"><span>world-cup-2026-profit.txt</span><span>{matches.length} fixtures</span></div><pre>{prompt}</pre></div>
      </section>
    </div>
  );
}

function outcomeName(outcome: 'H' | 'D' | 'A', match: Match) {
  if (outcome === 'D') return 'Draw';
  return outcome === 'H' ? `${match.homeTeam} win` : `${match.awayTeam} win`;
}

function Metric({ label, value, note, tone }: { label: string; value: string; note: string; tone?: 'positive' | 'negative' }) {
  return <div className="metric-card"><span>{label}</span><strong className={tone === 'positive' ? 'positive-text' : tone === 'negative' ? 'negative-text' : ''}>{value}</strong><small>{note}</small></div>;
}

function PanelTitle({ title, detail }: { title: string; detail: string }) {
  return <div className="panel-title"><h2>{title}</h2><p>{detail}</p></div>;
}

function BankrollPill({ value }: { value: number }) {
  return <span className={`odds-pill ${value >= STARTING_BANKROLL ? '' : 'pill-down'}`}>◉ {gbp(value)}</span>;
}

function BetTag({ bet, won, placed, isValue }: { bet: Bet; won: boolean; placed: boolean; isValue: boolean }) {
  if (!placed) return <span className="result-tag pass"><b>—</b>Pass</span>;
  return <span className={`result-tag ${won ? 'correct' : 'wrong'}`}><b>{bet}</b>{BET_LABELS[bet]}{isValue && <i className="value-dot" title="Model judged this +EV">◆</i>}</span>;
}

function ProfitChart({ metrics }: { metrics: RunMetrics }) {
  const width = 760, height = 230, pad = 24;
  const points = [{ x: 0, y: 0 }, ...metrics.settled.map((row, index) => ({ x: index + 1, y: row.cumulativePnl }))];
  const values = points.map((point) => point.y);
  const min = Math.min(...values, -1), max = Math.max(...values, 1);
  const x = (value: number) => pad + value / Math.max(metrics.matches, 1) * (width - pad * 2);
  const y = (value: number) => pad + (max - value) / (max - min) * (height - pad * 2);
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${x(point.x)} ${y(point.y)}`).join(' ');
  const area = `${path} L ${x(metrics.matches)} ${height - pad} L ${pad} ${height - pad} Z`;
  return (
    <div className="profit-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Cumulative profit chart">
        {[0, .25, .5, .75, 1].map((part) => <line key={part} x1={pad} x2={width - pad} y1={pad + part * (height - pad * 2)} y2={pad + part * (height - pad * 2)} className="grid-line" />)}
        <line x1={pad} x2={width - pad} y1={y(0)} y2={y(0)} className="zero-line" />
        <defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8dffb5" stopOpacity=".3" /><stop offset="1" stopColor="#8dffb5" stopOpacity="0" /></linearGradient></defs>
        <path d={area} fill="url(#area)" /><path d={path} className="profit-line" />
        {points.length > 1 && <circle cx={x(points.at(-1)!.x)} cy={y(points.at(-1)!.y)} r="5" className="last-dot" />}
      </svg>
      <div className="chart-axis"><span>Match 1</span><span>{metrics.matches ? `Match ${metrics.matches}` : 'No picks'}</span></div>
    </div>
  );
}

export default App;
