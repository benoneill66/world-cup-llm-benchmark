import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import matches from '../src/data/matches.json';
import { normalizePublishedRun, readRuns, validatePublishedRun, writeRuns } from './store.mjs';

const validIds = new Set(matches.map((match) => match.id));
const completeRun = {
  id: 'run-1', model: 'GPT-5', oddsSource: 'bet365', createdAt: new Date().toISOString(),
  predictions: matches.map((match) => ({ matchId: match.id, outcome: 'WIN' })),
};

describe('published run store', () => {
  it('requires a complete, unique benchmark before publishing', () => {
    expect(validatePublishedRun(completeRun, validIds)).toBeNull();
    expect(normalizePublishedRun(completeRun).predictions[0].outcome).toBe('H');
    expect(validatePublishedRun({ ...completeRun, predictions: completeRun.predictions.slice(1) }, validIds)).toContain('all 72');
    expect(validatePublishedRun({ ...completeRun, predictions: completeRun.predictions.map((item, index) => index === 1 ? completeRun.predictions[0] : item) }, validIds)).toContain('Duplicate');
  });

  it('writes and reads the run catalogue atomically', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'touchline-'));
    const path = join(directory, 'runs.json');
    expect(await readRuns(path)).toEqual([]);
    await writeRuns(path, [completeRun]);
    expect(await readRuns(path)).toEqual([completeRun]);
    expect(JSON.parse(await readFile(path, 'utf8'))).toHaveLength(1);
  });
});
