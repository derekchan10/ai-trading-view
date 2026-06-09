import { createInitialState } from '../data/seed';
import type { AppState, ChartMode, Interval, MarketFilter, SymbolItem, ViewTab } from '../types';

const STORAGE_KEY = 'ai-trading-view.state.v2';
const WORKSPACE_SESSION_KEY = 'ai-trading-view.workspace-session.v1';
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
}

export function clearWorkspaceSession(): void {
  window.localStorage.removeItem(WORKSPACE_SESSION_KEY);
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
  const baseState = {
    ...fallback,
    ...parsed,
    tags,
    symbols,
    selectedSymbolIds,
    selectedTagIds,
    marketFilter,
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
    startDate: typeof parsed.startDate === 'string' && parsed.startDate ? parsed.startDate : state.startDate,
    endDate: typeof parsed.endDate === 'string' && parsed.endDate ? parsed.endDate : state.endDate,
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
