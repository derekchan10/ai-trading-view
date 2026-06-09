import type { CSSProperties, FormEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  CirclePlus,
  Copy,
  DatabaseZap,
  KeyRound,
  ListChecks,
  Pencil,
  Shuffle,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Tags,
  Trash2,
  X,
} from 'lucide-react';
import { PerformanceChart } from './components/PerformanceChart';
import type { ChartExportPayload } from './components/PerformanceChart';
import { buildPerformanceSeries } from './services/marketData';
import {
  clearWorkspaceSession,
  createWorkspace,
  joinWorkspace,
  loadRemoteState,
  loadState,
  loadWorkspaceSession,
  resetRemoteState,
  resetState,
  rotateWorkspaceCode,
  saveRemoteState,
  saveState,
} from './services/storage';
import type { WorkspaceRole, WorkspaceSession } from './services/storage';
import type { AppState, ChartMode, Interval, Market, MarketFilter, PerformanceSeries, SymbolItem, Tag, ViewTab } from './types';
import './styles.css';

type CssVars = CSSProperties & Record<`--${string}`, string>;
type BatchMarketFilter = MarketFilter;
type SyncStatus = 'loading' | 'saving' | 'synced' | 'offline' | 'local' | 'readonly';
type ActivePanel = 'symbol' | 'tags' | 'batch' | 'workspace';

const markets: Array<{ value: Market; label: string }> = [
  { value: 'CN_A', label: 'A股' },
  { value: 'US', label: '美股' },
  { value: 'HK', label: '港股' },
  { value: 'KR_KOSPI', label: '韩国KOSPI' },
  { value: 'KR_KOSDAQ', label: '韩国KOSDAQ' },
  { value: 'CUSTOM', label: '自定义Yahoo代码' },
];

const modeOptions: Array<{ value: ChartMode; label: string }> = [
  { value: 'symbols', label: '个股' },
  { value: 'tags', label: '标签均值' },
  { value: 'mixed', label: '混合' },
];

const intervalOptions: Array<{ value: Interval; label: string }> = [
  { value: '1d', label: '日线' },
  { value: '1wk', label: '周线' },
  { value: '1mo', label: '月线' },
];

const emptySymbolForm = {
  id: '',
  market: 'CN_A' as Market,
  code: '',
  name: '',
  lineColor: '',
  tagIds: [] as string[],
};

const tagColorPalette = [
  '#14b8a6',
  '#6366f1',
  '#f97316',
  '#2563eb',
  '#16a34a',
  '#ef4444',
  '#a855f7',
  '#06b6d4',
  '#f59e0b',
  '#ec4899',
  '#84cc16',
  '#0ea5e9',
  '#8b5cf6',
  '#22c55e',
  '#fb7185',
  '#38bdf8',
  '#eab308',
  '#10b981',
];

function createEmptyTagForm() {
  return {
    id: '',
    name: '',
    category: '产业链环节',
    color: randomTagColor(),
  };
}

const emptyBatchForm = {
  market: 'CN_A' as Market,
  text: '',
};

const emptyBatchFilter = {
  query: '',
  market: 'ALL' as BatchMarketFilter,
  tagIds: [] as string[],
};

const emptyWorkspaceForm = {
  name: 'AI产业链研究',
  code: '',
};

export default function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [series, setSeries] = useState<PerformanceSeries[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [query, setQuery] = useState('');
  const [symbolForm, setSymbolForm] = useState(emptySymbolForm);
  const [tagForm, setTagForm] = useState(createEmptyTagForm);
  const [batchForm, setBatchForm] = useState(emptyBatchForm);
  const [batchFilter, setBatchFilter] = useState(emptyBatchFilter);
  const [batchImportOpen, setBatchImportOpen] = useState(false);
  const [bulkSymbolIds, setBulkSymbolIds] = useState<string[]>([]);
  const [bulkTagIds, setBulkTagIds] = useState<string[]>([]);
  const [activePanel, setActivePanel] = useState<ActivePanel | null>(null);
  const [symbolReturnPanel, setSymbolReturnPanel] = useState<ActivePanel | null>(null);
  const [workspaceSession, setWorkspaceSession] = useState<WorkspaceSession | null>(() => loadWorkspaceSession());
  const [workspaceForm, setWorkspaceForm] = useState(emptyWorkspaceForm);
  const [workspaceMessage, setWorkspaceMessage] = useState('');
  const [copiedWorkspaceCode, setCopiedWorkspaceCode] = useState('');
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() => (loadWorkspaceSession() ? 'loading' : 'local'));
  const [symbolError, setSymbolError] = useState('');
  const [batchMessage, setBatchMessage] = useState('');
  const lastRefreshKeyRef = useRef(refreshKey);
  const remoteReadyRef = useRef(false);
  const stateRef = useRef(state);
  const workspaceSessionRef = useRef(workspaceSession);
  const copiedCodeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    stateRef.current = state;
    saveState(state);
  }, [state]);

  useEffect(() => {
    workspaceSessionRef.current = workspaceSession;
  }, [workspaceSession]);

  useEffect(() => {
    return () => {
      if (copiedCodeTimerRef.current !== null) {
        window.clearTimeout(copiedCodeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const session = workspaceSessionRef.current;
    if (!session) {
      remoteReadyRef.current = true;
      setSyncStatus('local');
      return () => {
        cancelled = true;
      };
    }
    setSyncStatus('loading');
    loadRemoteState(session)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setWorkspaceSession(result.session);
        if (result.state) {
          setState(result.state);
          saveState(result.state);
        }
        remoteReadyRef.current = true;
        setSyncStatus(result.session.role === 'viewer' ? 'readonly' : 'synced');
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        remoteReadyRef.current = true;
        setSyncStatus(session.role === 'viewer' ? 'readonly' : 'offline');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!remoteReadyRef.current) {
      return undefined;
    }
    const session = workspaceSessionRef.current;
    if (!session) {
      setSyncStatus('local');
      return undefined;
    }
    if (session.role === 'viewer') {
      setSyncStatus('readonly');
      return undefined;
    }
    setSyncStatus('saving');
    const timer = window.setTimeout(() => {
      saveRemoteState(session, state)
        .then((nextSession) => {
          setWorkspaceSession(nextSession);
          setSyncStatus('synced');
        })
        .catch((error: unknown) => {
          setWorkspaceMessage(error instanceof Error ? error.message : '共享保存失败');
          setSyncStatus('offline');
        });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [state, workspaceSession?.code, workspaceSession?.role, workspaceSession?.workspaceId]);

  useEffect(() => {
    if (activePanel === 'tags') {
      setTagForm((current) => ({ ...current, color: randomTagColor(current.color) }));
    }
  }, [activePanel]);

  useEffect(() => {
    setState((current) => syncActiveViewTab(current));
  }, [
    state.activeViewId,
    state.endDate,
    state.interval,
    state.marketFilter,
    state.mode,
    state.selectedSymbolIds,
    state.selectedTagIds,
    state.startDate,
  ]);

  const tagMap = useMemo(() => new Map(state.tags.map((tag) => [tag.id, tag])), [state.tags]);

  const marketScopedSymbols = useMemo(() => {
    return state.symbols.filter((symbol) => matchesMarketFilter(symbol, state.marketFilter));
  }, [state.marketFilter, state.symbols]);

  const visibleSymbols = useMemo(() => {
    const selectedSymbolIds = new Set(state.selectedSymbolIds);
    return marketScopedSymbols.filter((symbol) => selectedSymbolIds.has(symbol.id));
  }, [marketScopedSymbols, state.selectedSymbolIds]);

  useEffect(() => {
    let cancelled = false;
    const forceRefresh = refreshKey !== lastRefreshKeyRef.current;
    lastRefreshKeyRef.current = refreshKey;
    setLoading(true);
    buildPerformanceSeries(
      visibleSymbols,
      state.tags,
      state.mode,
      state.interval,
      state.startDate,
      state.endDate,
      state.selectedTagIds,
      forceRefresh,
    )
      .then((result) => {
        if (cancelled) {
          return;
        }
        setSeries(result.series);
        setWarnings(result.warnings);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setSeries([]);
        setWarnings([error instanceof Error ? error.message : '行情加载失败']);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    refreshKey,
    state.endDate,
    state.interval,
    state.mode,
    state.selectedTagIds,
    state.startDate,
    state.tags,
    visibleSymbols,
  ]);

  const filteredSymbols = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return marketScopedSymbols;
    }
    return marketScopedSymbols.filter((symbol) => {
      const tags = symbol.tagIds.map((id) => tagMap.get(id)?.name ?? '').join(' ');
      return `${symbol.market} ${symbol.code} ${symbol.name} ${tags}`.toLowerCase().includes(keyword);
    });
  }, [marketScopedSymbols, query, tagMap]);

  const groupedTags = useMemo(() => {
    const groupOrder = ['产业链阶段', '产业链位置', '产业链环节', '主体链', '自定义'];
    const groups = new Map<string, Tag[]>();
    state.tags.forEach((tag) => {
      const category = tag.category || '自定义';
      groups.set(category, [...(groups.get(category) ?? []), tag]);
    });
    return Array.from(groups.entries())
      .sort(([a], [b]) => {
        const ai = groupOrder.indexOf(a);
        const bi = groupOrder.indexOf(b);
        if (ai === -1 && bi === -1) {
          return a.localeCompare(b, 'zh-CN');
        }
        if (ai === -1) {
          return 1;
        }
        if (bi === -1) {
          return -1;
        }
        return ai - bi;
      })
      .map(([category, tags]) => ({ category, tags }));
  }, [state.tags]);

  const batchFilteredSymbols = useMemo(() => {
    const keyword = batchFilter.query.trim().toLowerCase();
    return state.symbols.filter((symbol) => {
      if (batchFilter.market !== 'ALL' && symbol.market !== batchFilter.market) {
        return false;
      }
      if (batchFilter.tagIds.length && !batchFilter.tagIds.every((tagId) => symbol.tagIds.includes(tagId))) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      const tags = symbol.tagIds.map((id) => tagMap.get(id)?.name ?? '').join(' ');
      return `${symbol.market} ${symbol.code} ${symbol.name} ${tags}`.toLowerCase().includes(keyword);
    });
  }, [batchFilter.market, batchFilter.query, batchFilter.tagIds, state.symbols, tagMap]);

  const tableRows = useMemo(() => {
    return [...series].sort((a, b) => (b.metrics.rangeReturn ?? -Infinity) - (a.metrics.rangeReturn ?? -Infinity));
  }, [series]);

  const allFilteredSymbolsSelected = useMemo(() => {
    if (!filteredSymbols.length) {
      return false;
    }
    const selectedSymbolIds = new Set(state.selectedSymbolIds);
    return filteredSymbols.every((symbol) => selectedSymbolIds.has(symbol.id));
  }, [filteredSymbols, state.selectedSymbolIds]);

  const allBatchFilteredSymbolsSelected = useMemo(() => {
    if (!batchFilteredSymbols.length) {
      return false;
    }
    const selected = new Set(bulkSymbolIds);
    return batchFilteredSymbols.every((symbol) => selected.has(symbol.id));
  }, [batchFilteredSymbols, bulkSymbolIds]);

  const title = useMemo(() => {
    const startYear = state.startDate.slice(0, 4);
    const endYear = state.endDate.slice(0, 4);
    return `${startYear}年-${endYear}年 涨幅节奏`;
  }, [state.endDate, state.startDate]);

  const marketScopeLabel = state.marketFilter === 'ALL' ? '全部市场' : marketLabel(state.marketFilter);

  const syncLabel = useMemo(() => {
    if (syncStatus === 'loading') {
      return '读取共享数据';
    }
    if (syncStatus === 'saving') {
      return '保存中';
    }
    if (syncStatus === 'readonly') {
      return '只读工作区';
    }
    if (syncStatus === 'local') {
      return '本地模式';
    }
    if (syncStatus === 'offline') {
      return '共享离线';
    }
    return '共享已同步';
  }, [syncStatus]);

  const canEditWorkspace = !workspaceSession || workspaceSession.role === 'editor';
  const workspaceRoleLabel = workspaceSession?.role === 'viewer' ? '只读' : '编辑';
  const activeViewTab = state.viewTabs.find((view) => view.id === state.activeViewId) ?? state.viewTabs[0] ?? null;

  function updateState(patch: Partial<AppState>) {
    setState((current) => ({ ...current, ...patch }));
  }

  function selectViewTab(viewId: string) {
    setState((current) => {
      const view = current.viewTabs.find((item) => item.id === viewId);
      return view ? applyViewTab(current, view) : current;
    });
  }

  function createViewTab() {
    const name = window.prompt('请输入视图名称', nextViewName(state.viewTabs));
    const cleanName = name?.trim();
    if (!cleanName) {
      return;
    }
    setState((current) => {
      const view = createViewTabFromState(`view-${Date.now()}`, cleanName, current);
      return {
        ...current,
        activeViewId: view.id,
        viewTabs: [...current.viewTabs, view],
      };
    });
  }

  function renameActiveView() {
    if (!activeViewTab) {
      return;
    }
    const name = window.prompt('请输入新的视图名称', activeViewTab.name);
    const cleanName = name?.trim();
    if (!cleanName) {
      return;
    }
    setState((current) => ({
      ...current,
      viewTabs: current.viewTabs.map((view) =>
        view.id === current.activeViewId ? { ...view, name: cleanName } : view,
      ),
    }));
  }

  function deleteActiveView() {
    if (!activeViewTab || state.viewTabs.length <= 1) {
      return;
    }
    if (!window.confirm(`删除视图「${activeViewTab.name}」？`)) {
      return;
    }
    setState((current) => {
      const remaining = current.viewTabs.filter((view) => view.id !== current.activeViewId);
      const nextView = remaining[0];
      if (!nextView) {
        return current;
      }
      return applyViewTab(
        {
          ...current,
          viewTabs: remaining,
        },
        nextView,
      );
    });
  }

  function toggleSymbol(symbolId: string) {
    setState((current) => {
      const next = new Set(current.selectedSymbolIds);
      const selectedTagIds = new Set(current.selectedTagIds);
      if (next.has(symbolId)) {
        next.delete(symbolId);
      } else {
        next.add(symbolId);
        getLinkedTagIdsForSymbols(current.symbols, current.tags, selectedTagIds, [symbolId]).forEach((tagId) =>
          selectedTagIds.add(tagId),
        );
      }
      return {
        ...current,
        selectedSymbolIds: Array.from(next),
        selectedTagIds: keepTagsWithSelectedMembers(current.symbols, Array.from(selectedTagIds), next),
      };
    });
  }

  function toggleFilteredSymbols() {
    setState((current) => {
      const targetIds = new Set(filteredSymbols.map((symbol) => symbol.id));
      if (!targetIds.size) {
        return current;
      }
      const selectedSymbolIds = new Set(current.selectedSymbolIds);
      const selectedTagIds = new Set(current.selectedTagIds);
      const shouldUnselect = filteredSymbols.every((symbol) => selectedSymbolIds.has(symbol.id));
      if (shouldUnselect) {
        targetIds.forEach((id) => selectedSymbolIds.delete(id));
      } else {
        targetIds.forEach((id) => selectedSymbolIds.add(id));
        getLinkedTagIdsForSymbols(current.symbols, current.tags, selectedTagIds, targetIds).forEach((tagId) =>
          selectedTagIds.add(tagId),
        );
      }
      return {
        ...current,
        selectedSymbolIds: Array.from(selectedSymbolIds),
        selectedTagIds: keepTagsWithSelectedMembers(current.symbols, Array.from(selectedTagIds), selectedSymbolIds),
      };
    });
  }

  function toggleTagFilter(tagId: string) {
    setState((current) => {
      const selectedTagIds = new Set(current.selectedTagIds);
      const selectedSymbolIds = new Set(current.selectedSymbolIds);
      const tagSymbolIds = current.symbols.filter((symbol) => symbol.tagIds.includes(tagId)).map((symbol) => symbol.id);
      if (selectedTagIds.has(tagId)) {
        selectedTagIds.delete(tagId);
        tagSymbolIds.forEach((symbolId) => {
          const symbol = current.symbols.find((item) => item.id === symbolId);
          const coveredByRemainingTag = symbol?.tagIds.some((symbolTagId) => selectedTagIds.has(symbolTagId));
          if (!coveredByRemainingTag) {
            selectedSymbolIds.delete(symbolId);
          }
        });
      } else {
        selectedTagIds.add(tagId);
        tagSymbolIds.forEach((symbolId) => selectedSymbolIds.add(symbolId));
      }
      return { ...current, selectedTagIds: Array.from(selectedTagIds), selectedSymbolIds: Array.from(selectedSymbolIds) };
    });
  }

  function toggleFormTag(tagId: string) {
    setSymbolForm((current) => {
      const next = new Set(current.tagIds);
      if (next.has(tagId)) {
        next.delete(tagId);
      } else {
        next.add(tagId);
      }
      return { ...current, tagIds: Array.from(next) };
    });
  }

  function toggleBulkSymbol(symbolId: string) {
    setBulkSymbolIds((current) => {
      const next = new Set(current);
      if (next.has(symbolId)) {
        next.delete(symbolId);
      } else {
        next.add(symbolId);
      }
      return Array.from(next);
    });
  }

  function toggleBulkTag(tagId: string) {
    setBulkTagIds((current) => {
      const next = new Set(current);
      if (next.has(tagId)) {
        next.delete(tagId);
      } else {
        next.add(tagId);
      }
      return Array.from(next);
    });
  }

  function toggleBatchFilterTag(tagId: string) {
    setBatchFilter((current) => {
      const next = new Set(current.tagIds);
      if (next.has(tagId)) {
        next.delete(tagId);
      } else {
        next.add(tagId);
      }
      return { ...current, tagIds: Array.from(next) };
    });
  }

  function toggleBatchFilteredSymbols() {
    const targetIds = new Set(batchFilteredSymbols.map((symbol) => symbol.id));
    if (!targetIds.size) {
      return;
    }
    setBulkSymbolIds((current) => {
      const next = new Set(current);
      if (batchFilteredSymbols.every((symbol) => next.has(symbol.id))) {
        targetIds.forEach((id) => next.delete(id));
      } else {
        targetIds.forEach((id) => next.add(id));
      }
      return Array.from(next);
    });
  }

  function randomizeTagColor() {
    setTagForm((current) => ({ ...current, color: randomTagColor(current.color) }));
  }

  function submitSymbol(event: FormEvent) {
    event.preventDefault();
    const wasEditing = Boolean(symbolForm.id);
    const code = symbolForm.code.trim().toUpperCase();
    const name = symbolForm.name.trim();
    const market = symbolForm.market;
    if (!code || !name) {
      setSymbolError('请填写代码和名称。');
      return;
    }

    const duplicate = state.symbols.find(
      (symbol) => symbol.id !== symbolForm.id && symbol.market === market && symbol.code.trim().toUpperCase() === code,
    );
    if (duplicate) {
      setSymbolError(`${marketLabel(market)} ${code} 已存在：${duplicate.name}`);
      return;
    }

    const payload: SymbolItem = {
      id: symbolForm.id || `sym-${Date.now()}`,
      market,
      code,
      name,
      lineColor: symbolForm.lineColor || undefined,
      tagIds: symbolForm.tagIds,
    };

    setState((current) => {
      const exists = current.symbols.some((symbol) => symbol.id === payload.id);
      const symbols = exists
        ? current.symbols.map((symbol) => (symbol.id === payload.id ? payload : symbol))
        : [...current.symbols, payload];
      const selectedSymbolIds = Array.from(new Set([...current.selectedSymbolIds, payload.id]));
      return {
        ...current,
        symbols,
        selectedSymbolIds,
        selectedTagIds: keepTagsWithSelectedMembers(symbols, current.selectedTagIds, new Set(selectedSymbolIds)),
      };
    });
    setSymbolForm(emptySymbolForm);
    setSymbolError('');
    if (wasEditing) {
      setActivePanel(symbolReturnPanel);
      setSymbolReturnPanel(null);
    }
  }

  function editSymbol(symbol: SymbolItem, returnPanel: ActivePanel | null = null) {
    setSymbolForm({
      id: symbol.id,
      market: symbol.market,
      code: symbol.code,
      name: symbol.name,
      lineColor: symbol.lineColor ?? '',
      tagIds: symbol.tagIds,
    });
    setSymbolError('');
    setSymbolReturnPanel(returnPanel);
    setActivePanel('symbol');
  }

  function deleteSymbol(symbolId: string) {
    setState((current) => {
      const symbols = current.symbols.filter((symbol) => symbol.id !== symbolId);
      const selectedSymbolIds = current.selectedSymbolIds.filter((id) => id !== symbolId);
      return {
        ...current,
        symbols,
        selectedSymbolIds,
        selectedTagIds: keepTagsWithSelectedMembers(symbols, current.selectedTagIds, new Set(selectedSymbolIds)),
      };
    });
    if (symbolForm.id === symbolId) {
      setSymbolForm(emptySymbolForm);
      setSymbolError('');
    }
  }

  function submitBatchImport(event: FormEvent) {
    event.preventDefault();
    const result = parseBulkSymbols(batchForm.text, batchForm.market, state.tags);
    if (!result.items.length) {
      setBatchMessage(result.messages.length ? result.messages.join('；') : '没有识别到可导入的股票。');
      return;
    }

    setState((current) => {
      const symbols = [...current.symbols];
      const selectedSymbolIds = new Set(current.selectedSymbolIds);
      let added = 0;
      let updated = 0;

      result.items.forEach((item) => {
        const existingIndex = symbols.findIndex(
          (symbol) => symbol.market === item.market && symbol.code.trim().toUpperCase() === item.code,
        );
        if (existingIndex >= 0) {
          const existing = symbols[existingIndex];
          symbols[existingIndex] = {
            ...existing,
            name: item.name,
            tagIds: Array.from(new Set([...existing.tagIds, ...item.tagIds])),
          };
          selectedSymbolIds.add(existing.id);
          updated += 1;
        } else {
          const id = `sym-${Date.now()}-${added}`;
          symbols.push({
            id,
            market: item.market,
            code: item.code,
            name: item.name,
            tagIds: item.tagIds,
          });
          selectedSymbolIds.add(id);
          added += 1;
        }
      });

      setBatchMessage(
        [
          `导入完成：新增 ${added} 只，更新 ${updated} 只`,
          result.messages.length ? result.messages.slice(0, 4).join('；') : '',
          result.messages.length > 4 ? `另有 ${result.messages.length - 4} 条提示` : '',
        ]
          .filter(Boolean)
          .join('；'),
      );

      return {
        ...current,
        symbols,
        selectedSymbolIds: Array.from(selectedSymbolIds),
      };
    });
    setBatchImportOpen(false);
  }

  function applyBulkTags(mode: 'add' | 'remove' | 'replace') {
    if (!bulkSymbolIds.length || !bulkTagIds.length) {
      setBatchMessage('请先选择股票和标签。');
      return;
    }

    const targetIds = new Set(bulkSymbolIds);
    setState((current) => {
      const symbols = current.symbols.map((symbol) => {
        if (!targetIds.has(symbol.id)) {
          return symbol;
        }
        if (mode === 'replace') {
          return { ...symbol, tagIds: bulkTagIds };
        }
        if (mode === 'remove') {
          const removeIds = new Set(bulkTagIds);
          return { ...symbol, tagIds: symbol.tagIds.filter((tagId) => !removeIds.has(tagId)) };
        }
        return { ...symbol, tagIds: Array.from(new Set([...symbol.tagIds, ...bulkTagIds])) };
      });
      return {
        ...current,
        symbols,
        selectedTagIds: keepTagsWithSelectedMembers(symbols, current.selectedTagIds, new Set(current.selectedSymbolIds)),
      };
    });
    setBatchMessage(`已处理 ${bulkSymbolIds.length} 只股票。`);
  }

  function deleteBulkSymbols() {
    if (!bulkSymbolIds.length) {
      setBatchMessage('请先选择股票。');
      return;
    }
    const targetIds = new Set(bulkSymbolIds);
    setState((current) => {
      const symbols = current.symbols.filter((symbol) => !targetIds.has(symbol.id));
      const selectedSymbolIds = current.selectedSymbolIds.filter((symbolId) => !targetIds.has(symbolId));
      return {
        ...current,
        symbols,
        selectedSymbolIds,
        selectedTagIds: keepTagsWithSelectedMembers(symbols, current.selectedTagIds, new Set(selectedSymbolIds)),
      };
    });
    setBatchMessage(`已删除 ${bulkSymbolIds.length} 只股票。`);
    setBulkSymbolIds([]);
  }

  function submitTag(event: FormEvent) {
    event.preventDefault();
    const name = tagForm.name.trim();
    if (!name) {
      return;
    }
    const tag: Tag = {
      id: tagForm.id || `tag-${Date.now()}`,
      name,
      category: tagForm.category.trim() || '自定义',
      color: tagForm.color,
    };
    setState((current) => ({
      ...current,
      tags: tagForm.id
        ? current.tags.map((item) => (item.id === tagForm.id ? tag : item))
        : [...current.tags, tag],
    }));
    setTagForm({
      ...createEmptyTagForm(),
      category: tagForm.category.trim() || '产业链环节',
    });
  }

  function editTag(tag: Tag) {
    setTagForm({
      id: tag.id,
      name: tag.name,
      category: tag.category,
      color: tag.color,
    });
    setActivePanel('tags');
  }

  function cancelTagEdit() {
    setTagForm(createEmptyTagForm());
  }

  function deleteTag(tagId: string) {
    setState((current) => ({
      ...current,
      tags: current.tags.filter((tag) => tag.id !== tagId),
      symbols: current.symbols.map((symbol) => ({
        ...symbol,
        tagIds: symbol.tagIds.filter((id) => id !== tagId),
      })),
      selectedTagIds: current.selectedTagIds.filter((id) => id !== tagId),
    }));
    if (tagForm.id === tagId) {
      setTagForm(createEmptyTagForm());
    }
  }

  function resetAll() {
    const session = workspaceSessionRef.current;
    if (session?.role === 'viewer') {
      setWorkspaceMessage('只读工作区不能恢复默认。');
      setActivePanel('workspace');
      return;
    }
    if (session?.role === 'editor') {
      void resetRemoteState(session)
        .then((nextSession) => setWorkspaceSession(nextSession))
        .catch((error: unknown) => setWorkspaceMessage(error instanceof Error ? error.message : '工作区重置失败'));
    }
    setState(resetState());
    setSymbolForm(emptySymbolForm);
    setTagForm(createEmptyTagForm());
    setBatchForm(emptyBatchForm);
    setBatchFilter(emptyBatchFilter);
    setBulkSymbolIds([]);
    setBulkTagIds([]);
    setActivePanel(null);
    setRefreshKey((value) => value + 1);
  }

  async function submitCreateWorkspace(event: FormEvent) {
    event.preventDefault();
    setWorkspaceMessage('正在创建工作区...');
    try {
      const result = await createWorkspace(workspaceForm.name, stateRef.current);
      setWorkspaceSession(result.session);
      if (result.state) {
        setState(result.state);
      }
      remoteReadyRef.current = true;
      setSyncStatus('synced');
      setWorkspaceMessage('工作区已创建，编辑代码和只读代码已生成。');
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : '创建工作区失败');
    }
  }

  async function submitJoinWorkspace(event: FormEvent) {
    event.preventDefault();
    const code = workspaceForm.code.trim();
    if (!code) {
      setWorkspaceMessage('请输入工作区代码。');
      return;
    }
    setWorkspaceMessage('正在进入工作区...');
    try {
      const result = await joinWorkspace(code);
      setWorkspaceSession(result.session);
      if (result.state) {
        setState(result.state);
        saveState(result.state);
      }
      remoteReadyRef.current = true;
      setSyncStatus(result.session.role === 'viewer' ? 'readonly' : 'synced');
      setWorkspaceForm((current) => ({ ...current, code: '' }));
      setWorkspaceMessage(`已进入「${result.session.workspaceName}」。`);
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : '进入工作区失败');
    }
  }

  function leaveWorkspace() {
    clearWorkspaceSession();
    setWorkspaceSession(null);
    workspaceSessionRef.current = null;
    remoteReadyRef.current = true;
    setSyncStatus('local');
    setWorkspaceMessage('已退出工作区，当前使用本地模式。');
  }

  async function rotateCode(role: WorkspaceRole) {
    const session = workspaceSessionRef.current;
    if (!session || session.role !== 'editor') {
      setWorkspaceMessage('只有编辑代码可以重置工作区代码。');
      return;
    }
    try {
      const result = await rotateWorkspaceCode(session, role);
      setWorkspaceSession(result.session);
      setWorkspaceMessage(`${role === 'viewer' ? '只读' : '编辑'}代码已重置：${result.code}`);
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : '重置代码失败');
    }
  }

  async function copyCode(code?: string) {
    if (!code) {
      setWorkspaceMessage('当前没有可复制的代码。');
      return;
    }
    try {
      const copied = await copyTextToClipboard(code);
      if (!copied) {
        throw new Error('copy failed');
      }
      setCopiedWorkspaceCode(code);
      setWorkspaceMessage(`已复制：${code}`);
      if (copiedCodeTimerRef.current !== null) {
        window.clearTimeout(copiedCodeTimerRef.current);
      }
      copiedCodeTimerRef.current = window.setTimeout(() => {
        setCopiedWorkspaceCode((current) => (current === code ? '' : current));
      }, 1600);
    } catch {
      setCopiedWorkspaceCode('');
      setWorkspaceMessage(`复制失败，请手动复制：${code}`);
    }
  }

  function exportChartSnapshot(chartPayload: ChartExportPayload) {
    void exportChartWithTable(chartPayload, tableRows, title);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <DatabaseZap size={26} />
          <div className="brand-copy">
            <h1>AI 产业链涨幅节奏看板</h1>
            <p>Node后端 · 共享股票池 · 标签联动</p>
          </div>
        </div>
        <div className="top-actions">
          <span className={`sync-pill ${syncStatus}`}>{syncLabel}</span>
          <button
            className={`top-action-button ${activePanel === 'workspace' ? 'active' : ''}`}
            type="button"
            onClick={() => {
              setWorkspaceMessage('');
              setActivePanel('workspace');
            }}
          >
            <KeyRound size={15} />
            {workspaceSession ? workspaceSession.workspaceName : '工作区'}
          </button>
          <button
            className={`top-action-button ${activePanel === 'symbol' ? 'active' : ''}`}
            type="button"
            disabled={!canEditWorkspace}
            onClick={() => {
              setSymbolForm(emptySymbolForm);
              setSymbolError('');
              setSymbolReturnPanel(null);
              setActivePanel('symbol');
            }}
          >
            <CirclePlus size={15} />
            新增股票
          </button>
          <button
            className={`top-action-button ${activePanel === 'batch' ? 'active' : ''}`}
            type="button"
            disabled={!canEditWorkspace}
            onClick={() => {
              setBatchMessage('');
              setActivePanel('batch');
            }}
          >
            <ListChecks size={15} />
            股票管理
          </button>
          <button
            className={`top-action-button ${activePanel === 'tags' ? 'active' : ''}`}
            type="button"
            disabled={!canEditWorkspace}
            onClick={() => {
              setTagForm(createEmptyTagForm());
              setActivePanel('tags');
            }}
          >
            <Tags size={15} />
            标签管理
          </button>
          <button className="top-action-button" onClick={() => setRefreshKey((value) => value + 1)} title="刷新行情">
            <RefreshCw size={15} />
            刷新行情
          </button>
          <button className="top-action-button danger" disabled={!canEditWorkspace} onClick={resetAll} title="恢复默认股票池">
            <RotateCcw size={15} />
            恢复默认
          </button>
        </div>
      </header>

      <section className="view-tab-strip">
        <span>视图</span>
        <div className="view-tab-list">
          {state.viewTabs.map((view) => (
            <button
              key={view.id}
              className={view.id === state.activeViewId ? 'active' : ''}
              type="button"
              onClick={() => selectViewTab(view.id)}
            >
              {view.name}
            </button>
          ))}
        </div>
        <div className="view-tab-actions">
          <button type="button" onClick={createViewTab}>
            <CirclePlus size={14} />
            新增
          </button>
          <button type="button" disabled={!activeViewTab} onClick={renameActiveView}>
            <Pencil size={14} />
            重命名
          </button>
          <button type="button" disabled={state.viewTabs.length <= 1} onClick={deleteActiveView}>
            <Trash2 size={14} />
            删除
          </button>
        </div>
      </section>

      <section className="control-strip">
        <Segmented
          label="模式"
          value={state.mode}
          options={modeOptions}
          onChange={(value) => updateState({ mode: value })}
        />
        <label className="market-field">
          <span>市场</span>
          <select
            value={state.marketFilter}
            onChange={(event) => updateState({ marketFilter: event.target.value as MarketFilter })}
          >
            <option value="ALL">全部市场</option>
            {markets.map((market) => (
              <option key={market.value} value={market.value}>
                {market.label}
              </option>
            ))}
          </select>
        </label>
        <Segmented
          label="周期"
          value={state.interval}
          options={intervalOptions}
          onChange={(value) => updateState({ interval: value })}
        />
        <label className="date-field">
          <span>开始</span>
          <input value={state.startDate} type="date" onChange={(event) => updateState({ startDate: event.target.value })} />
        </label>
        <label className="date-field">
          <span>结束</span>
          <input value={state.endDate} type="date" onChange={(event) => updateState({ endDate: event.target.value })} />
        </label>
        <div className="summary-pill">
          {marketScopeLabel} · 入图 {visibleSymbols.length}/{marketScopedSymbols.length} 只 · 标签 {state.selectedTagIds.length} 个 · 曲线 {series.length} 条
        </div>
      </section>

      <section className="workspace">
        <aside className="side-panel">
          <div className="search-box">
            <Search size={16} />
            <input value={query} placeholder="搜索股票 / 标签" onChange={(event) => setQuery(event.target.value)} />
          </div>

          <div className="tag-filter grouped-tags">
            {groupedTags.map((group) => (
              <section className="tag-group" key={group.category}>
                <div className="tag-group-title">
                  <span>{group.category}</span>
                  <small>{group.tags.length}</small>
                </div>
                <div className="tag-group-chips">
                  {group.tags.map((tag) => (
                    <button
                      key={tag.id}
                      className={`tag-chip ${state.selectedTagIds.includes(tag.id) ? 'active' : ''}`}
                      style={{ '--tag-color': tag.color } as CssVars}
                      onClick={() => toggleTagFilter(tag.id)}
                    >
                      {state.selectedTagIds.includes(tag.id) && <span className="selected-mark">✓</span>}
                      {tag.name}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <div className="selection-actions">
            <button
              type="button"
              disabled={!filteredSymbols.length}
              onClick={toggleFilteredSymbols}
            >
              {allFilteredSymbolsSelected ? '取消当前' : '全选当前'}
            </button>
            <button type="button" onClick={() => updateState({ selectedSymbolIds: [], selectedTagIds: [] })}>
              清空选择
            </button>
          </div>

          <div className="list-title">
            <h2>股票列表</h2>
            <span>
              {filteredSymbols.length} 只 · 已勾选 {state.selectedSymbolIds.length} 只
            </span>
          </div>

          <div className="symbol-list compact-list">
            {filteredSymbols.map((symbol) => {
              const color = symbol.lineColor ?? tagMap.get(symbol.tagIds[0])?.color ?? '#94a3b8';
              const tags = symbol.tagIds.map((tagId) => tagMap.get(tagId)).filter(Boolean) as Tag[];
              const isSelected = state.selectedSymbolIds.includes(symbol.id);
              return (
                <div
                  className={`symbol-row ${isSelected ? 'selected' : ''}`}
                  key={symbol.id}
                  style={{ '--row-color': color } as CssVars}
                >
                  <label className="symbol-check">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSymbol(symbol.id)}
                    />
                    <span className="symbol-text">
                      <strong>{symbol.name}</strong>
                      <small>
                        {marketLabel(symbol.market)} · {symbol.code}
                      </small>
                    </span>
                  </label>
                  <div className="row-tags">
                    {tags.slice(0, 2).map((tag) => (
                      <span key={tag.id} style={{ '--tag-color': tag.color } as CssVars}>
                        {tag.name}
                      </span>
                    ))}
                    {tags.length > 2 && <em>+{tags.length - 2}</em>}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        <section className="chart-section">
          <PerformanceChart title={title} series={series} loading={loading} onExportImage={exportChartSnapshot} />
          {warnings.length > 0 && (
            <div className="warning-strip">
              {warnings.slice(0, 4).join('；')}
              {warnings.length > 4 ? `；另有 ${warnings.length - 4} 条` : ''}
            </div>
          )}
        </section>
      </section>

      <section className="data-table">
        <div className="table-header">
          <span>公司 / 标签</span>
          <span>市场</span>
          <span>区间涨幅</span>
          <span>年度涨幅</span>
          <span>最大回撤</span>
          <span>阶段</span>
          <span>最后日期</span>
        </div>
        {tableRows.map((item) => (
          <div className="table-row" key={item.id} style={{ '--row-color': item.color } as CssVars}>
            <span className="name-cell">
              <i />
              {item.label}
              {item.memberCount ? <small>{item.memberCount}只</small> : null}
            </span>
            <span>{item.market === 'TAG' ? '标签' : `${marketLabel(item.market)} ${item.code}`}</span>
            <Metric value={item.metrics.rangeReturn} />
            <Metric value={item.metrics.ytdReturn} />
            <Metric value={item.metrics.maxDrawdown} />
            <span>{item.metrics.stage}</span>
            <span>{item.metrics.lastDate ?? '-'}</span>
          </div>
        ))}
      </section>

      {activePanel && (
        <div className="drawer-backdrop" onClick={() => setActivePanel(null)}>
          <section className="management-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <h2>
                  {activePanel === 'symbol'
                    ? symbolForm.id
                      ? '编辑股票'
                      : '录入股票'
                    : activePanel === 'batch'
                      ? '股票管理'
                      : activePanel === 'tags'
                        ? '标签管理'
                        : '工作区协作'}
                </h2>
                <p>
                  {activePanel === 'symbol'
                    ? '添加代码、名称、市场和标签'
                    : activePanel === 'batch'
                      ? '筛选、编辑、打标签和删除，批量导入可展开使用'
                      : activePanel === 'tags'
                        ? '按类型维护标签、颜色和删除项'
                        : '创建工作区、输入代码加入或分享协作代码'}
                </p>
              </div>
              <button className="icon-button" type="button" onClick={() => setActivePanel(null)} title="关闭">
                <X size={18} />
              </button>
            </div>

            {activePanel === 'workspace' && (
              <div className="workspace-manager">
                <section className="workspace-card">
                  <div className="workspace-card-head">
                    <strong>{workspaceSession ? workspaceSession.workspaceName : '本地模式'}</strong>
                    <span>{workspaceSession ? `${workspaceRoleLabel}权限` : '未进入工作区'}</span>
                  </div>
                  <p>
                    {workspaceSession
                      ? '当前股票池、标签和看板配置会按工作区同步。'
                      : '创建工作区后会生成编辑代码和只读代码；别人输入代码即可进入同一个工作区。'}
                  </p>
                  {workspaceSession && (
                    <div className="workspace-code-list">
                      <WorkspaceCodeRow
                        label="当前代码"
                        code={workspaceSession.code}
                        copied={copiedWorkspaceCode === workspaceSession.code}
                        onCopy={copyCode}
                      />
                      {workspaceSession.role === 'editor' && (
                        <>
                          <WorkspaceCodeRow
                            label="编辑代码"
                            code={workspaceSession.editCode}
                            copied={copiedWorkspaceCode === workspaceSession.editCode}
                            onCopy={copyCode}
                          />
                          <WorkspaceCodeRow
                            label="只读代码"
                            code={workspaceSession.viewCode}
                            copied={copiedWorkspaceCode === workspaceSession.viewCode}
                            onCopy={copyCode}
                          />
                          <div className="workspace-code-actions">
                            <button type="button" onClick={() => void rotateCode('viewer')}>
                              重置只读代码
                            </button>
                            <button type="button" onClick={() => void rotateCode('editor')}>
                              重置编辑代码
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {workspaceSession && (
                    <button className="ghost-button" type="button" onClick={leaveWorkspace}>
                      退出工作区
                    </button>
                  )}
                </section>

                <form className="workspace-card" onSubmit={submitCreateWorkspace}>
                  <div className="workspace-card-head">
                    <strong>创建工作区</strong>
                    <span>使用当前看板数据</span>
                  </div>
                  <label>
                    <span>工作区名称</span>
                    <input
                      value={workspaceForm.name}
                      onChange={(event) => setWorkspaceForm((current) => ({ ...current, name: event.target.value }))}
                      placeholder="AI产业链研究"
                    />
                  </label>
                  <button className="primary-button" type="submit">
                    <KeyRound size={16} />
                    创建并生成代码
                  </button>
                </form>

                <form className="workspace-card" onSubmit={submitJoinWorkspace}>
                  <div className="workspace-card-head">
                    <strong>加入工作区</strong>
                    <span>输入别人给你的代码</span>
                  </div>
                  <label>
                    <span>工作区代码</span>
                    <input
                      value={workspaceForm.code}
                      onChange={(event) => setWorkspaceForm((current) => ({ ...current, code: event.target.value }))}
                      placeholder="EDIT-ABCD-2345-WXYZ"
                    />
                  </label>
                  <button className="primary-button" type="submit">
                    进入工作区
                  </button>
                </form>

                {workspaceMessage && <div className="workspace-message">{workspaceMessage}</div>}
              </div>
            )}

            {activePanel === 'symbol' && (
              <form className="drawer-form" onSubmit={submitSymbol}>
                <div className="form-grid drawer-form-grid">
                  <label>
                    <span>市场</span>
                    <select
                      value={symbolForm.market}
                      onChange={(event) => {
                        setSymbolError('');
                        setSymbolForm((current) => ({ ...current, market: event.target.value as Market }));
                      }}
                    >
                      {markets.map((market) => (
                        <option key={market.value} value={market.value}>
                          {market.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>代码</span>
                    <input
                      value={symbolForm.code}
                      placeholder="300502 / NVDA"
                      onChange={(event) => {
                        setSymbolError('');
                        setSymbolForm((current) => ({ ...current, code: event.target.value }));
                      }}
                    />
                  </label>
                  <label>
                    <span>名称</span>
                    <input
                      value={symbolForm.name}
                      placeholder="新易盛"
                      onChange={(event) => {
                        setSymbolError('');
                        setSymbolForm((current) => ({ ...current, name: event.target.value }));
                      }}
                    />
                  </label>
                  <label>
                    <span>单独颜色</span>
                    <input
                      value={symbolForm.lineColor}
                      type="color"
                      onChange={(event) => setSymbolForm((current) => ({ ...current, lineColor: event.target.value }))}
                    />
                  </label>
                </div>
                <div className="tag-checkboxes drawer-tags">
                  {groupedTags.map((group) => (
                    <section key={group.category} className="tag-checkbox-group">
                      <strong>{group.category}</strong>
                      <div>
                        {group.tags.map((tag) => (
                          <label key={tag.id} style={{ '--tag-color': tag.color } as CssVars}>
                            <input
                              type="checkbox"
                              checked={symbolForm.tagIds.includes(tag.id)}
                              onChange={() => toggleFormTag(tag.id)}
                            />
                            <span>{tag.name}</span>
                          </label>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
                <div className="drawer-footer">
                  {symbolError && <div className="form-error">{symbolError}</div>}
                  {symbolForm.id && (
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => {
                        setSymbolForm(emptySymbolForm);
                        setSymbolError('');
                        setActivePanel(symbolReturnPanel);
                        setSymbolReturnPanel(null);
                      }}
                    >
                      取消编辑
                    </button>
                  )}
                  <button className="primary-button" type="submit">
                    <Save size={16} />
                    保存股票
                  </button>
                </div>
              </form>
            )}

            {activePanel === 'batch' && (
              <div className="batch-management">
                <section className={`batch-import-panel ${batchImportOpen ? 'open' : ''}`}>
                  <div className="batch-import-summary">
                    <div>
                      <strong>批量导入</strong>
                      <span>低频工具，展开后按行粘贴股票</span>
                    </div>
                    <button type="button" onClick={() => setBatchImportOpen((open) => !open)}>
                      {batchImportOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                      {batchImportOpen ? '收起' : '展开'}
                    </button>
                  </div>
                  {batchImportOpen && (
                    <form className="batch-import" onSubmit={submitBatchImport}>
                      <div className="batch-import-head">
                        <label>
                          <span>默认市场</span>
                          <select
                            value={batchForm.market}
                            onChange={(event) =>
                              setBatchForm((current) => ({ ...current, market: event.target.value as Market }))
                            }
                          >
                            {markets.map((market) => (
                              <option key={market.value} value={market.value}>
                                {market.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button className="primary-button" type="submit">
                          <ListChecks size={16} />
                          导入/更新
                        </button>
                      </div>
                      <textarea
                        value={batchForm.text}
                        placeholder={'每行一只：市场 代码 名称 标签1,标签2\n例如：美股 NVDA 英伟达 算力芯片,上游\n也可省略市场：AMD 超威半导体 算力芯片'}
                        onChange={(event) => setBatchForm((current) => ({ ...current, text: event.target.value }))}
                      />
                    </form>
                  )}
                </section>

                <div className="stock-manager-grid">
                  <section className="batch-section stock-batch-section">
                    <div className="batch-section-title">
                      <strong>批量选择股票</strong>
                      <span>
                        已选 {bulkSymbolIds.length} · 筛出 {batchFilteredSymbols.length}/{state.symbols.length}
                      </span>
                    </div>
                    <div className="batch-filter-panel">
                      <div className="batch-filter-head">
                        <strong>筛选</strong>
                        <span>AND</span>
                      </div>
                      <div className="batch-filter-fields">
                        <label>
                          <span>关键词</span>
                          <input
                            value={batchFilter.query}
                            placeholder="代码 / 名称 / 标签"
                            onChange={(event) =>
                              setBatchFilter((current) => ({ ...current, query: event.target.value }))
                            }
                          />
                        </label>
                        <label>
                          <span>市场</span>
                          <select
                            value={batchFilter.market}
                            onChange={(event) =>
                              setBatchFilter((current) => ({
                                ...current,
                                market: event.target.value as BatchMarketFilter,
                              }))
                            }
                          >
                            <option value="ALL">全部市场</option>
                            {markets.map((market) => (
                              <option key={market.value} value={market.value}>
                                {market.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button type="button" onClick={() => setBatchFilter(emptyBatchFilter)}>
                          清空筛选
                        </button>
                      </div>
                      <div className="batch-filter-tags">
                        {groupedTags.map((group) => (
                          <section key={group.category}>
                            <b>{group.category}</b>
                            <div>
                              {group.tags.map((tag) => (
                                <button
                                  key={tag.id}
                                  className={batchFilter.tagIds.includes(tag.id) ? 'active' : ''}
                                  type="button"
                                  style={{ '--tag-color': tag.color } as CssVars}
                                  onClick={() => toggleBatchFilterTag(tag.id)}
                                >
                                  {batchFilter.tagIds.includes(tag.id) && <span>✓</span>}
                                  {tag.name}
                                </button>
                              ))}
                            </div>
                          </section>
                        ))}
                      </div>
                    </div>
                    <div className="batch-toolbar">
                      <button
                        type="button"
                        disabled={!batchFilteredSymbols.length}
                        title="只处理股票管理里的筛选结果"
                        onClick={toggleBatchFilteredSymbols}
                      >
                        {allBatchFilteredSymbolsSelected ? '取消筛选结果' : '选中筛选结果'}
                      </button>
                      <button
                        type="button"
                        title="同步首页左侧已经勾选、正在入图的股票"
                        onClick={() => setBulkSymbolIds(state.selectedSymbolIds)}
                      >
                        同步图表已选
                      </button>
                      <button type="button" onClick={() => setBulkSymbolIds([])}>
                        清空批量选择
                      </button>
                    </div>
                    <div className="batch-symbol-grid">
                      {batchFilteredSymbols.map((symbol) => {
                        const color = symbol.lineColor ?? tagMap.get(symbol.tagIds[0])?.color ?? '#94a3b8';
                        return (
                          <div
                            key={symbol.id}
                            className="batch-symbol-item"
                            style={{ '--row-color': color } as CssVars}
                          >
                            <label className="batch-symbol-check">
                              <input
                                checked={bulkSymbolIds.includes(symbol.id)}
                                type="checkbox"
                                onChange={() => toggleBulkSymbol(symbol.id)}
                              />
                              <span>
                                <strong>{symbol.name}</strong>
                                <small>{marketLabel(symbol.market)} · {symbol.code}</small>
                              </span>
                            </label>
                            <div className="batch-symbol-actions">
                              <button type="button" onClick={() => editSymbol(symbol, 'batch')}>
                                编辑
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  deleteSymbol(symbol.id);
                                  setBulkSymbolIds((current) => current.filter((id) => id !== symbol.id));
                                }}
                                title="删除股票"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {!batchFilteredSymbols.length && <div className="batch-empty-state">没有符合筛选条件的股票</div>}
                    </div>
                  </section>

                  <section className="batch-section tag-batch-section">
                    <div className="batch-section-title">
                      <strong>选择标签</strong>
                      <span>{bulkTagIds.length} 个</span>
                    </div>
                    <div className="batch-tag-groups">
                      {groupedTags.map((group) => (
                        <section key={group.category}>
                          <b>{group.category}</b>
                          <div>
                            {group.tags.map((tag) => (
                              <label key={tag.id} style={{ '--tag-color': tag.color } as CssVars}>
                                <input
                                  checked={bulkTagIds.includes(tag.id)}
                                  type="checkbox"
                                  onChange={() => toggleBulkTag(tag.id)}
                                />
                                <span>{tag.name}</span>
                              </label>
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                    <div className="batch-actions">
                      <button type="button" onClick={() => applyBulkTags('add')}>
                        追加标签
                      </button>
                      <button type="button" onClick={() => applyBulkTags('remove')}>
                        移除标签
                      </button>
                      <button type="button" onClick={() => applyBulkTags('replace')}>
                        替换为所选标签
                      </button>
                      <button className="danger-action" type="button" onClick={deleteBulkSymbols}>
                        删除
                      </button>
                    </div>
                  </section>
                </div>

                {batchMessage && <div className="batch-message">{batchMessage}</div>}
              </div>
            )}

            {activePanel === 'tags' && (
              <div className="tag-management">
                <form className="drawer-form" onSubmit={submitTag}>
                  <div className="form-grid tag-form-grid">
                    <label>
                      <span>名称</span>
                      <input
                        value={tagForm.name}
                        placeholder="例如：苹果链"
                        onChange={(event) => setTagForm((current) => ({ ...current, name: event.target.value }))}
                      />
                    </label>
                    <label>
                      <span>类型</span>
                      <input
                        value={tagForm.category}
                        placeholder="产业链环节 / 主体链"
                        onChange={(event) => setTagForm((current) => ({ ...current, category: event.target.value }))}
                      />
                    </label>
                    <label>
                      <span>颜色</span>
                      <div className="random-color-field">
                        <input
                          value={tagForm.color}
                          type="color"
                          onChange={(event) => setTagForm((current) => ({ ...current, color: event.target.value }))}
                        />
                        <button type="button" onClick={randomizeTagColor} title="随机颜色">
                          <Shuffle size={14} />
                        </button>
                      </div>
                    </label>
                    <div className="tag-form-actions">
                      {tagForm.id && (
                        <button className="ghost-button" type="button" onClick={cancelTagEdit}>
                          取消编辑
                        </button>
                      )}
                      <button className="primary-button add-tag-button" type="submit">
                        {tagForm.id ? <Save size={16} /> : <CirclePlus size={16} />}
                        {tagForm.id ? '保存修改' : '新增标签'}
                      </button>
                    </div>
                  </div>
                </form>

                <div className="tag-admin grouped-admin">
                  {groupedTags.map((group) => (
                    <section className="tag-admin-group" key={group.category}>
                      <h3>{group.category}</h3>
                      <div>
                        {group.tags.map((tag) => (
                          <div key={tag.id} className="tag-admin-item" style={{ '--tag-color': tag.color } as CssVars}>
                            <span>{tag.name}</span>
                            <button type="button" onClick={() => editTag(tag)} title="编辑标签">
                              <Pencil size={13} />
                            </button>
                            <button type="button" onClick={() => deleteTag(tag.id)} title="删除标签">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented">
      <span>{label}</span>
      <div>
        {options.map((option) => (
          <button
            key={option.value}
            className={value === option.value ? 'active' : ''}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Metric({ value }: { value: number | null }) {
  if (value === null) {
    return <span>-</span>;
  }
  return <span className={value >= 0 ? 'positive' : 'negative'}>{value.toFixed(2)}%</span>;
}

function WorkspaceCodeRow({
  label,
  code,
  copied,
  onCopy,
}: {
  label: string;
  code?: string;
  copied: boolean;
  onCopy: (code?: string) => void;
}) {
  return (
    <div className="workspace-code-row">
      <span>{label}</span>
      <strong>{code ?? '未生成'}</strong>
      <button
        className={copied ? 'copied' : ''}
        type="button"
        disabled={!code}
        onClick={() => onCopy(code)}
        title={copied ? '已复制' : '复制代码'}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
        <em>{copied ? '已复制' : '复制'}</em>
      </button>
    </div>
  );
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back to the legacy path below.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  try {
    return document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}

async function exportChartWithTable(
  chartPayload: ChartExportPayload,
  rows: PerformanceSeries[],
  title: string,
): Promise<void> {
  const chartImage = await loadImage(chartPayload.dataUrl);
  const scale = chartImage.width / chartPayload.width;
  const width = chartImage.width;
  const tableTop = Math.round(14 * scale);
  const headerHeight = Math.round(42 * scale);
  const rowHeight = Math.round(42 * scale);
  const paddingX = Math.round(16 * scale);
  const bottomPadding = Math.round(16 * scale);
  const tableHeight = headerHeight + rows.length * rowHeight + bottomPadding;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = chartImage.height + tableTop + tableHeight;
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }

  context.fillStyle = '#eef2f7';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(chartImage, 0, 0);
  drawChartEndLabels(context, chartPayload.endLabels, scale, width);

  const tableY = chartImage.height + tableTop;
  context.fillStyle = '#ffffff';
  context.fillRect(0, tableY, width, tableHeight);
  drawExportTable(context, rows, tableY, width, scale, paddingX, headerHeight, rowHeight);

  const link = document.createElement('a');
  link.download = `${title}-涨幅看板-${new Date().toISOString().slice(0, 10)}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function drawChartEndLabels(
  context: CanvasRenderingContext2D,
  labels: ChartExportPayload['endLabels'],
  scale: number,
  chartWidth: number,
): void {
  if (!labels.length) {
    return;
  }

  context.save();
  context.textBaseline = 'middle';
  labels.forEach((label) => {
    const x = label.left * scale;
    const y = label.top * scale;
    const maxWidth = Math.min(label.width * scale, chartWidth - x - 14 * scale);
    if (maxWidth <= 8 * scale) {
      return;
    }

    context.font = `900 ${Math.round(12 * scale)}px PingFang SC, Microsoft YaHei, Arial`;
    const text = ellipsizeText(context, label.label, maxWidth);
    context.lineWidth = Math.max(2, 2.5 * scale);
    context.strokeStyle = 'rgba(0, 0, 0, 0.88)';
    context.shadowColor = label.color;
    context.shadowBlur = 7 * scale;
    context.fillStyle = label.color;
    context.strokeText(text, x, y);
    context.fillText(text, x, y);
  });
  context.restore();
}

function drawExportTable(
  context: CanvasRenderingContext2D,
  rows: PerformanceSeries[],
  y: number,
  width: number,
  scale: number,
  paddingX: number,
  headerHeight: number,
  rowHeight: number,
): void {
  const columns = [
    { label: '公司 / 标签', ratio: 0.24 },
    { label: '市场', ratio: 0.14 },
    { label: '区间涨幅', ratio: 0.15 },
    { label: '年度涨幅', ratio: 0.15 },
    { label: '最大回撤', ratio: 0.14 },
    { label: '阶段', ratio: 0.1 },
    { label: '最后日期', ratio: 0.12 },
  ];
  const totalRatio = columns.reduce((sum, item) => sum + item.ratio, 0);
  const columnWidths = columns.map((item) => ((width - paddingX * 2) * item.ratio) / totalRatio);
  const columnXs = columnWidths.reduce<number[]>((positions, columnWidth, index) => {
    positions.push(index === 0 ? paddingX : positions[index - 1] + columnWidths[index - 1]);
    return positions;
  }, []);

  context.fillStyle = '#050505';
  context.fillRect(0, y, width, headerHeight);
  context.font = `800 ${Math.round(14 * scale)}px PingFang SC, Microsoft YaHei, Arial`;
  context.textBaseline = 'middle';
  context.fillStyle = '#ffffff';
  columns.forEach((column, index) => {
    drawClippedText(context, column.label, columnXs[index], y + headerHeight / 2, columnWidths[index] - 8 * scale);
  });

  rows.forEach((row, rowIndex) => {
    const rowY = y + headerHeight + rowIndex * rowHeight;
    context.fillStyle = '#ffffff';
    context.fillRect(0, rowY, width, rowHeight);
    context.strokeStyle = '#e4e7ec';
    context.lineWidth = Math.max(1, scale);
    context.beginPath();
    context.moveTo(0, rowY);
    context.lineTo(width, rowY);
    context.stroke();

    const centerY = rowY + rowHeight / 2;
    context.fillStyle = row.color;
    context.beginPath();
    context.arc(columnXs[0] + 6 * scale, centerY, 5 * scale, 0, Math.PI * 2);
    context.fill();

    context.font = `800 ${Math.round(14 * scale)}px PingFang SC, Microsoft YaHei, Arial`;
    context.fillStyle = '#172033';
    const nameOffset = 18 * scale;
    drawClippedText(
      context,
      row.memberCount ? `${row.label} ${row.memberCount}只` : row.label,
      columnXs[0] + nameOffset,
      centerY,
      columnWidths[0] - nameOffset - 8 * scale,
    );

    context.font = `${Math.round(14 * scale)}px PingFang SC, Microsoft YaHei, Arial`;
    context.fillStyle = '#172033';
    drawClippedText(context, formatExportMarket(row), columnXs[1], centerY, columnWidths[1] - 8 * scale);
    drawMetricCell(context, row.metrics.rangeReturn, columnXs[2], centerY, columnWidths[2] - 8 * scale);
    drawMetricCell(context, row.metrics.ytdReturn, columnXs[3], centerY, columnWidths[3] - 8 * scale);
    drawMetricCell(context, row.metrics.maxDrawdown, columnXs[4], centerY, columnWidths[4] - 8 * scale);

    context.fillStyle = '#172033';
    drawClippedText(context, row.metrics.stage, columnXs[5], centerY, columnWidths[5] - 8 * scale);
    drawClippedText(context, row.metrics.lastDate ?? '-', columnXs[6], centerY, columnWidths[6] - 8 * scale);
  });
}

function drawMetricCell(
  context: CanvasRenderingContext2D,
  value: number | null,
  x: number,
  y: number,
  maxWidth: number,
): void {
  context.font = context.font.replace(/^\d+ /, '800 ');
  context.fillStyle = value === null ? '#667085' : value >= 0 ? '#d92d20' : '#039855';
  drawClippedText(context, value === null ? '-' : `${value.toFixed(2)}%`, x, y, maxWidth);
}

function drawClippedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
): void {
  context.fillText(ellipsizeText(context, text, maxWidth), x, y);
}

function ellipsizeText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (context.measureText(text).width <= maxWidth) {
    return text;
  }
  let output = text;
  while (output.length > 1 && context.measureText(`${output}…`).width > maxWidth) {
    output = output.slice(0, -1);
  }
  return `${output}…`;
}

function formatExportMarket(row: PerformanceSeries): string {
  return row.market === 'TAG' ? '标签' : `${marketLabel(row.market)} ${row.code}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片生成失败'));
    image.src = src;
  });
}

function parseBulkSymbols(input: string, defaultMarket: Market, tags: Tag[]) {
  const tagByName = new Map(tags.map((tag) => [tag.name.trim(), tag]));
  const items: Array<Pick<SymbolItem, 'market' | 'code' | 'name' | 'tagIds'>> = [];
  const messages: string[] = [];

  input
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line, index) => {
      const normalized = line.replace(/[，,]/g, ' , ').replace(/\s+/g, ' ').trim();
      const parts = normalized.split(' ');
      let cursor = 0;
      const parsedMarket = normalizeMarket(parts[0]);
      const market = parsedMarket ?? defaultMarket;
      if (parsedMarket) {
        cursor = 1;
      }

      const code = parts[cursor]?.trim().toUpperCase();
      const name = parts[cursor + 1]?.trim();
      const tagText = parts.slice(cursor + 2).join(' ');
      if (!code || !name) {
        messages.push(`第 ${index + 1} 行未识别：${line}`);
        return;
      }

      const tagIds: string[] = [];
      parseTagNames(tagText).forEach((tagName) => {
        const tag = tagByName.get(tagName);
        if (tag) {
          tagIds.push(tag.id);
        } else if (tagName) {
          messages.push(`第 ${index + 1} 行标签不存在：${tagName}`);
        }
      });

      items.push({
        market,
        code,
        name,
        tagIds: Array.from(new Set(tagIds)),
      });
    });

  return { items, messages };
}

function parseTagNames(text: string): string[] {
  return text
    .split(/[、,，;；|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeMarket(value: string | undefined): Market | null {
  if (!value) {
    return null;
  }
  const upper = value.trim().toUpperCase();
  const map: Record<string, Market> = {
    A: 'CN_A',
    A股: 'CN_A',
    CN: 'CN_A',
    CNY: 'CN_A',
    CN_A: 'CN_A',
    US: 'US',
    USA: 'US',
    美股: 'US',
    HK: 'HK',
    港股: 'HK',
    韩国: 'KR_KOSPI',
    韩股: 'KR_KOSPI',
    KOSPI: 'KR_KOSPI',
    KR_KOSPI: 'KR_KOSPI',
    KOSDAQ: 'KR_KOSDAQ',
    KR_KOSDAQ: 'KR_KOSDAQ',
    CUSTOM: 'CUSTOM',
    自定义: 'CUSTOM',
  };
  return map[upper] ?? null;
}

function randomTagColor(previousColor?: string): string {
  if (tagColorPalette.length <= 1) {
    return tagColorPalette[0] ?? '#2563eb';
  }
  let next = previousColor;
  while (next === previousColor) {
    next = tagColorPalette[Math.floor(Math.random() * tagColorPalette.length)] ?? '#2563eb';
  }
  return next ?? '#2563eb';
}

function keepTagsWithSelectedMembers(symbols: SymbolItem[], tagIds: string[], selectedSymbolIds: Set<string>): string[] {
  return tagIds.filter((tagId) =>
    symbols.some((symbol) => selectedSymbolIds.has(symbol.id) && symbol.tagIds.includes(tagId)),
  );
}

function getLinkedTagIdsForSymbols(
  symbols: SymbolItem[],
  tags: Tag[],
  selectedTagIds: Set<string>,
  symbolIds: Iterable<string>,
): string[] {
  const symbolIdSet = new Set(symbolIds);
  const tagMap = new Map(tags.map((tag) => [tag.id, tag]));
  const selectedCategories = new Set(
    Array.from(selectedTagIds)
      .map((tagId) => tagMap.get(tagId)?.category || null)
      .filter((category): category is string => Boolean(category)),
  );
  const shouldUseAllCategories = selectedCategories.size === 0;
  const linkedTagIds = new Set<string>();

  symbols.forEach((symbol) => {
    if (!symbolIdSet.has(symbol.id)) {
      return;
    }
    if (symbol.tagIds.some((tagId) => selectedTagIds.has(tagId))) {
      return;
    }
    symbol.tagIds.forEach((tagId) => {
      const tag = tagMap.get(tagId);
      if (!tag) {
        return;
      }
      if (shouldUseAllCategories || selectedCategories.has(tag.category)) {
        linkedTagIds.add(tagId);
      }
    });
  });

  return Array.from(linkedTagIds);
}

function marketLabel(market: Market): string {
  return markets.find((item) => item.value === market)?.label ?? market;
}

function matchesMarketFilter(symbol: SymbolItem, marketFilter: MarketFilter): boolean {
  return marketFilter === 'ALL' || symbol.market === marketFilter;
}

function createViewTabFromState(id: string, name: string, state: AppState): ViewTab {
  return {
    id,
    name,
    selectedSymbolIds: state.selectedSymbolIds,
    selectedTagIds: state.selectedTagIds,
    marketFilter: state.marketFilter,
    mode: state.mode,
    interval: state.interval,
    startDate: state.startDate,
    endDate: state.endDate,
  };
}

function syncActiveViewTab(state: AppState): AppState {
  const activeView = state.viewTabs.find((view) => view.id === state.activeViewId);
  if (!activeView) {
    return state;
  }
  const nextView = createViewTabFromState(activeView.id, activeView.name, state);
  if (isSameViewTab(activeView, nextView)) {
    return state;
  }
  return {
    ...state,
    viewTabs: state.viewTabs.map((view) => (view.id === state.activeViewId ? nextView : view)),
  };
}

function applyViewTab(state: AppState, view: ViewTab): AppState {
  const validSymbolIds = new Set(state.symbols.map((symbol) => symbol.id));
  const validTagIds = new Set(state.tags.map((tag) => tag.id));
  return {
    ...state,
    activeViewId: view.id,
    selectedSymbolIds: view.selectedSymbolIds.filter((id) => validSymbolIds.has(id)),
    selectedTagIds: view.selectedTagIds.filter((id) => validTagIds.has(id)),
    marketFilter: view.marketFilter,
    mode: view.mode,
    interval: view.interval,
    startDate: view.startDate,
    endDate: view.endDate,
  };
}

function isSameViewTab(a: ViewTab, b: ViewTab): boolean {
  return (
    a.name === b.name &&
    a.marketFilter === b.marketFilter &&
    a.mode === b.mode &&
    a.interval === b.interval &&
    a.startDate === b.startDate &&
    a.endDate === b.endDate &&
    isSameStringArray(a.selectedSymbolIds, b.selectedSymbolIds) &&
    isSameStringArray(a.selectedTagIds, b.selectedTagIds)
  );
}

function isSameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((item, index) => item === b[index]);
}

function nextViewName(views: ViewTab[]): string {
  let index = views.length + 1;
  let name = `视图 ${index}`;
  const names = new Set(views.map((view) => view.name));
  while (names.has(name)) {
    index += 1;
    name = `视图 ${index}`;
  }
  return name;
}
