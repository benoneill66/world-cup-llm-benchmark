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

const MAX_STAKE = 10;
const BET_ALIAS = { H: 'H', D: 'D', A: 'A', PASS: 'PASS', WIN: 'H', DRAW: 'D', LOSS: 'A', HOME: 'H', AWAY: 'A', NONE: 'PASS', SKIP: 'PASS' };
const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

function normalizeBet(value) {
  return BET_ALIAS[String(value ?? 'PASS').toUpperCase()];
}

export function validatePublishedRun(input, validMatchIds) {
  if (!input || typeof input !== 'object') return 'Request body must be an object.';
  if (typeof input.id !== 'string' || !input.id.trim() || input.id.length > 100) return 'A valid run id is required.';
  if (typeof input.model !== 'string' || !input.model.trim() || input.model.trim().length > 100) return 'A model name is required.';
  if (!Array.isArray(input.wagers) || input.wagers.length !== validMatchIds.size) return `Published runs must contain all ${validMatchIds.size} wagers.`;
  const seen = new Set();
  for (const wager of input.wagers) {
    if (!wager || typeof wager.matchId !== 'string' || !validMatchIds.has(wager.matchId)) return 'A wager contains an unknown match id.';
    if (!normalizeBet(wager.bet)) return 'Wager bet must be H, D, A, or PASS.';
    if (typeof wager.stake !== 'number' || !Number.isFinite(wager.stake) || wager.stake < 0 || wager.stake > MAX_STAKE + 1e-9) return `Stakes must be between 0 and ${MAX_STAKE}.`;
    if (!wager.probs || typeof wager.probs !== 'object') return 'Each wager needs a probs object.';
    if (seen.has(wager.matchId)) return `Duplicate wager for ${wager.matchId}.`;
    seen.add(wager.matchId);
  }
  for (const field of ['notes', 'modelVersion', 'reasoningEffort', 'promptVersion', 'publisher']) {
    if (input[field] !== undefined && (typeof input[field] !== 'string' || input[field].length > 500)) return `${field} is invalid.`;
  }
  return null;
}

export function normalizePublishedRun(input) {
  return {
    ...input,
    wagers: input.wagers.map((wager) => {
      const bet = normalizeBet(wager.bet);
      const stake = bet === 'PASS' ? 0 : Math.max(0, Math.min(MAX_STAKE, round2(Number(wager.stake) || 0)));
      const raw = wager.probs || {};
      let H = Number(raw.H) || 0, D = Number(raw.D) || 0, A = Number(raw.A) || 0;
      const total = H + D + A;
      if (total > 0) { H /= total; D /= total; A /= total; }
      return { matchId: wager.matchId, bet, stake, probs: { H, D, A } };
    }),
  };
}
