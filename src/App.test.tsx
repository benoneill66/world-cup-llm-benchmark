import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

describe('benchmark dashboard', () => {
  const store = new Map<string, string>();

  beforeAll(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        clear: () => store.clear(),
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
      },
    });
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: vi.fn() });
  });

  beforeEach(() => {
    localStorage.clear();
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ runs: [] }) } as Response);
  });
  afterEach(cleanup);

  it('renders the complete reference run and per-bet ledger', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Closing favourite baseline' })).toBeTruthy();
    expect(screen.getByText('This is not an LLM result')).toBeTruthy();
    expect(screen.getByText('72/72 picks')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Prediction ledger' })).toBeTruthy();
    expect(screen.getAllByText('Mexico win').length).toBeGreaterThan(0);
  });

  it('navigates to the closing-odds prompt generator and prediction importer', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Prompt lab/i }));
    expect(screen.getByRole('heading', { name: 'Run a clean evaluation' })).toBeTruthy();
    expect(screen.getByText('Leakage guard')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /New evaluation/i }));
    expect(screen.getByRole('heading', { name: 'Load model predictions' })).toBeTruthy();
    expect(screen.getByText('0 / 72')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import predictions' })).toBeTruthy();
  });

  it('provides published-run browsing and model-family drill-down screens', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Published runs/i }));
    expect(screen.getByRole('heading', { name: 'Published runs' })).toBeTruthy();
    // The bundled catalogue renders as browseable run cards.
    expect(await screen.findByRole('heading', { name: /GPT-5.6 Sol/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^≋ Models$/i }));
    expect(screen.getByRole('heading', { name: 'Who reads the market best?' })).toBeTruthy();
    // Models are grouped by family, each drillable into its reasoning levels.
    expect(screen.getByRole('heading', { name: /Reasoning levels/i })).toBeTruthy();
  });

  it('does not expose any publish controls', () => {
    render(<App />);
    expect(screen.queryByRole('button', { name: /^Publish/i })).toBeNull();
  });
});
