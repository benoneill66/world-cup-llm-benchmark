import { useEffect, useMemo, useState } from 'react';
import matchesData from './data/matches.json';
import {
  ODDS_SOURCE_LABELS,
  OUTCOME_LABELS,
  aggregateModelFamilies,
  buildPrompt,
  evaluateRun,
  favouritePredictions,
  validatePredictions,
} from './lib/benchmark';
import { fetchPublishedRuns } from './lib/api';
import { loadRuns, saveRuns } from './lib/storage';
import type { EvaluationRun, Match, ModelFamilySummary, OddsSource, Outcome, Prediction, RunMetrics } from './types';

const matches = matchesData as Match[];
const BASELINE_ID = 'market-favourite-baseline';

const baseline: EvaluationRun = {
  id: BASELINE_ID,
  model: 'Closing favourite baseline',
  oddsSource: 'marketAverage',
  createdAt: '2026-06-28T04:00:00Z',
  predictions: favouritePredictions(matches, 'marketAverage'),
  notes: 'Reference strategy: select the shortest market-average closing price.',
};

type View = 'dashboard' | 'published' | 'models' | 'new-run' | 'prompt';

const money = (value: number) => `${value >= 0 ? '+' : '−'}£${Math.abs(value).toFixed(2)}`;
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

function outcomeText(outcome: Outcome, match: Match) {
  if (outcome === 'D') return 'Draw';
  return outcome === 'H' ? `${match.homeTeam} win` : `${match.awayTeam} win`;
}

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
          <div><strong>TOUCHLINE</strong><span>LLM benchmark</span></div>
        </div>
        <nav>
          <button className={view === 'dashboard' ? 'active' : ''} onClick={() => setView('dashboard')}><span>◫</span> Run detail</button>
          <button className={view === 'published' ? 'active' : ''} onClick={() => setView('published')}><span>◎</span> Published runs</button>
          <button className={view === 'models' ? 'active' : ''} onClick={() => setView('models')}><span>≋</span> Models</button>
          <button className={view === 'new-run' ? 'active' : ''} onClick={() => setView('new-run')}><span>＋</span> New evaluation</button>
          <button className={view === 'prompt' ? 'active' : ''} onClick={() => setView('prompt')}><span>⌘</span> Prompt lab</button>
        </nav>
        <div className="sidebar-note">
          <span className="live-dot" /> DATASET LOCKED
          <strong>World Cup 2026</strong>
          <p>72 group-stage matches<br />£1 flat stake · 1X2 close</p>
        </div>
      </aside>

      <main>
        {view === 'dashboard' && (
          <Dashboard
            run={selectedRun}
            runs={runs}
            onSelect={setSelectedId}
            onNew={() => setView('new-run')}
            onDelete={deleteRun}
          />
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
  const [group, setGroup] = useState('All');
  const visibleRows = group === 'All' ? metrics.settled : metrics.settled.filter((row) => row.match.group === group);
  const comparisons = runs.map((item) => ({ run: item, metrics: evaluateRun(item, matches) }));
  const publishedOptions = runs.filter((item) => item.publishedAt);
  const draftOptions = runs.filter((item) => item.id !== BASELINE_ID && !item.publishedAt);
  const runStatus = run.id === BASELINE_ID ? 'REFERENCE BASELINE' : run.publishedAt ? 'PUBLISHED RUN' : 'YOUR LOCAL RUN';

  return (
    <div className="page">
      <header className="page-header">
        <div><p className="eyebrow">{runStatus} · WORLD CUP 2026</p><h1>{run.model}</h1><p>{run.modelVersion ? `${run.modelVersion} · ` : ''}{run.reasoningEffort ? `${run.reasoningEffort} reasoning · ` : ''}Predicted with closing odds visible</p></div>
        <button className="primary" onClick={onNew}>＋ New evaluation</button>
      </header>

      <section className={`run-context ${run.id === BASELINE_ID ? 'reference' : run.publishedAt ? 'published' : 'draft'}`}>
        <strong>{run.id === BASELINE_ID ? 'This is not an LLM result' : run.publishedAt ? 'Official benchmark result' : 'Your private local run'}</strong>
        <span>{run.id === BASELINE_ID ? 'It is a market reference that bets the shortest closing price in every match. Use it as a benchmark when judging actual model runs.' : run.publishedAt ? `Published ${new Date(run.publishedAt).toLocaleDateString()}${run.publisher ? ` via ${run.publisher}` : ''}.` : `Only stored in this browser${metrics.matches < 72 ? ` — ${metrics.matches} of 72 predictions loaded` : ''}. Copy the Prompt lab pack, run your own model, and paste its answers to see how it scores.`}</span>
      </section>

      <section className="run-toolbar panel">
        <div className="select-wrap">
          <label>Evaluation run</label>
          <select value={run.id} onChange={(event) => onSelect(event.target.value)}>
            {draftOptions.length > 0 && <optgroup label="Your local runs">{draftOptions.map((item) => <option value={item.id} key={item.id}>{item.model}{item.modelVersion ? ` · ${item.modelVersion}` : ''}</option>)}</optgroup>}
            {publishedOptions.length > 0 && <optgroup label="Published runs">{publishedOptions.map((item) => <option value={item.id} key={item.id}>{item.model}{item.modelVersion ? ` · ${item.modelVersion}` : ''}</option>)}</optgroup>}
            <optgroup label="Reference only"><option value={baseline.id}>{baseline.model} · not an LLM</option></optgroup>
          </select>
        </div>
        <div className="run-meta"><OddsPill />{run.publishedAt && <span className="published-pill">✓ PUBLISHED</span>}<span>{ODDS_SOURCE_LABELS[run.oddsSource]}</span><span>{metrics.matches}/72 picks</span></div>
        {run.id !== BASELINE_ID && !run.publishedAt && <div className="run-actions"><button className="text-button danger" onClick={onDelete}>Delete</button></div>}
      </section>

      <section className="metric-grid">
        <Metric label="Net profit" value={money(metrics.totalPnl)} note={`£${metrics.matches.toFixed(2)} staked`} tone={metrics.totalPnl >= 0 ? 'positive' : 'negative'} />
        <Metric label="ROI" value={pct(metrics.roi)} note="profit / total stake" tone={metrics.roi >= 0 ? 'positive' : 'negative'} />
        <Metric label="Result accuracy" value={pct(metrics.accuracy)} note={`${metrics.correct} of ${metrics.matches} correct`} />
        <Metric label="Average odds" value={metrics.averageOdds.toFixed(2)} note={`longest streak ${metrics.longestWinStreak}`} />
      </section>

      <section className="dashboard-grid">
        <div className="panel chart-panel">
          <PanelTitle title="Cumulative profit" detail="Net P&L after each £1 prediction" />
          <ProfitChart metrics={metrics} />
        </div>
        <div className="panel comparison-panel">
          <PanelTitle title="Run leaderboard" detail="Reference, your local, and published runs by ROI" />
          {[...comparisons].sort((a, b) => b.metrics.roi - a.metrics.roi).map(({ run: item, metrics: itemMetrics }, index) => (
            <button className={`leader-row ${item.id === run.id ? 'selected' : ''}`} key={item.id} onClick={() => onSelect(item.id)}>
              <span className="rank">{String(index + 1).padStart(2, '0')}</span>
              <span className="leader-name"><strong>{item.model}</strong><small>{ODDS_SOURCE_LABELS[item.oddsSource]} · {itemMetrics.matches} picks</small></span>
              <span className={itemMetrics.totalPnl >= 0 ? 'positive-text' : 'negative-text'}>{money(itemMetrics.totalPnl)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel results-panel">
        <div className="results-heading">
          <PanelTitle title="Prediction ledger" detail="Every bet settled against the selected closing line" />
          <select value={group} onChange={(event) => setGroup(event.target.value)} aria-label="Filter group">
            <option>All</option>{'ABCDEFGHIJKL'.split('').map((letter) => <option key={letter}>{letter}</option>)}
          </select>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Match</th><th>Prediction</th><th>Actual result</th><th>Odds</th><th>£1 P&L</th></tr></thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.match.id}>
                  <td><div className="fixture"><span>GROUP {row.match.group}</span><strong>{row.match.homeTeam} <i>vs</i> {row.match.awayTeam}</strong></div></td>
                  <td><ResultTag outcome={row.predicted} correct={row.correct}>{outcomeText(row.predicted, row.match)}</ResultTag></td>
                  <td><strong>{outcomeText(row.actual, row.match)}</strong></td>
                  <td className="mono">{row.odds.toFixed(2)}</td>
                  <td className={`mono pnl ${row.pnl >= 0 ? 'positive-text' : 'negative-text'}`}>{money(row.pnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visibleRows.length && <div className="empty">No settled predictions in this group.</div>}
        </div>
      </section>
      <p className="method-note">Settlement uses the 90-minute result. A correct £1 bet returns decimal odds × £1; P&L excludes the returned stake. An incorrect bet loses £1.</p>
    </div>
  );
}

function PublishedRuns({ runs, onOpen }: { runs: EvaluationRun[]; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [oddsSource, setOddsSource] = useState<'all' | OddsSource>('all');
  const filtered = runs.filter((run) =>
    (!query || `${run.model} ${run.modelVersion ?? ''} ${run.publisher ?? ''}`.toLowerCase().includes(query.toLowerCase()))
    && (oddsSource === 'all' || run.oddsSource === oddsSource),
  );
  return (
    <div className="page catalogue-page">
      <header className="page-header"><div><p className="eyebrow">PUBLIC BENCHMARK LEDGER</p><h1>Published runs</h1><p>Browse complete, reproducible 72-match evaluations submitted by model.</p></div><span className="catalogue-count">{runs.length} RUN{runs.length === 1 ? '' : 'S'}</span></header>
      <section className="panel catalogue-toolbar">
        <input aria-label="Search published runs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search model, version, or publisher…" />
        <select aria-label="Filter published odds source" value={oddsSource} onChange={(event) => setOddsSource(event.target.value as typeof oddsSource)}><option value="all">All closing lines</option>{Object.entries(ODDS_SOURCE_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select>
      </section>
      {!filtered.length && <div className="catalogue-state"><strong>No runs match your filters</strong><span>Clear the search or closing-line filter to see the full catalogue.</span></div>}
      <section className="run-card-grid">
        {filtered.map((run) => {
          const metrics = evaluateRun(run, matches);
          return <button className="run-card panel" key={run.id} onClick={() => onOpen(run.id)}>
            <div className="run-card-head"><OddsPill /><span>{new Date(run.publishedAt!).toLocaleDateString()}</span></div>
            <h2>{run.model}</h2><p>{run.modelVersion || 'Version not specified'}{run.reasoningEffort ? ` · ${run.reasoningEffort} reasoning` : ''}</p>
            <div className="run-card-metrics"><span><small>P&L</small><strong className={metrics.totalPnl >= 0 ? 'positive-text' : 'negative-text'}>{money(metrics.totalPnl)}</strong></span><span><small>ROI</small><strong>{pct(metrics.roi)}</strong></span><span><small>Accuracy</small><strong>{pct(metrics.accuracy)}</strong></span></div>
            <div className="run-card-foot"><span>{run.publisher ? `by ${run.publisher}` : 'Anonymous publisher'}</span><span>View ledger →</span></div>
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
      <header className="page-header"><div><p className="eyebrow">MODEL COMPARISON</p><h1>Who reads the market best?</h1><p>Rank models by average ROI, then drill into each reasoning level and its individual runs.</p></div></header>
      {!families.length ? <div className="catalogue-state"><strong>No models to compare yet</strong><span>Published runs will appear here automatically.</span></div> : <>
        <section className="panel model-table-wrap"><table className="model-table"><thead><tr><th>Model</th><th>Reasoning levels</th><th>Runs</th><th>Predictions</th><th>Avg. ROI</th><th>Accuracy</th><th>Best ROI</th></tr></thead><tbody>
          {families.map((item, index) => <tr key={item.model} className={item.model === family?.model ? 'selected-model' : ''} onClick={() => selectFamily(item.model)}>
            <td><span className="model-rank">{String(index + 1).padStart(2, '0')}</span><strong>{item.model}</strong></td>
            <td><span className="reasoning-badge">{item.reasoningLevels.length} level{item.reasoningLevels.length === 1 ? '' : 's'}</span></td>
            <td className="mono">{item.runs}</td><td className="mono">{item.predictions}</td>
            <td className={`mono ${item.averageRoi >= 0 ? 'positive-text' : 'negative-text'}`}>{pct(item.averageRoi)}</td>
            <td className="mono">{pct(item.averageAccuracy)}</td><td className="mono">{pct(item.bestRoi)}</td>
          </tr>)}
        </tbody></table></section>
        {family && <section className="model-breakdown">
          <div className="model-hero panel"><div><span className="eyebrow">SELECTED MODEL</span><h2>{family.model}</h2><p>{family.reasoningLevels.length} reasoning level{family.reasoningLevels.length === 1 ? '' : 's'} · {family.runs} run{family.runs === 1 ? '' : 's'} · {family.predictions} settled predictions</p></div><div className="condition-compare"><span><small>Average ROI</small><strong className={family.averageRoi >= 0 ? 'positive-text' : 'negative-text'}>{pct(family.averageRoi)}</strong></span><i>vs</i><span><small>Best ROI</small><strong>{pct(family.bestRoi)}</strong></span></div></div>
          <div className="panel reasoning-panel">
            <PanelTitle title="Reasoning levels" detail="Select an effort setting to compare its runs" />
            {family.reasoningLevels.map((item) => <button key={item.reasoningEffort} className={`reasoning-row ${item.reasoningEffort === level?.reasoningEffort ? 'selected' : ''}`} onClick={() => setSelectedReasoning(item.reasoningEffort)}>
              <span className="reasoning-badge">{item.reasoningEffort}</span>
              <span className="reasoning-meta"><small>{item.runs} run{item.runs === 1 ? '' : 's'}</small><small>{pct(item.averageAccuracy)} acc</small></span>
              <span className={`mono ${item.averageRoi >= 0 ? 'positive-text' : 'negative-text'}`}>{pct(item.averageRoi)}</span>
            </button>)}
          </div>
        </section>}
        {family && level && <section className="panel model-run-list model-run-list-full">
          <PanelTitle title="Run history" detail={`${family.model} · ${level.reasoningEffort} reasoning`} />
          {levelRuns.map((run) => { const metrics = evaluateRun(run, matches); return <button key={run.id} onClick={() => onOpen(run.id)}><span><strong>{run.modelVersion || run.model}</strong><small>{run.promptVersion ? `Prompt ${run.promptVersion} · ` : ''}{run.publisher ? `${run.publisher} · ` : ''}{ODDS_SOURCE_LABELS[run.oddsSource]}</small></span><span className="mono">{pct(metrics.accuracy)}</span><span className={`mono ${metrics.totalPnl >= 0 ? 'positive-text' : 'negative-text'}`}>{money(metrics.totalPnl)}</span><b>→</b></button>; })}
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
  const [oddsSource, setOddsSource] = useState<OddsSource>('bet365');
  const [notes, setNotes] = useState('');
  const [picks, setPicks] = useState<Record<string, Outcome>>({});
  const [jsonInput, setJsonInput] = useState('');
  const [error, setError] = useState('');
  const completed = Object.keys(picks).length;

  const importJson = () => {
    try {
      const predictions = validatePredictions(JSON.parse(jsonInput), matches);
      setPicks(Object.fromEntries(predictions.map((prediction) => [prediction.matchId, prediction.outcome])));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not parse predictions.');
    }
  };

  const save = () => {
    if (!model.trim()) return setError('Give this model or run a name.');
    if (!completed) return setError('Add at least one prediction.');
    const predictions = matches.flatMap<Prediction>((match) => picks[match.id] ? [{ matchId: match.id, outcome: picks[match.id] }] : []);
    onSave({
      id: crypto.randomUUID(), model: model.trim(), oddsSource, createdAt: new Date().toISOString(), predictions,
      notes: notes.trim() || undefined,
      modelVersion: modelVersion.trim() || undefined,
      reasoningEffort: reasoningEffort.trim() || undefined,
      promptVersion: promptVersion.trim() || undefined,
    });
  };

  return (
    <div className="page builder-page">
      <header className="page-header"><div><p className="eyebrow">NEW EVALUATION</p><h1>Load model predictions</h1><p>Paste an LLM response or choose each 90-minute result manually.</p></div><button className="text-button" onClick={onCancel}>← Back to results</button></header>
      <section className="panel setup-panel">
        <div className="form-grid">
          <label><span>Model family</span><input value={model} onChange={(event) => setModel(event.target.value)} placeholder="e.g. GPT-5" /></label>
          <label><span>Model version</span><input value={modelVersion} onChange={(event) => setModelVersion(event.target.value)} placeholder="e.g. gpt-5-2026-06" /></label>
          <label><span>Reasoning effort</span><input value={reasoningEffort} onChange={(event) => setReasoningEffort(event.target.value)} placeholder="e.g. low, medium, high" /></label>
          <label><span>Settlement line</span><select value={oddsSource} onChange={(event) => setOddsSource(event.target.value as OddsSource)}>{Object.entries(ODDS_SOURCE_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
          <label><span>Prompt version</span><input value={promptVersion} onChange={(event) => setPromptVersion(event.target.value)} placeholder="e.g. closing-odds-v2" /></label>
          <label><span>Notes (optional)</span><input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Prompt version, temperature, date…" /></label>
        </div>
      </section>
      <section className="panel import-panel">
        <PanelTitle title="JSON import" detail='Expected: [{"matchId":"2026-A-01","outcome":"WIN"}]' />
        <textarea value={jsonInput} onChange={(event) => setJsonInput(event.target.value)} placeholder="Paste the LLM's JSON array here…" />
        <div className="import-actions"><button className="secondary" onClick={importJson}>Import predictions</button><span>Importing replaces the picks below.</span></div>
      </section>
      <section className="panel picks-panel">
        <div className="pick-progress"><div><strong>{completed} / 72</strong><span>predictions loaded</span></div><div className="progress"><i style={{ width: `${completed / 72 * 100}%` }} /></div></div>
        <div className="pick-list">
          {matches.map((match) => (
            <div className="pick-row" key={match.id}>
              <span className="match-code">{match.id}</span>
              <strong>{match.homeTeam} <i>vs</i> {match.awayTeam}</strong>
              <div className="segmented">
                {(['H', 'D', 'A'] as Outcome[]).map((outcome) => <button className={picks[match.id] === outcome ? 'selected' : ''} key={outcome} onClick={() => setPicks((current) => ({ ...current, [match.id]: outcome }))}>{OUTCOME_LABELS[outcome]}</button>)}
              </div>
            </div>
          ))}
        </div>
      </section>
      {error && <div className="error-banner">{error}</div>}
      <div className="sticky-actions"><span>{completed < 72 ? `Partial run — ${72 - completed} fixtures unpicked` : 'Complete benchmark ready'}</span><button className="primary" onClick={save}>Settle evaluation →</button></div>
    </div>
  );
}

function PromptLab() {
  const [oddsSource, setOddsSource] = useState<OddsSource>('bet365');
  const [copied, setCopied] = useState(false);
  const prompt = useMemo(() => buildPrompt(matches, oddsSource), [oddsSource]);
  const copy = async () => { await navigator.clipboard.writeText(prompt); setCopied(true); window.setTimeout(() => setCopied(false), 1600); };
  const download = () => {
    const url = URL.createObjectURL(new Blob([prompt], { type: 'text/plain' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'world-cup-2026-closing-odds-prompt.txt'; anchor.click(); URL.revokeObjectURL(url);
  };
  return (
    <div className="page prompt-page">
      <header className="page-header"><div><p className="eyebrow">PROMPT LAB</p><h1>Run a clean evaluation</h1><p>Generate a fixture pack that never exposes the benchmark outcomes.</p></div></header>
      <section className="prompt-layout">
        <div className="panel prompt-controls">
          <h2>Experiment setup</h2>
          <label><span>Odds shown to model</span><select value={oddsSource} onChange={(event) => setOddsSource(event.target.value as OddsSource)}>{Object.entries(ODDS_SOURCE_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
          <div className="guardrail"><strong>Leakage guard</strong><p>Every fixture includes the selected closing odds. Final scores and actual results remain omitted, and the prompt forbids browsing, search, retrieval, and tool use.</p></div>
          <div className="knowledge-warning"><strong>Knowledge-cutoff warning</strong><p>A prompt cannot erase results already present in a model's training data. For a valid retrospective run, use a model snapshot with a knowledge cutoff before 11 June 2026 and disable all tools at the API level.</p></div>
          <button className="primary full" onClick={copy}>{copied ? 'Copied ✓' : 'Copy prompt'}</button>
          <button className="secondary full" onClick={download}>Download .txt</button>
        </div>
        <div className="panel prompt-preview"><div className="preview-head"><span>world-cup-2026-closing-odds.txt</span><span>{matches.length} fixtures</span></div><pre>{prompt}</pre></div>
      </section>
    </div>
  );
}

function Metric({ label, value, note, tone }: { label: string; value: string; note: string; tone?: 'positive' | 'negative' }) {
  return <div className="metric-card"><span>{label}</span><strong className={tone === 'positive' ? 'positive-text' : tone === 'negative' ? 'negative-text' : ''}>{value}</strong><small>{note}</small></div>;
}

function PanelTitle({ title, detail }: { title: string; detail: string }) {
  return <div className="panel-title"><h2>{title}</h2><p>{detail}</p></div>;
}

function OddsPill() {
  return <span className="odds-pill">◉ ODDS SHOWN</span>;
}

function ResultTag({ outcome, correct, children }: { outcome: Outcome; correct: boolean; children: React.ReactNode }) {
  const displayOutcome = outcome === 'H' ? 'W' : outcome === 'A' ? 'L' : 'D';
  return <span className={`result-tag ${correct ? 'correct' : 'wrong'}`}><b>{displayOutcome}</b>{children}</span>;
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
