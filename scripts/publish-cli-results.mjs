import { readFile } from 'node:fs/promises';
import matches from '../src/data/matches.json' with { type: 'json' };

const root = process.argv[2] || '/tmp/world-cup-model-runs';
const api = process.argv[3] || 'http://127.0.0.1:8787/api/runs';
const validIds = new Set(matches.map((match) => match.id));

const codexModels = [
  ['gpt-5.4-mini', 'GPT-5.4 Mini'],
  ['gpt-5.4', 'GPT-5.4'],
  ['gpt-5.5', 'GPT-5.5'],
  ['gpt-5.6-luna', 'GPT-5.6 Luna'],
  ['gpt-5.6-sol', 'GPT-5.6 Sol'],
  ['gpt-5.6-terra', 'GPT-5.6 Terra'],
];
const claudeModels = [
  ['haiku', 'Claude Haiku'],
  ['sonnet', 'Claude Sonnet'],
  ['opus', 'Claude Opus'],
  ['fable', 'Claude Fable'],
];

function validate(predictions, label) {
  if (!Array.isArray(predictions) || predictions.length !== 72) throw new Error(`${label}: expected 72 predictions.`);
  const seen = new Set();
  for (const prediction of predictions) {
    if (!validIds.has(prediction.matchId)) throw new Error(`${label}: unknown match ${prediction.matchId}.`);
    if (!['WIN', 'DRAW', 'LOSS'].includes(prediction.outcome)) throw new Error(`${label}: invalid outcome for ${prediction.matchId}.`);
    if (seen.has(prediction.matchId)) throw new Error(`${label}: duplicate match ${prediction.matchId}.`);
    seen.add(prediction.matchId);
  }
  return predictions;
}

function extractClaudePredictions(wrapper, label) {
  const start = wrapper.result.indexOf('[');
  const end = wrapper.result.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error(`${label}: response did not contain a JSON array.`);
  return JSON.parse(wrapper.result.slice(start, end + 1)).map((item) => ({
    matchId: item.matchId,
    outcome: item.outcome ?? item.prediction ?? item.result,
  }));
}

async function publish(payload) {
  const response = await fetch(api, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${payload.model}: ${body.error || response.statusText}`);
  console.log(`Published ${body.run.model} (${body.run.modelVersion})`);
}

for (const [slug, name] of codexModels) {
  const output = JSON.parse(await readFile(`${root}/codex-${slug}/result.json`, 'utf8'));
  await publish({
    id: `codex-${slug}-bet365-cli-v1`,
    model: name,
    modelVersion: slug,
    reasoningEffort: 'none',
    promptVersion: 'closing-odds-cli-v1',
    oddsSource: 'bet365',
    publisher: 'Codex CLI 0.144.1',
    notes: 'Ephemeral isolated directory; user config and rules ignored; read-only sandbox; no result data supplied; no search or tool calls.',
    createdAt: new Date().toISOString(),
    predictions: validate(output.predictions, name),
  });
}

for (const [alias, name] of claudeModels) {
  const wrapper = JSON.parse(await readFile(`${root}/claude-${alias}/response.json`, 'utf8'));
  const actualVersion = Object.keys(wrapper.modelUsage).find((version) => version.includes(`-${alias}-`)) || Object.keys(wrapper.modelUsage).at(-1);
  const webSearches = Object.values(wrapper.modelUsage).reduce((total, usage) => total + (usage.webSearchRequests || 0), 0);
  if (webSearches) throw new Error(`${name}: reported ${webSearches} web searches.`);
  await publish({
    id: `claude-${alias}-bet365-cli-v1`,
    model: name,
    modelVersion: actualVersion,
    reasoningEffort: 'low',
    promptVersion: 'closing-odds-cli-v1',
    oddsSource: 'bet365',
    publisher: 'Claude Code 2.1.206',
    notes: 'Isolated directory; safe mode; no session persistence; all tools disabled; empty strict MCP config; no result data supplied; telemetry confirmed zero web searches.',
    createdAt: new Date().toISOString(),
    predictions: validate(extractClaudePredictions(wrapper, name), name),
  });
}
