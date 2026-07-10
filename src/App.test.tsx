import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  });

  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('renders the complete reference run and per-bet ledger', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Model performance' })).toBeTruthy();
    expect(screen.getByText('72/72 picks')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Prediction ledger' })).toBeTruthy();
    expect(screen.getAllByText('Mexico win').length).toBeGreaterThan(0);
  });

  it('navigates to the blind/odds prompt generator and prediction importer', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Prompt lab/i }));
    expect(screen.getByRole('heading', { name: 'Run a clean evaluation' })).toBeTruthy();
    expect(screen.getByText('Leakage guard')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /New evaluation/i }));
    expect(screen.getByRole('heading', { name: 'Load model predictions' })).toBeTruthy();
    expect(screen.getByText('0 / 72')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import predictions' })).toBeTruthy();
  });
});
