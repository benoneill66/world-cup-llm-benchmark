import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function readRuns(storePath) {
  try {
    const value = JSON.parse(await readFile(storePath, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

export async function writeRuns(storePath, runs) {
  await mkdir(dirname(storePath), { recursive: true });
  const temporaryPath = `${storePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(runs, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, storePath);
}

export function validatePublishedRun(input, validMatchIds) {
  if (!input || typeof input !== 'object') return 'Request body must be an object.';
  if (typeof input.id !== 'string' || !input.id.trim() || input.id.length > 100) return 'A valid run id is required.';
  if (typeof input.model !== 'string' || !input.model.trim() || input.model.trim().length > 100) return 'A model name is required.';
  if (!['bet365', 'betfairExchange', 'marketAverage', 'marketBest'].includes(input.oddsSource)) return 'Unknown odds source.';
  if (!Array.isArray(input.predictions) || input.predictions.length !== validMatchIds.size) return `Published runs must contain all ${validMatchIds.size} predictions.`;
  const seen = new Set();
  for (const prediction of input.predictions) {
    if (!prediction || typeof prediction.matchId !== 'string' || !validMatchIds.has(prediction.matchId)) return 'A prediction contains an unknown match id.';
    if (!['H', 'D', 'A', 'WIN', 'DRAW', 'LOSS'].includes(prediction.outcome)) return 'Prediction outcomes must be WIN, DRAW, or LOSS.';
    if (seen.has(prediction.matchId)) return `Duplicate prediction for ${prediction.matchId}.`;
    seen.add(prediction.matchId);
  }
  for (const field of ['notes', 'modelVersion', 'reasoningEffort', 'promptVersion', 'publisher']) {
    if (input[field] !== undefined && (typeof input[field] !== 'string' || input[field].length > 500)) return `${field} is invalid.`;
  }
  return null;
}

export function normalizePublishedRun(input) {
  return {
    ...input,
    predictions: input.predictions.map((prediction) => ({
      ...prediction,
      outcome: prediction.outcome === 'WIN' ? 'H' : prediction.outcome === 'DRAW' ? 'D' : prediction.outcome === 'LOSS' ? 'A' : prediction.outcome,
    })),
  };
}
