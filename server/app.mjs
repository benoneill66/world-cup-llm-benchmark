import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import matches from '../src/data/matches.json' with { type: 'json' };
import { normalizePublishedRun, readRuns, validatePublishedRun, writeRuns } from './store.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export function createApp({
  // Results are stored in the repo as a committed JSON file — this is the single source
  // of truth the static site bundles and the curator server reads/writes.
  storePath = resolve(here, '../src/data/published-runs.json'),
  serveFrontend = false,
  // Publishing is off by default: the public site is browse-only. Curators enable it
  // locally with TOUCHLINE_ALLOW_PUBLISH=1 to seed the catalogue via the CLI batch.
  allowPublish = process.env.TOUCHLINE_ALLOW_PUBLISH === '1',
} = {}) {
  const app = express();
  const validMatchIds = new Set(matches.map((match) => match.id));
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', (_request, response) => response.json({ ok: true, matches: validMatchIds.size, allowPublish }));

  app.get('/api/runs', async (request, response, next) => {
    try {
      let runs = await readRuns(storePath);
      const model = typeof request.query.model === 'string' ? request.query.model.toLowerCase() : '';
      if (model) runs = runs.filter((run) => run.model.toLowerCase().includes(model));
      response.json({ runs: runs.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)) });
    } catch (error) { next(error); }
  });

  app.get('/api/runs/:id', async (request, response, next) => {
    try {
      const run = (await readRuns(storePath)).find((item) => item.id === request.params.id);
      if (!run) return response.status(404).json({ error: 'Published run not found.' });
      response.json({ run });
    } catch (error) { next(error); }
  });

  app.post('/api/runs', async (request, response, next) => {
    try {
      if (!allowPublish) return response.status(403).json({ error: 'Publishing is disabled on this deployment.' });
      const validationError = validatePublishedRun(request.body, validMatchIds);
      if (validationError) return response.status(400).json({ error: validationError });
      const runs = await readRuns(storePath);
      if (runs.some((run) => run.id === request.body.id)) return response.status(409).json({ error: 'This run has already been published.' });
      const run = {
        ...normalizePublishedRun(request.body),
        model: request.body.model.trim(),
        publishedAt: new Date().toISOString(),
      };
      await writeRuns(storePath, [...runs, run]);
      response.status(201).json({ run });
    } catch (error) { next(error); }
  });

  if (serveFrontend) {
    const dist = resolve(here, '../dist');
    app.use(express.static(dist));
    app.use((_request, response) => response.sendFile(join(dist, 'index.html')));
  }

  app.use((error, _request, response, _next) => {
    console.error(error);
    response.status(500).json({ error: 'The results service could not complete the request.' });
  });
  return app;
}
