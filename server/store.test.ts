import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import matches from '../src/data/matches.json';
import { normalizePublishedRun, readRuns, validatePublishedRun, writeRuns } from './store.mjs';

const validIds = new Set(matches.map((match) => match.id));
const completeRun = {
  id: 'run-1', model: 'GPT-5', createdAt: new Date().toISOString(),
  wagers: matches.map((match) => ({ matchId: match.id, bet: 'WIN', stake: 5, probs: { H: 2, D: 1, A: 1 } })),
};

describe('published run store', () => {
  it('requires a complete, unique benchmark before publishing', () => {
    expect(validatePublishedRun(completeRun, validIds)).toBeNull();
    const normalized = normalizePublishedRun(completeRun);
    expect(normalized.wagers[0].bet).toBe('H');
    expect(normalized.wagers[0].probs.H).toBeCloseTo(0.5); // 2/(2+1+1)
    expect(validatePublishedRun({ ...completeRun, wagers: completeRun.wagers.slice(1) }, validIds)).toContain('all 72');
    expect(validatePublishedRun({ ...completeRun, wagers: completeRun.wagers.map((item, index) => index === 1 ? completeRun.wagers[0] : item) }, validIds)).toContain('Duplicate');
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
