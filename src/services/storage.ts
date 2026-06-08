import { createInitialState } from '../data/seed';
import type { AppState, SymbolItem } from '../types';

const STORAGE_KEY = 'ai-trading-view.state.v2';
const LEGACY_STORAGE_KEYS = ['ai-trading-view.state.v1'];
const REMOVED_SYMBOLS = new Set(['US:JNPR']);
const NEW_DEFAULT_SYMBOLS = new Set(['US:NOK']);

export function loadState(): AppState {
  const fallback = createInitialState();
  try {
    LEGACY_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<AppState>;
    const tags = Array.isArray(parsed.tags) ? parsed.tags : fallback.tags;
    const { symbols, addedDefaultIds } = Array.isArray(parsed.symbols)
      ? mergeNewDefaultSymbols(normalizeStoredSymbols(parsed.symbols), fallback.symbols)
      : { symbols: fallback.symbols, addedDefaultIds: [] };
    const selectedTagIds = Array.isArray(parsed.selectedTagIds) ? parsed.selectedTagIds : fallback.selectedTagIds;
    const selectedSymbolIds = Array.from(
      new Set([
        ...normalizeSelectedSymbolIds(parsed.selectedSymbolIds, symbols, selectedTagIds, fallback.selectedSymbolIds),
        ...addedDefaultIds,
      ]),
    );
    return {
      ...fallback,
      ...parsed,
      tags,
      symbols,
      selectedSymbolIds,
      selectedTagIds,
    };
  } catch {
    return fallback;
  }
}

export function saveState(state: AppState): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetState(): AppState {
  window.localStorage.removeItem(STORAGE_KEY);
  LEGACY_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
  return createInitialState();
}

function normalizeStoredSymbols(symbols: unknown[]): SymbolItem[] {
  return symbols
    .map((item) => {
      const symbol = item as SymbolItem & { active?: boolean; excludeFromTagAverage?: boolean };
      const { active, excludeFromTagAverage, ...rest } = symbol;
      void active;
      void excludeFromTagAverage;
      return rest;
    })
    .filter((symbol) => !REMOVED_SYMBOLS.has(`${symbol.market}:${symbol.code.trim().toUpperCase()}`));
}

function mergeNewDefaultSymbols(
  storedSymbols: SymbolItem[],
  fallbackSymbols: SymbolItem[],
): { symbols: SymbolItem[]; addedDefaultIds: string[] } {
  const existingKeys = new Set(storedSymbols.map((symbol) => `${symbol.market}:${symbol.code.trim().toUpperCase()}`));
  const addedSymbols = fallbackSymbols.filter((symbol) => {
    const key = `${symbol.market}:${symbol.code.trim().toUpperCase()}`;
    return NEW_DEFAULT_SYMBOLS.has(key) && !existingKeys.has(key);
  });
  if (!addedSymbols.length) {
    return { symbols: storedSymbols, addedDefaultIds: [] };
  }
  return {
    symbols: [...storedSymbols, ...addedSymbols.map((symbol) => ({ ...symbol }))],
    addedDefaultIds: addedSymbols.map((symbol) => symbol.id),
  };
}

function normalizeSelectedSymbolIds(
  value: unknown,
  symbols: SymbolItem[],
  selectedTagIds: string[],
  fallback: string[],
): string[] {
  const validIds = new Set(symbols.map((symbol) => symbol.id));
  const selected = Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && validIds.has(id)) : fallback;
  if (selected.length || !selectedTagIds.length) {
    return selected;
  }
  return symbols
    .filter((symbol) => symbol.tagIds.some((tagId) => selectedTagIds.includes(tagId)))
    .map((symbol) => symbol.id);
}
