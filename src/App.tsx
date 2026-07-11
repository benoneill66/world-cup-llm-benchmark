import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
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

const money = (value: number) => `${value >= 0 ? '+' : '−'}£${Math.abs(value).toFixed(2)}`;
const gbp = (value: number) => `£${value.toFixed(2)}`;
const pct = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value * 100).toFixed(1)}%`;
const pctPlain = (value: number) => `${(value * 100).toFixed(1)}%`;

function App() {
  const [userRuns, setUserRuns] = useState<EvaluationRun[]>(loadRuns);
  const [publishedRuns, setPublishedRuns] = useState<EvaluationRun[]>([]);
  const runs = useMemo(() => {
    const ids = new Set<string>();
    return [baseline, ...publishedRuns, ...userRuns].filter((run) => !ids.has(run.id) && Boolean(ids.add(run.id)));
  }, [publishedRuns, userRuns]);

  useEffect(() => saveRuns(userRuns), [userRuns]);
  useEffect(() => { fetchPublishedRuns().then(setPublishedRuns).catch(() => setPublishedRuns([])); }, []);

  const addRun = (run: EvaluationRun) => setUserRuns((current) => [run, ...current]);
  const deleteRun = (id: string) => setUserRuns((current) => current.filter((run) => run.id !== id));

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard runs={runs} onDelete={deleteRun} />} />
          <Route path="/runs/:id" element={<Dashboard runs={runs} onDelete={deleteRun} />} />
          <Route path="/published" element={<PublishedRuns runs={publishedRuns} />} />
          <Route path="/models" element={<ModelsComparison runs={publishedRuns} />} />
          <Route path="/models/:model" element={<ModelsComparison runs={publishedRuns} />} />
          <Route path="/models/:model/:reasoning" element={<ModelsComparison runs={publishedRuns} />} />
          <Route path="/new" element={<RunBuilder onSave={addRun} />} />
          <Route path="/prompt" element={<PromptLab />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  const link = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : '');
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink to="/" className="brand">
          <div className="brand-mark">◈</div>
          <div><strong>TOUCHLINE</strong><span>Betting desk</span></div>
        </NavLink>
        <nav>
          <NavLink to="/" end className={link}><span>▸</span> Run detail</NavLink>
          <NavLink to="/published" className={link}><span>▸</span> Published runs</NavLink>
          <NavLink to="/models" className={link}><span>▸</span> Models</NavLink>
          <NavLink to="/new" className={link}><span>＋</span> New evaluation</NavLink>
          <NavLink to="/prompt" className={link}><span>⌘</span> Prompt lab</NavLink>
        </nav>
        <div className="sidebar-note">
          <span className="note-tag">The challenge</span>
          <strong>Maximise profit</strong>
          <p>£{STARTING_BANKROLL} bankroll · 72 matches<br />Bet the value, not the favourite.</p>
        </div>
      </aside>
      <main>{children}</main>
    </div>
  );
}

function Dashboard({ runs, onDelete }: { runs: EvaluationRun[]; onDelete: (id: string) => void }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const run = runs.find((item) => item.id === id) ?? runs.find((item) => item.id === BASELINE_ID) ?? runs[0];
  const metrics = useMemo(() => evaluateRun(run, matches), [run]);
  const comparisons = runs.map((item) => ({ run: item, metrics: evaluateRun(item, matches) }));
  const publishedOptions = runs.filter((item) => item.publishedAt);
  const draftOptions = runs.filter((item) => item.id !== BASELINE_ID && !item.publishedAt);
  const kind = run.id === BASELINE_ID ? 'reference' : run.publishedAt ? 'published' : 'draft';
  const status = kind === 'reference' ? 'Reference baseline' : kind === 'published' ? 'Published run' : 'Your local run';

  const remove = () => {
    if (run.id === BASELINE_ID || run.publishedAt) return;
    if (!window.confirm(`Delete ${run.model}?`)) return;
    onDelete(run.id);
    navigate('/');
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow"><span className={`status-dot ${kind}`} />{status}</p>
          <h1>{run.model}</h1>
          <p className="subhead">{run.modelVersion ? `${run.modelVersion} · ` : ''}{run.reasoningEffort ? `${run.reasoningEffort} reasoning · ` : ''}£{STARTING_BANKROLL} bankroll, maximise profit</p>
        </div>
        <button className="primary" onClick={() => navigate('/new')}>＋ New evaluation</button>
      </header>

      <section className="run-toolbar panel">
        <div className="select-wrap">
          <label>Evaluation run</label>
          <select value={run.id} onChange={(event) => navigate(`/runs/${event.target.value}`)}>
            {draftOptions.length > 0 && <optgroup label="Your local runs">{draftOptions.map((item) => <option value={item.id} key={item.id}>{item.model}{item.modelVersion ? ` · ${item.modelVersion}` : ''}</option>)}</optgroup>}
            {publishedOptions.length > 0 && <optgroup label="Published runs">{publishedOptions.map((item) => <option value={item.id} key={item.id}>{item.model}{item.reasoningEffort ? ` · ${item.reasoningEffort}` : ''}</option>)}</optgroup>}
            <optgroup label="Reference only"><option value={baseline.id}>{baseline.model} · not an LLM</option></optgroup>
          </select>
        </div>
        <div className="run-meta">
          <span className="meta-chip">{metrics.betsPlaced} bets</span>
          <span className="meta-chip">{metrics.passes} passed</span>
          <span className="meta-chip">£{metrics.totalStaked.toFixed(0)} staked</span>
          {run.publishedAt && <span className="meta-chip live">✓ published</span>}
        </div>
        {kind === 'draft' && <button className="text-button danger" onClick={remove}>Delete run</button>}
      </section>

      <section className={`run-context ${kind}`}>
        <span>{kind === 'reference' ? `Not an LLM — this spreads the £${STARTING_BANKROLL} evenly across the shortest-priced favourite every match, at the best available price. Beat it by finding value.` : kind === 'published' ? `Published ${new Date(run.publishedAt!).toLocaleDateString()}${run.publisher ? ` via ${run.publisher}` : ''}. Settled at the best of four closing lines.` : 'Only stored in this browser. Copy the Prompt lab pack, run your own model, and paste its wagers to score it here.'}</span>
      </section>

      <section className="metric-grid">
        <Metric label="Net profit" value={money(metrics.totalPnl)} note={`bankroll ends ${gbp(metrics.finalBankroll)}`} tone={metrics.totalPnl >= 0 ? 'positive' : 'negative'} hero />
        <Metric label="Return on bankroll" value={pct(metrics.returnOnBankroll)} note={`£${metrics.totalStaked.toFixed(0)} of £${STARTING_BANKROLL} staked`} tone={metrics.returnOnBankroll >= 0 ? 'positive' : 'negative'} />
        <Metric label="Hit rate" value={pctPlain(metrics.hitRate)} note={`${metrics.betsPlaced} bets · avg odds ${metrics.averageOdds.toFixed(2)}`} />
        <Metric label="Brier score" value={metrics.brier.toFixed(3)} note="calibration · lower is better" tone={metrics.brier <= 0.6 ? 'positive' : undefined} />
      </section>

      <section className="dashboard-grid">
        <div className="panel chart-panel">
          <PanelTitle title="Cumulative profit" detail="Bankroll P&L after each settled wager" />
          <ProfitChart metrics={metrics} />
        </div>
        <div className="panel comparison-panel">
          <PanelTitle title="Leaderboard" detail="Every run by net P&L" />
          <div className="leader-list">
            {[...comparisons].sort((a, b) => b.metrics.totalPnl - a.metrics.totalPnl).map(({ run: item, metrics: itemMetrics }, index) => (
              <button className={`leader-row ${item.id === run.id ? 'selected' : ''}`} key={item.id} onClick={() => navigate(`/runs/${item.id}`)}>
                <span className="rank">{String(index + 1).padStart(2, '0')}</span>
                <span className="leader-name"><strong>{item.model}</strong><small>{itemMetrics.betsPlaced} bets · {pctPlain(itemMetrics.hitRate)} hit</small></span>
                <span className={`mono ${itemMetrics.totalPnl >= 0 ? 'positive-text' : 'negative-text'}`}>{money(itemMetrics.totalPnl)}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="panel results-panel">
        <div className="results-heading"><PanelTitle title="Wager ledger" detail="Every decision settled at the best available price" /></div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Match</th><th>Bet</th><th>Stake</th><th>Best odds</th><th>Model P(side)</th><th>Result</th><th>P&amp;L</th></tr></thead>
            <tbody>
              {metrics.settled.map((row) => {
                const placed = row.bet !== 'PASS' && row.stake > 0;
                return (
                  <tr key={row.match.id} className={placed ? '' : 'pass-row'}>
                    <td><div className="fixture"><span>GROUP {row.match.group}</span><strong>{row.match.homeTeam} <i>v</i> {row.match.awayTeam}</strong></div></td>
                    <td><BetTag bet={row.bet} won={row.won} placed={placed} isValue={row.isValue} /></td>
                    <td className="mono">{placed ? gbp(row.stake) : '—'}</td>
                    <td className="mono">{placed ? row.odds.toFixed(2) : '—'}</td>
                    <td className="mono muted-num">{placed && row.bet !== 'PASS' ? pctPlain(row.probs[row.bet]) : '—'}</td>
                    <td><span className="actual">{outcomeName(row.actual, row.match)}</span></td>
                    <td className={`mono pnl ${row.pnl > 0 ? 'positive-text' : row.pnl < 0 ? 'negative-text' : ''}`}>{placed ? money(row.pnl) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <p className="method-note">The whole £{STARTING_BANKROLL} bankroll is deployed — stakes normalise to sum to £{STARTING_BANKROLL}, capped at £{MAX_STAKE} per match. A winning £s bet at best odds o returns s×(o−1); a losing bet loses s. Brier grades the model's H/D/A probabilities (0 perfect, 0.667 uniform).</p>
    </div>
  );
}

function PublishedRuns({ runs }: { runs: EvaluationRun[] }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const filtered = runs.filter((run) => !query || `${run.model} ${run.modelVersion ?? ''} ${run.reasoningEffort ?? ''} ${run.publisher ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="page">
      <header className="page-header"><div><p className="eyebrow">Public ledger</p><h1>Published runs</h1><p className="subhead">Browse complete, reproducible 72-match profit runs by model.</p></div><span className="count-badge">{runs.length} run{runs.length === 1 ? '' : 's'}</span></header>
      <section className="panel catalogue-toolbar"><input aria-label="Search published runs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search model, version, reasoning, or publisher…" /></section>
      {!filtered.length && <div className="empty-state"><strong>{runs.length ? 'No runs match your search' : 'No published runs yet'}</strong><span>{runs.length ? 'Clear the search to see the full catalogue.' : 'Published profit runs will appear here.'}</span></div>}
      <section className="run-card-grid">
        {filtered.map((run) => {
          const metrics = evaluateRun(run, matches);
          return <button className="run-card panel" key={run.id} onClick={() => navigate(`/runs/${run.id}`)}>
            <div className="run-card-head"><span className="reasoning-badge">{run.reasoningEffort || 'run'}</span><span className={`card-pnl ${metrics.totalPnl >= 0 ? 'positive-text' : 'negative-text'}`}>{money(metrics.totalPnl)}</span></div>
            <h2>{run.model}</h2><p>{run.modelVersion || 'Version not specified'}</p>
            <div className="run-card-metrics"><span><small>ROI</small><strong className={metrics.returnOnBankroll >= 0 ? 'positive-text' : 'negative-text'}>{pct(metrics.returnOnBankroll)}</strong></span><span><small>Hit</small><strong>{pctPlain(metrics.hitRate)}</strong></span><span><small>Brier</small><strong>{metrics.brier.toFixed(3)}</strong></span></div>
            <div className="run-card-foot"><span>{metrics.betsPlaced} bets · {metrics.passes} pass</span><span className="go">Ledger →</span></div>
          </button>;
        })}
      </section>
    </div>
  );
}

function ModelsComparison({ runs }: { runs: EvaluationRun[] }) {
  const { model: modelParam, reasoning: reasoningParam } = useParams();
  const navigate = useNavigate();
  const families = useMemo(() => aggregateModelFamilies(runs, matches), [runs]);

  const family: ModelFamilySummary | undefined = families.find((item) => item.model === modelParam) ?? families[0];
  const level = family?.reasoningLevels.find((item) => item.reasoningEffort === reasoningParam) ?? family?.reasoningLevels[0];
  const levelRuns = family && level
    ? runs.filter((run) => run.model === family.model && (run.reasoningEffort?.trim() || 'unspecified') === level.reasoningEffort).sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    : [];

  return (
    <div className="page">
      <header className="page-header"><div><p className="eyebrow">Model comparison</p><h1>Who turns the biggest profit?</h1><p className="subhead">Rank models by average net P&L, then drill into each reasoning level and its runs.</p></div></header>
      {!families.length ? <div className="empty-state"><strong>No models to compare yet</strong><span>Published runs will appear here automatically.</span></div> : <>
        <section className="panel model-table-wrap"><table className="model-table"><thead><tr><th>Model</th><th>Levels</th><th>Runs</th><th>Bets</th><th>Avg. P&amp;L</th><th>Avg. ROI</th><th>Brier</th><th>Best P&amp;L</th></tr></thead><tbody>
          {families.map((item, index) => <tr key={item.model} className={item.model === family?.model ? 'selected-model' : ''} onClick={() => navigate(`/models/${encodeURIComponent(item.model)}`)}>
            <td><span className="model-rank">{String(index + 1).padStart(2, '0')}</span><strong>{item.model}</strong></td>
            <td><span className="reasoning-badge">{item.reasoningLevels.length}</span></td>
            <td className="mono">{item.runs}</td><td className="mono">{item.betsPlaced}</td>
            <td className={`mono ${item.averagePnl >= 0 ? 'positive-text' : 'negative-text'}`}>{money(item.averagePnl)}</td>
            <td className={`mono ${item.averageRoi >= 0 ? 'positive-text' : 'negative-text'}`}>{pct(item.averageRoi)}</td>
            <td className="mono muted-num">{item.averageBrier.toFixed(3)}</td><td className={`mono ${item.bestPnl >= 0 ? 'positive-text' : 'negative-text'}`}>{money(item.bestPnl)}</td>
          </tr>)}
        </tbody></table></section>
        {family && <section className="model-breakdown">
          <div className="model-hero panel"><div><span className="eyebrow">Selected model</span><h2>{family.model}</h2><p>{family.reasoningLevels.length} reasoning level{family.reasoningLevels.length === 1 ? '' : 's'} · {family.runs} run{family.runs === 1 ? '' : 's'} · {family.betsPlaced} bets</p></div><div className="condition-compare"><span><small>Average P&amp;L</small><strong className={family.averagePnl >= 0 ? 'positive-text' : 'negative-text'}>{money(family.averagePnl)}</strong></span><i>best</i><span><small>Best run</small><strong className={family.bestPnl >= 0 ? 'positive-text' : 'negative-text'}>{money(family.bestPnl)}</strong></span></div></div>
          <div className="panel reasoning-panel">
            <PanelTitle title="Reasoning levels" detail="Select an effort setting to compare its runs" />
            <div className="reasoning-list">
              {family.reasoningLevels.map((item) => <button key={item.reasoningEffort} className={`reasoning-row ${item.reasoningEffort === level?.reasoningEffort ? 'selected' : ''}`} onClick={() => navigate(`/models/${encodeURIComponent(family.model)}/${encodeURIComponent(item.reasoningEffort)}`)}>
                <span className="reasoning-badge">{item.reasoningEffort}</span>
                <span className="reasoning-meta"><small>{item.runs} run{item.runs === 1 ? '' : 's'}</small><small>Brier {item.averageBrier.toFixed(3)}</small></span>
                <span className={`mono ${item.averagePnl >= 0 ? 'positive-text' : 'negative-text'}`}>{money(item.averagePnl)}</span>
              </button>)}
            </div>
          </div>
        </section>}
        {family && level && <section className="panel model-run-list">
          <PanelTitle title="Run history" detail={`${family.model} · ${level.reasoningEffort} reasoning`} />
          {levelRuns.map((run) => { const metrics = evaluateRun(run, matches); return <button key={run.id} onClick={() => navigate(`/runs/${run.id}`)}><span><strong>{run.modelVersion || run.model}</strong><small>{metrics.betsPlaced} bets · {pctPlain(metrics.hitRate)} hit · {run.publisher || 'CLI'}</small></span><span className={`mono ${metrics.returnOnBankroll >= 0 ? 'positive-text' : 'negative-text'}`}>{pct(metrics.returnOnBankroll)}</span><span className={`mono ${metrics.totalPnl >= 0 ? 'positive-text' : 'negative-text'}`}>{money(metrics.totalPnl)}</span><b>→</b></button>; })}
        </section>}
      </>}
    </div>
  );
}

function RunBuilder({ onSave }: { onSave: (run: EvaluationRun) => void }) {
  const navigate = useNavigate();
  const [model, setModel] = useState('');
  const [modelVersion, setModelVersion] = useState('');
  const [reasoningEffort, setReasoningEffort] = useState('');
  const [promptVersion, setPromptVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [jsonInput, setJsonInput] = useState('');
  const [preview, setPreview] = useState<RunMetrics | null>(null);
  const [imported, setImported] = useState<ReturnType<typeof validateWagers> | null>(null);
  const [error, setError] = useState('');

  const importJson = () => {
    try {
      const wagers = validateWagers(JSON.parse(jsonInput), matches);
      setImported(wagers);
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
    const id = crypto.randomUUID();
    onSave({
      id, model: model.trim(), createdAt: new Date().toISOString(), wagers: imported,
      notes: notes.trim() || undefined,
      modelVersion: modelVersion.trim() || undefined,
      reasoningEffort: reasoningEffort.trim() || undefined,
      promptVersion: promptVersion.trim() || undefined,
    });
    navigate(`/runs/${id}`);
  };

  return (
    <div className="page">
      <header className="page-header"><div><p className="eyebrow">New evaluation</p><h1>Load model wagers</h1><p className="subhead">Paste the JSON array your model returned from the Prompt lab pack.</p></div><button className="text-button" onClick={() => navigate(-1)}>← Back</button></header>
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
        <PanelTitle title="Wager import" detail='[{"matchId":"2026-A-01","bet":"A","stake":6.5,"probs":{"H":0.3,"D":0.28,"A":0.42}}]' />
        <textarea value={jsonInput} onChange={(event) => setJsonInput(event.target.value)} placeholder="Paste the model's JSON array here…" />
        <div className="import-actions"><button className="secondary" onClick={importJson}>Import &amp; score</button><span>{imported ? `${imported.length} wagers loaded` : 'Scoring runs the moment you import.'}</span></div>
      </section>
      {preview && (
        <section className="metric-grid">
          <Metric label="Net profit" value={money(preview.totalPnl)} note={`bankroll ${gbp(preview.finalBankroll)}`} tone={preview.totalPnl >= 0 ? 'positive' : 'negative'} hero />
          <Metric label="Return on bankroll" value={pct(preview.returnOnBankroll)} note={`£${preview.totalStaked.toFixed(0)} of £${STARTING_BANKROLL} staked`} tone={preview.returnOnBankroll >= 0 ? 'positive' : 'negative'} />
          <Metric label="Hit rate" value={pctPlain(preview.hitRate)} note={`${preview.betsPlaced} bets · ${preview.passes} pass`} />
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
    <div className="page">
      <header className="page-header"><div><p className="eyebrow">Prompt lab</p><h1>Run the profit challenge</h1><p className="subhead">A result-free pack that asks a model to maximise profit, not accuracy.</p></div></header>
      <section className="prompt-layout">
        <div className="panel prompt-controls">
          <h2>The rules</h2>
          <ul className="challenge-list">
            <li>Deploy the full £{STARTING_BANKROLL} bankroll — stakes must sum to £{STARTING_BANKROLL}, max £{MAX_STAKE} per match.</li>
            <li>Back Home, Draw, Away, or PASS (£0) on the rest.</li>
            <li>Winners settle at the best of four closing prices (line shopping).</li>
            <li>Only value bets win — the model estimates its own probabilities.</li>
          </ul>
          <div className="guardrail"><strong>Leakage guard</strong><p>Fixtures include odds only — never scores or results. The prompt forbids browsing, search, retrieval, and tool use.</p></div>
          <div className="knowledge-warning"><strong>Knowledge-cutoff warning</strong><p>Use a model snapshot with a cutoff before 11 June 2026 and disable all tools at the API level, or results in training data will leak.</p></div>
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

function Metric({ label, value, note, tone, hero }: { label: string; value: string; note: string; tone?: 'positive' | 'negative'; hero?: boolean }) {
  return <div className={`metric-card ${hero ? 'hero' : ''} ${tone ?? ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function PanelTitle({ title, detail }: { title: string; detail: string }) {
  return <div className="panel-title"><h2>{title}</h2><p>{detail}</p></div>;
}

function BetTag({ bet, won, placed, isValue }: { bet: Bet; won: boolean; placed: boolean; isValue: boolean }) {
  if (!placed) return <span className="bet-tag pass"><b>—</b>Pass</span>;
  return <span className={`bet-tag ${won ? 'won' : 'lost'}`}><b>{bet}</b>{BET_LABELS[bet]}{isValue && <i className="value-dot" title="Model judged this +EV">◆</i>}</span>;
}

function ProfitChart({ metrics }: { metrics: RunMetrics }) {
  const width = 760, height = 230, pad = 26;
  const points = [{ x: 0, y: 0 }, ...metrics.settled.map((row, index) => ({ x: index + 1, y: row.cumulativePnl }))];
  const values = points.map((point) => point.y);
  const min = Math.min(...values, -1), max = Math.max(...values, 1);
  const x = (value: number) => pad + value / Math.max(metrics.matches, 1) * (width - pad * 2);
  const y = (value: number) => pad + (max - value) / (max - min) * (height - pad * 2);
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${x(point.x)} ${y(point.y)}`).join(' ');
  const area = `${path} L ${x(metrics.matches)} ${height - pad} L ${pad} ${height - pad} Z`;
  const up = metrics.totalPnl >= 0;
  return (
    <div className="profit-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Cumulative profit chart" preserveAspectRatio="none">
        {[0, .25, .5, .75, 1].map((part) => <line key={part} x1={pad} x2={width - pad} y1={pad + part * (height - pad * 2)} y2={pad + part * (height - pad * 2)} className="grid-line" />)}
        <line x1={pad} x2={width - pad} y1={y(0)} y2={y(0)} className="zero-line" />
        <defs>
          <linearGradient id="area-up" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--profit)" stopOpacity=".26" /><stop offset="1" stopColor="var(--profit)" stopOpacity="0" /></linearGradient>
          <linearGradient id="area-down" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--loss)" stopOpacity=".22" /><stop offset="1" stopColor="var(--loss)" stopOpacity="0" /></linearGradient>
        </defs>
        <path d={area} fill={`url(#area-${up ? 'up' : 'down'})`} /><path d={path} className={`profit-line ${up ? 'up' : 'down'}`} />
        {points.length > 1 && <circle cx={x(points.at(-1)!.x)} cy={y(points.at(-1)!.y)} r="4.5" className={`last-dot ${up ? 'up' : 'down'}`} />}
      </svg>
      <div className="chart-axis"><span>Match 1</span><span>{metrics.matches ? `Match ${metrics.matches}` : 'No picks'}</span></div>
    </div>
  );
}

export default App;
