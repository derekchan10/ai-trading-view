import type { CSSProperties, FormEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CirclePlus,
  DatabaseZap,
  ListChecks,
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
import { loadState, resetState, saveState } from './services/storage';
import type { AppState, ChartMode, Interval, Market, PerformanceSeries, SymbolItem, Tag } from './types';
import './styles.css';

type CssVars = CSSProperties & Record<`--${string}`, string>;

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
    name: '',
    category: '产业链环节',
    color: randomTagColor(),
  };
}

const emptyBatchForm = {
  market: 'CN_A' as Market,
  text: '',
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
  const [bulkSymbolIds, setBulkSymbolIds] = useState<string[]>([]);
  const [bulkTagIds, setBulkTagIds] = useState<string[]>([]);
  const [activePanel, setActivePanel] = useState<'symbol' | 'tags' | 'batch' | null>(null);
  const [symbolError, setSymbolError] = useState('');
  const [batchMessage, setBatchMessage] = useState('');
  const lastRefreshKeyRef = useRef(refreshKey);

  useEffect(() => {
    saveState(state);
  }, [state]);

  useEffect(() => {
    if (activePanel === 'tags') {
      setTagForm((current) => ({ ...current, color: randomTagColor(current.color) }));
    }
  }, [activePanel]);

  const tagMap = useMemo(() => new Map(state.tags.map((tag) => [tag.id, tag])), [state.tags]);

  const visibleSymbols = useMemo(() => {
    const selectedSymbolIds = new Set(state.selectedSymbolIds);
    return state.symbols.filter((symbol) => selectedSymbolIds.has(symbol.id));
  }, [state.selectedSymbolIds, state.symbols]);

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
      return state.symbols;
    }
    return state.symbols.filter((symbol) => {
      const tags = symbol.tagIds.map((id) => tagMap.get(id)?.name ?? '').join(' ');
      return `${symbol.market} ${symbol.code} ${symbol.name} ${tags}`.toLowerCase().includes(keyword);
    });
  }, [query, state.symbols, tagMap]);

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

  const title = useMemo(() => {
    const startYear = state.startDate.slice(0, 4);
    const endYear = state.endDate.slice(0, 4);
    return `${startYear}年-${endYear}年 涨幅节奏`;
  }, [state.endDate, state.startDate]);

  function updateState(patch: Partial<AppState>) {
    setState((current) => ({ ...current, ...patch }));
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
      setActivePanel(null);
    }
  }

  function editSymbol(symbol: SymbolItem) {
    setSymbolForm({
      id: symbol.id,
      market: symbol.market,
      code: symbol.code,
      name: symbol.name,
      lineColor: symbol.lineColor ?? '',
      tagIds: symbol.tagIds,
    });
    setSymbolError('');
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
      id: `tag-${Date.now()}`,
      name,
      category: tagForm.category.trim() || '自定义',
      color: tagForm.color,
    };
    setState((current) => ({ ...current, tags: [...current.tags, tag] }));
    setTagForm({
      ...createEmptyTagForm(),
      category: tagForm.category.trim() || '产业链环节',
    });
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
  }

  function resetAll() {
    setState(resetState());
    setSymbolForm(emptySymbolForm);
    setTagForm(createEmptyTagForm());
    setBatchForm(emptyBatchForm);
    setBulkSymbolIds([]);
    setBulkTagIds([]);
    setActivePanel(null);
    setRefreshKey((value) => value + 1);
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
            <p>纯前端 · 本地股票池 · 标签联动</p>
          </div>
        </div>
        <div className="top-actions">
          <button
            className={`top-action-button ${activePanel === 'symbol' ? 'active' : ''}`}
            type="button"
            onClick={() => {
              setSymbolForm(emptySymbolForm);
              setSymbolError('');
              setActivePanel('symbol');
            }}
          >
            <CirclePlus size={15} />
            新增股票
          </button>
          <button
            className={`top-action-button ${activePanel === 'batch' ? 'active' : ''}`}
            type="button"
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
            onClick={() => setActivePanel('tags')}
          >
            <Tags size={15} />
            标签管理
          </button>
          <button className="top-action-button" onClick={() => setRefreshKey((value) => value + 1)} title="刷新行情">
            <RefreshCw size={15} />
            刷新行情
          </button>
          <button className="top-action-button danger" onClick={resetAll} title="恢复默认股票池">
            <RotateCcw size={15} />
            恢复默认
          </button>
        </div>
      </header>

      <section className="control-strip">
        <Segmented
          label="模式"
          value={state.mode}
          options={modeOptions}
          onChange={(value) => updateState({ mode: value })}
        />
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
          已选股票 {visibleSymbols.length}/{state.symbols.length} 只 · 标签 {state.selectedTagIds.length} 个 · 曲线 {series.length} 条
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
                      : '标签管理'}
                </h2>
                <p>
                  {activePanel === 'symbol'
                    ? '添加代码、名称、市场和标签'
                    : activePanel === 'batch'
                      ? '批量导入、编辑、打标签和删除'
                      : '按类型维护标签、颜色和删除项'}
                </p>
              </div>
              <button className="icon-button" type="button" onClick={() => setActivePanel(null)} title="关闭">
                <X size={18} />
              </button>
            </div>

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
                    <button className="ghost-button" type="button" onClick={() => setSymbolForm(emptySymbolForm)}>
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
                      批量导入/更新
                    </button>
                  </div>
                  <textarea
                    value={batchForm.text}
                    placeholder={'每行一只：市场 代码 名称 标签1,标签2\n例如：美股 NVDA 英伟达 算力芯片,上游\n也可省略市场：AMD 超威半导体 算力芯片'}
                    onChange={(event) => setBatchForm((current) => ({ ...current, text: event.target.value }))}
                  />
                </form>

                <div className="stock-manager-grid">
                  <section className="batch-section stock-batch-section">
                    <div className="batch-section-title">
                      <strong>批量选择股票</strong>
                      <span>{bulkSymbolIds.length} / {state.symbols.length}</span>
                    </div>
                    <div className="batch-toolbar">
                      <button
                        type="button"
                        title="选中下面当前显示的股票列表"
                        onClick={() => setBulkSymbolIds(filteredSymbols.map((symbol) => symbol.id))}
                      >
                        全选当前列表
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
                      {filteredSymbols.map((symbol) => {
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
                              <button type="button" onClick={() => editSymbol(symbol)}>
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
                    <button className="primary-button add-tag-button" type="submit">
                      <CirclePlus size={16} />
                      新增标签
                    </button>
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
                            <button onClick={() => deleteTag(tag.id)} title="删除标签">
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
