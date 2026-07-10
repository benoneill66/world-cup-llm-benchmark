import type { EvaluationRun } from '../types';
import catalogue from '../data/published-runs.json';

// The public site is browse-only and ships as a static bundle (e.g. GitHub Pages),
// so the published-run catalogue is a JSON file committed to the repo and baked into the
// build rather than fetched from an API. Curators publish new runs by writing this same
// file (directly, or via the local curator server which reads/writes it).
const publishedRuns = (catalogue as EvaluationRun[])
  .slice()
  .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));

export async function fetchPublishedRuns(): Promise<EvaluationRun[]> {
  return publishedRuns;
}
