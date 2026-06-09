import { createInitialState } from '../data/seed';
import type { AppState, ChartMode, DateRangePreset, Interval, MarketFilter, SymbolItem, ViewTab } from '../types';

const STORAGE_KEY = 'ai-trading-view.state.v2';
const WORKSPACE_SESSION_KEY = 'ai-trading-view.workspace-session.v1';
const WORKSPACE_HISTORY_KEY = 'ai-trading-view.workspace-history.v1';
const LEGACY_STORAGE_KEYS = ['ai-trading-view.state.v1'];
const REMOVED_SYMBOLS = new Set(['US:JNPR']);
const NEW_DEFAULT_SYMBOLS = new Set(['US:NOK']);

export type WorkspaceRole = 'editor' | 'viewer';

export interface WorkspaceSession {
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRole;
  code: string;
  editCode?: string;
  viewCode?: string;
  version: number;
  updatedAt: string | null;
}

export interface WorkspaceHistoryItem extends WorkspaceSession {
  lastUsedAt: string;
}

interface WorkspacePayload {
  workspace: {
    id: string;
    name: string;
    role: WorkspaceRole;
  };
  state?: Partial<AppState> | null;
  version?: number;
  updatedAt?: string | null;
  editCode?: string;
  viewCode?: string;
}

export function loadState(): AppState {
  const fallback = createInitialState();
  try {
    LEGACY_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    return normalizeState(JSON.parse(raw));
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

export function loadWorkspaceSession(): WorkspaceSession | null {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_SESSION_KEY);
    if (!raw) {
      return null;
    }
    return normalizeSession(JSON.parse(raw) as WorkspaceSession);
  } catch {
    return null;
  }
}

export function saveWorkspaceSession(session: WorkspaceSession): void {
  window.localStorage.setItem(WORKSPACE_SESSION_KEY, JSON.stringify(session));
  rememberWorkspaceSession(session);
}

export function clearWorkspaceSession(): void {
  window.localStorage.removeItem(WORKSPACE_SESSION_KEY);
}

export function loadWorkspaceHistory(): WorkspaceHistoryItem[] {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_HISTORY_KEY);
    if (!raw) {
      return [];
    }
    return normalizeWorkspaceHistory(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function forgetWorkspaceHistory(workspaceId: string): void {
  const next = loadWorkspaceHistory().filter((item) => item.workspaceId !== workspaceId);
  window.localStorage.setItem(WORKSPACE_HISTORY_KEY, JSON.stringify(next));
}

function rememberWorkspaceSession(session: WorkspaceSession): void {
  const normalized = normalizeSession(session);
  if (!normalized) {
    return;
  }
  const history = loadWorkspaceHistory();
  const existing = history.find((item) => item.workspaceId === normalized.workspaceId);
  const nextItem: WorkspaceHistoryItem = {
    ...existing,
    ...normalized,
    lastUsedAt: new Date().toISOString(),
  };
  const next = [
    nextItem,
    ...history.filter((item) => item.workspaceId !== normalized.workspaceId),
  ].slice(0, 12);
  window.localStorage.setItem(WORKSPACE_HISTORY_KEY, JSON.stringify(next));
}

export async function createWorkspace(name: string, state: AppState): Promise<{ session: WorkspaceSession; state: AppState | null }> {
  const response = await fetch('/api/workspaces', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, state }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  const payload = (await response.json()) as WorkspacePayload;
  const session = payloadToSession(payload, payload.editCode ?? '');
  saveWorkspaceSession(session);
  return { session, state: payload.state ? normalizeState(payload.state) : null };
}

export async function joinWorkspace(code: string): Promise<{ session: WorkspaceSession; state: AppState | null }> {
  const response = await fetch('/api/workspaces/join', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  const payload = (await response.json()) as WorkspacePayload;
  const session = payloadToSession(payload, code);
  saveWorkspaceSession(session);
  return { session, state: payload.state ? normalizeState(payload.state) : null };
}

export async function loadRemoteState(session: WorkspaceSession): Promise<{ state: AppState | null; session: WorkspaceSession }> {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(session.workspaceId)}/state`, {
    headers: workspaceHeaders(session),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  const payload = (await response.json()) as WorkspacePayload;
  const nextSession = payloadToSession(payload, session.code, session);
  saveWorkspaceSession(nextSession);
  return { state: payload.state ? normalizeState(payload.state) : null, session: nextSession };
}

export async function saveRemoteState(session: WorkspaceSession, state: AppState): Promise<WorkspaceSession> {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(session.workspaceId)}/state`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...workspaceHeaders(session),
    },
    body: JSON.stringify({ state, version: session.version }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  const payload = (await response.json()) as WorkspacePayload;
  const nextSession = payloadToSession(payload, session.code, session);
  saveWorkspaceSession(nextSession);
  return nextSession;
}

export async function resetRemoteState(session: WorkspaceSession): Promise<WorkspaceSession> {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(session.workspaceId)}/reset`, {
    method: 'POST',
    headers: workspaceHeaders(session),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  const payload = (await response.json()) as WorkspacePayload;
  const nextSession = payloadToSession(payload, session.code, session);
  saveWorkspaceSession(nextSession);
  return nextSession;
}

export async function rotateWorkspaceCode(
  session: WorkspaceSession,
  role: WorkspaceRole,
): Promise<{ session: WorkspaceSession; code: string; role: WorkspaceRole }> {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(session.workspaceId)}/rotate-code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...workspaceHeaders(session),
    },
    body: JSON.stringify({ role }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  const payload = (await response.json()) as WorkspacePayload & { code: string; role: WorkspaceRole };
  const nextSession: WorkspaceSession = {
    ...session,
    code: payload.role === 'editor' ? payload.code : session.code,
    workspaceName: payload.workspace?.name ?? session.workspaceName,
    version: payload.version ?? session.version,
    updatedAt: payload.updatedAt ?? session.updatedAt,
    ...(payload.role === 'editor' ? { editCode: payload.code } : { viewCode: payload.code }),
  };
  saveWorkspaceSession(nextSession);
  return { session: nextSession, code: payload.code, role: payload.role };
}

function workspaceHeaders(session: WorkspaceSession): Record<string, string> {
  return {
    'X-Workspace-Code': session.code,
  };
}

function normalizeSession(value: WorkspaceSession): WorkspaceSession | null {
  if (!value?.workspaceId || !value?.code) {
    return null;
  }
  return {
    workspaceId: value.workspaceId,
    workspaceName: value.workspaceName || '我的工作区',
    role: value.role === 'viewer' ? 'viewer' : 'editor',
    code: value.code,
    editCode: value.editCode,
    viewCode: value.viewCode,
    version: Number(value.version ?? 0),
    updatedAt: value.updatedAt ?? null,
  };
}

function normalizeWorkspaceHistory(value: unknown): WorkspaceHistoryItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const items: WorkspaceHistoryItem[] = [];
  value.forEach((item) => {
    const session = normalizeSession(item as WorkspaceSession);
    if (!session || seen.has(session.workspaceId)) {
      return;
    }
    seen.add(session.workspaceId);
    items.push({
      ...session,
      lastUsedAt:
        typeof (item as WorkspaceHistoryItem).lastUsedAt === 'string'
          ? (item as WorkspaceHistoryItem).lastUsedAt
          : session.updatedAt || new Date(0).toISOString(),
    });
  });
  return items
    .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
    .slice(0, 12);
}

function payloadToSession(
  payload: WorkspacePayload,
  code: string,
  previous?: WorkspaceSession,
): WorkspaceSession {
  return {
    workspaceId: payload.workspace.id,
    workspaceName: payload.workspace.name,
    role: payload.workspace.role,
    code,
    editCode: payload.editCode ?? previous?.editCode ?? (payload.workspace.role === 'editor' ? code : undefined),
    viewCode: payload.viewCode ?? previous?.viewCode,
    version: payload.version ?? previous?.version ?? 0,
    updatedAt: payload.updatedAt ?? previous?.updatedAt ?? null,
  };
}

function normalizeState(value: unknown): AppState {
  const fallback = createInitialState();
  const parsed = value as Partial<AppState>;
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
  const marketFilter = normalizeMarketFilter(parsed.marketFilter, fallback.marketFilter);
  const dateRangePreset = normalizeDateRangePreset(parsed.dateRangePreset, fallback.dateRangePreset);
  const stateDateRange = resolveDateRange(dateRangePreset, parsed.startDate, parsed.endDate, fallback);
  const baseState = {
    ...fallback,
    ...parsed,
    tags,
    symbols,
    selectedSymbolIds,
    selectedTagIds,
    marketFilter,
    dateRangePreset,
    startDate: stateDateRange.startDate,
    endDate: stateDateRange.endDate,
  } as AppState;
  const viewTabs = normalizeViewTabs(parsed.viewTabs, baseState, fallback.viewTabs);
  const activeViewId =
    typeof parsed.activeViewId === 'string' && viewTabs.some((view) => view.id === parsed.activeViewId)
      ? parsed.activeViewId
      : viewTabs[0]?.id || 'view-current';
  return {
    ...baseState,
    viewTabs,
    activeViewId,
  };
}

function normalizeViewTabs(value: unknown, state: AppState, fallback: ViewTab[]): ViewTab[] {
  const symbolIds = new Set(state.symbols.map((symbol) => symbol.id));
  const tagIds = new Set(state.tags.map((tag) => tag.id));
  const source = Array.isArray(value) && value.length ? value : null;
  if (!source) {
    return [
      createViewTabFromState(
        typeof state.activeViewId === 'string' ? state.activeViewId : 'view-current',
        '当前视图',
        state,
        symbolIds,
        tagIds,
      ),
    ];
  }

  const normalized = source
    .map((item, index) => normalizeViewTab(item, index, state, symbolIds, tagIds))
    .filter((item): item is ViewTab => Boolean(item));

  if (normalized.length) {
    return normalized;
  }

  return fallback.length
    ? fallback.map((view) => normalizeViewTab(view, 0, state, symbolIds, tagIds)).filter((item): item is ViewTab => Boolean(item))
    : [createViewTabFromState('view-current', '当前视图', state, symbolIds, tagIds)];
}

function normalizeViewTab(
  value: unknown,
  index: number,
  state: AppState,
  symbolIds: Set<string>,
  tagIds: Set<string>,
): ViewTab | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const parsed = value as Partial<ViewTab>;
  const id = typeof parsed.id === 'string' && parsed.id.trim() ? parsed.id : `view-${index + 1}`;
  const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : `视图 ${index + 1}`;
  return {
    id,
    name,
    selectedSymbolIds: normalizeIds(parsed.selectedSymbolIds, symbolIds, state.selectedSymbolIds),
    selectedTagIds: normalizeIds(parsed.selectedTagIds, tagIds, state.selectedTagIds),
    marketFilter: normalizeMarketFilter(parsed.marketFilter, state.marketFilter),
    mode: normalizeChartMode(parsed.mode, state.mode),
    interval: normalizeInterval(parsed.interval, state.interval),
    dateRangePreset: normalizeDateRangePreset(parsed.dateRangePreset, state.dateRangePreset),
    ...resolveDateRange(
      normalizeDateRangePreset(parsed.dateRangePreset, state.dateRangePreset),
      parsed.startDate,
      parsed.endDate,
      state,
    ),
  };
}

function createViewTabFromState(
  id: string,
  name: string,
  state: AppState,
  symbolIds: Set<string>,
  tagIds: Set<string>,
): ViewTab {
  return {
    id,
    name,
    selectedSymbolIds: normalizeIds(state.selectedSymbolIds, symbolIds, []),
    selectedTagIds: normalizeIds(state.selectedTagIds, tagIds, []),
    marketFilter: normalizeMarketFilter(state.marketFilter, 'ALL'),
    mode: normalizeChartMode(state.mode, 'tags'),
    interval: normalizeInterval(state.interval, '1d'),
    dateRangePreset: normalizeDateRangePreset(state.dateRangePreset, 'custom'),
    startDate: state.startDate,
    endDate: state.endDate,
  };
}

function normalizeIds(value: unknown, validIds: Set<string>, fallback: string[]): string[] {
  const source = Array.isArray(value) ? value : fallback;
  return Array.from(new Set(source.filter((id): id is string => typeof id === 'string' && validIds.has(id))));
}

function normalizeChartMode(value: unknown, fallback: ChartMode): ChartMode {
  return value === 'symbols' || value === 'tags' || value === 'mixed' ? value : fallback;
}

function normalizeInterval(value: unknown, fallback: Interval): Interval {
  return value === '1d' || value === '1wk' || value === '1mo' ? value : fallback;
}

function normalizeDateRangePreset(value: unknown, fallback: DateRangePreset): DateRangePreset {
  if (
    value === 'custom' ||
    value === '1w' ||
    value === '2w' ||
    value === '1m' ||
    value === '3m' ||
    value === '6m' ||
    value === '1y' ||
    value === 'ytd'
  ) {
    return value;
  }
  return fallback;
}

function resolveDateRange(
  preset: DateRangePreset,
  startDate: unknown,
  endDate: unknown,
  fallback: Pick<AppState, 'startDate' | 'endDate'>,
): { startDate: string; endDate: string } {
  if (preset === 'custom') {
    return {
      startDate: typeof startDate === 'string' && startDate ? startDate : fallback.startDate,
      endDate: typeof endDate === 'string' && endDate ? endDate : fallback.endDate,
    };
  }

  const today = new Date();
  const end = formatLocalDate(today);
  const start = new Date(today);
  if (preset === 'ytd') {
    start.setMonth(0, 1);
  } else if (preset === '1w') {
    start.setDate(start.getDate() - 7);
  } else if (preset === '2w') {
    start.setDate(start.getDate() - 14);
  } else if (preset === '1m') {
    start.setMonth(start.getMonth() - 1);
  } else if (preset === '3m') {
    start.setMonth(start.getMonth() - 3);
  } else if (preset === '6m') {
    start.setMonth(start.getMonth() - 6);
  } else if (preset === '1y') {
    start.setFullYear(start.getFullYear() - 1);
  }

  return {
    startDate: formatLocalDate(start),
    endDate: end,
  };
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeMarketFilter(value: unknown, fallback: MarketFilter): MarketFilter {
  if (
    value === 'ALL' ||
    value === 'CN_A' ||
    value === 'US' ||
    value === 'HK' ||
    value === 'KR_KOSPI' ||
    value === 'KR_KOSDAQ' ||
    value === 'CUSTOM'
  ) {
    return value;
  }
  return fallback;
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error ?? `共享数据接口请求失败：${response.status}`;
  } catch {
    return `共享数据接口请求失败：${response.status}`;
  }
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
