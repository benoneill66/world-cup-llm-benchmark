import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

describe('profit benchmark dashboard', () => {
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

  it('renders the flat-favourite baseline and wager ledger', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Flat-favourite baseline' })).toBeTruthy();
    expect(screen.getByText('This is not an LLM result')).toBeTruthy();
    expect(screen.getByText('Net profit')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Wager ledger' })).toBeTruthy();
  });

  it('exposes the profit prompt and wager importer', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Prompt lab/i }));
    expect(screen.getByRole('heading', { name: 'Run the profit challenge' })).toBeTruthy();
    expect(screen.getByText('Leakage guard')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /New evaluation/i }));
    expect(screen.getByRole('heading', { name: 'Load model wagers' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import & score' })).toBeTruthy();
  });

  it('provides published-run browsing and model drill-down screens', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Published runs/i }));
    expect(screen.getByRole('heading', { name: 'Published runs' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^≋ Models$/i }));
    expect(screen.getByRole('heading', { name: 'Who turns the biggest profit?' })).toBeTruthy();
  });

  it('does not expose any publish controls', () => {
    render(<App />);
    expect(screen.queryByRole('button', { name: /^Publish/i })).toBeNull();
  });
});
