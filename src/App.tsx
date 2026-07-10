import { useEffect, useMemo, useState } from 'react';
import matchesData from './data/matches.json';
import {
  ODDS_SOURCE_LABELS,
  OUTCOME_LABELS,
  actualOutcome,
  buildPrompt,
  evaluateRun,
  favouritePredictions,
  validatePredictions,
} from './lib/benchmark';
import { loadRuns, saveRuns } from './lib/storage';
import type { EvaluationMode, EvaluationRun, Match, OddsSource, Outcome, Prediction, RunMetrics } from './types';

const matches = matchesData as Match[];
const BASELINE_ID = 'market-favourite-baseline';

const baseline: EvaluationRun = {
  id: BASELINE_ID,
  model: 'Closing favourite baseline',
  mode: 'odds-visible',
  oddsSource: 'marketAverage',
  createdAt: '2026-06-28T04:00:00Z',
  predictions: favouritePredictions(matches, 'marketAverage'),
  notes: 'Reference strategy: select the shortest market-average closing price.',
};

type View = 'dashboard' | 'new-run' | 'prompt';

const money = (value: number) => `${value >= 0 ? '+' : '−'}£${Math.abs(value).toFixed(2)}`;
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

function outcomeText(outcome: Outcome, match: Match) {
  if (outcome === 'D') return 'Draw';
  return outcome === 'H' ? `${match.homeTeam} win` : `${match.awayTeam} win`;
}

function App() {
  const [view, setView] = useState<View>('dashboard');
  const [userRuns, setUserRuns] = useState<EvaluationRun[]>(loadRuns);
  const runs = useMemo(() => [baseline, ...userRuns], [userRuns]);
  const [selectedId, setSelectedId] = useState(BASELINE_ID);
  const selectedRun = runs.find((run) => run.id === selectedId) ?? runs[0];

  useEffect(() => saveRuns(userRuns), [userRuns]);

  const addRun = (run: EvaluationRun) => {
    setUserRuns((current) => [run, ...current]);
    setSelectedId(run.id);
    setView('dashboard');
  };

  const deleteRun = () => {
    if (selectedRun.id === BASELINE_ID) return;
    if (!window.confirm(`Delete ${selectedRun.model}?`)) return;
    setUserRuns((current) => current.filter((run) => run.id !== selectedRun.id));
    setSelectedId(BASELINE_ID);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">T</div>
          <div><strong>TOUCHLINE</strong><span>LLM benchmark</span></div>
        </div>
        <nav>
          <button className={view === 'dashboard' ? 'active' : ''} onClick={() => setView('dashboard')}><span>◫</span> Results</button>
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

  return (
    <div className="page">
      <header className="page-header">
        <div><p className="eyebrow">WORLD CUP 2026 · GROUP STAGE</p><h1>Model performance</h1><p>How well does an LLM find value in the closing 1X2 market?</p></div>
        <button className="primary" onClick={onNew}>＋ New evaluation</button>
      </header>

      <section className="run-toolbar panel">
        <div className="select-wrap">
          <label>Evaluation run</label>
          <select value={run.id} onChange={(event) => onSelect(event.target.value)}>
            {runs.map((item) => <option value={item.id} key={item.id}>{item.model} · {item.mode}</option>)}
          </select>
        </div>
        <div className="run-meta"><ModePill mode={run.mode} /><span>{ODDS_SOURCE_LABELS[run.oddsSource]}</span><span>{metrics.matches}/72 picks</span></div>
        {run.id !== BASELINE_ID && <button className="text-button danger" onClick={onDelete}>Delete run</button>}
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
          <PanelTitle title="Leaderboard" detail="Ranked by £1 flat-stake ROI" />
          {[...comparisons].sort((a, b) => b.metrics.roi - a.metrics.roi).map(({ run: item, metrics: itemMetrics }, index) => (
            <button className={`leader-row ${item.id === run.id ? 'selected' : ''}`} key={item.id} onClick={() => onSelect(item.id)}>
              <span className="rank">{String(index + 1).padStart(2, '0')}</span>
              <span className="leader-name"><strong>{item.model}</strong><small>{item.mode} · {itemMetrics.matches} picks</small></span>
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

function RunBuilder({ onSave, onCancel }: { onSave: (run: EvaluationRun) => void; onCancel: () => void }) {
  const [model, setModel] = useState('');
  const [mode, setMode] = useState<EvaluationMode>('blind');
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
    onSave({ id: crypto.randomUUID(), model: model.trim(), mode, oddsSource, createdAt: new Date().toISOString(), predictions, notes: notes.trim() || undefined });
  };

  return (
    <div className="page builder-page">
      <header className="page-header"><div><p className="eyebrow">NEW EVALUATION</p><h1>Load model predictions</h1><p>Paste an LLM response or choose each 90-minute result manually.</p></div><button className="text-button" onClick={onCancel}>← Back to results</button></header>
      <section className="panel setup-panel">
        <div className="form-grid">
          <label><span>Model / run name</span><input value={model} onChange={(event) => setModel(event.target.value)} placeholder="e.g. GPT-5 · blind · prompt v2" /></label>
          <label><span>Evaluation mode</span><select value={mode} onChange={(event) => setMode(event.target.value as EvaluationMode)}><option value="blind">Blind — no odds shown</option><option value="odds-visible">Odds visible</option></select></label>
          <label><span>Settlement line</span><select value={oddsSource} onChange={(event) => setOddsSource(event.target.value as OddsSource)}>{Object.entries(ODDS_SOURCE_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
          <label><span>Notes (optional)</span><input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Prompt version, temperature, date…" /></label>
        </div>
      </section>
      <section className="panel import-panel">
        <PanelTitle title="JSON import" detail='Expected: [{"matchId":"2026-A-01","outcome":"H"}]' />
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
  const [mode, setMode] = useState<EvaluationMode>('blind');
  const [oddsSource, setOddsSource] = useState<OddsSource>('bet365');
  const [copied, setCopied] = useState(false);
  const prompt = useMemo(() => buildPrompt(matches, mode, oddsSource), [mode, oddsSource]);
  const copy = async () => { await navigator.clipboard.writeText(prompt); setCopied(true); window.setTimeout(() => setCopied(false), 1600); };
  const download = () => {
    const url = URL.createObjectURL(new Blob([prompt], { type: 'text/plain' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `world-cup-2026-${mode}-prompt.txt`; anchor.click(); URL.revokeObjectURL(url);
  };
  return (
    <div className="page prompt-page">
      <header className="page-header"><div><p className="eyebrow">PROMPT LAB</p><h1>Run a clean evaluation</h1><p>Generate a fixture pack that never exposes the benchmark outcomes.</p></div></header>
      <section className="prompt-layout">
        <div className="panel prompt-controls">
          <h2>Experiment setup</h2>
          <label><span>Information condition</span><select value={mode} onChange={(event) => setMode(event.target.value as EvaluationMode)}><option value="blind">Blind — fixtures only</option><option value="odds-visible">Odds visible</option></select></label>
          <label className={mode === 'blind' ? 'disabled' : ''}><span>Odds shown to model</span><select disabled={mode === 'blind'} value={oddsSource} onChange={(event) => setOddsSource(event.target.value as OddsSource)}>{Object.entries(ODDS_SOURCE_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
          <div className="guardrail"><strong>Leakage guard</strong><p>Final scores and actual 1X2 outcomes are omitted. Blind mode also strips every closing price.</p></div>
          <button className="primary full" onClick={copy}>{copied ? 'Copied ✓' : 'Copy prompt'}</button>
          <button className="secondary full" onClick={download}>Download .txt</button>
        </div>
        <div className="panel prompt-preview"><div className="preview-head"><span>world-cup-2026-{mode}.txt</span><span>{matches.length} fixtures</span></div><pre>{prompt}</pre></div>
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

function ModePill({ mode }: { mode: EvaluationMode }) {
  return <span className={`mode-pill ${mode}`}>{mode === 'blind' ? '● BLIND' : '◉ ODDS VISIBLE'}</span>;
}

function ResultTag({ outcome, correct, children }: { outcome: Outcome; correct: boolean; children: React.ReactNode }) {
  return <span className={`result-tag ${correct ? 'correct' : 'wrong'}`}><b>{outcome}</b>{children}</span>;
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
