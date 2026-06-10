import type {
  Interval,
  Market,
  PerformancePoint,
  PerformanceSeries,
  PricePoint,
  SeriesMetrics,
  SymbolItem,
  Tag,
} from '../types';

const cache = new Map<string, PricePoint[]>();
const CACHE_PREFIX = 'ai-trading-view.price-cache.v1.';
const CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const API_TIMEOUT_MS = 240000;
const PRICE_BATCH_CHUNK_SIZE = 6;
let persistentCacheCleared = false;

interface PriceBatchApiItem {
  id: string;
  providerSymbol: string;
  resolvedMarket?: Market;
  resolvedName?: string;
  exchangeName?: string;
  prices: PricePoint[];
}

interface PriceBatchApiWarning {
  id: string;
  providerSymbol?: string;
  message: string;
}

interface PriceBatchApiResponse {
  items?: PriceBatchApiItem[];
  warnings?: PriceBatchApiWarning[];
}

interface PriceBatchResult {
  pricesById: Map<string, PricePoint[]>;
  warningById: Map<string, string>;
}

export interface SymbolPricePreview {
  providerSymbol: string;
  resolvedMarket?: Market;
  resolvedName?: string;
  exchangeName?: string;
  pointCount: number;
  lastDate: string | null;
  lastClose: number | null;
  warning?: string;
}

interface PendingSymbol {
  symbol: SymbolItem;
  cacheKey: string;
}

export function toYahooSymbol(market: Market, code: string): string {
  const clean = code.trim().toUpperCase();
  if (clean.includes('.')) {
    return clean;
  }

  if (market === 'US' || market === 'CUSTOM') {
    return clean;
  }

  if (market === 'HK') {
    const digits = clean.replace(/\D/g, '');
    return digits ? `${Number(digits).toString().padStart(4, '0')}.HK` : clean;
  }

  if (market === 'KR_KOSPI') {
    return `${clean.padStart(6, '0')}.KS`;
  }

  if (market === 'KR_KOSDAQ') {
    return `${clean.padStart(6, '0')}.KQ`;
  }

  if (market === 'CN_A') {
    const digits = clean.replace(/\D/g, '');
    if (!digits) {
      return clean;
    }
    if (/^[468]/.test(digits)) {
      return digits.startsWith('8') || digits.startsWith('4') ? `${digits}.BJ` : `${digits}.SS`;
    }
    return `${digits}.SZ`;
  }

  return clean;
}

export function inferMarketFromYahooSymbol(providerSymbol: string, fallback: Market): Market {
  const clean = providerSymbol.trim().toUpperCase();
  if (/\.(SS|SZ|BJ)$/.test(clean)) {
    return 'CN_A';
  }
  if (/\.HK$/.test(clean)) {
    return 'HK';
  }
  if (/\.KS$/.test(clean)) {
    return 'KR_KOSPI';
  }
  if (/\.KQ$/.test(clean)) {
    return 'KR_KOSDAQ';
  }
  if (!clean.includes('.') && !clean.includes('=') && !clean.startsWith('^')) {
    return 'US';
  }
  return fallback;
}

export async function previewSymbolPrice(
  symbol: Pick<SymbolItem, 'market' | 'code' | 'name'>,
): Promise<SymbolPricePreview> {
  const cleanCode = symbol.code.trim().toUpperCase();
  const providerSymbol = toYahooSymbol(symbol.market, cleanCode);
  if (!cleanCode) {
    return {
      providerSymbol,
      pointCount: 0,
      lastDate: null,
      lastClose: null,
      warning: '请输入股票代码',
    };
  }

  const endDate = formatLocalDate(new Date());
  const start = new Date();
  start.setDate(start.getDate() - 45);
  const startDate = formatLocalDate(start);
  const payload = await requestBatchPriceSeries(
    [
      {
        id: 'symbol-preview',
        market: symbol.market,
        code: cleanCode,
        name: symbol.name || cleanCode,
        tagIds: [],
      },
    ],
    '1d',
    startDate,
    endDate,
    false,
    true,
  );
  const item = payload.items?.find((entry) => entry.id === 'symbol-preview');
  const prices = item?.prices ?? [];
  const last = prices[prices.length - 1];
  if (last) {
    return {
      providerSymbol: item?.providerSymbol ?? providerSymbol,
      resolvedMarket: item?.resolvedMarket ?? inferMarketFromYahooSymbol(item?.providerSymbol ?? providerSymbol, symbol.market),
      resolvedName: item?.resolvedName,
      exchangeName: item?.exchangeName,
      pointCount: prices.length,
      lastDate: last.date,
      lastClose: last.rawClose ?? last.close ?? null,
    };
  }

  const warning = payload.warnings?.find((entry) => entry.id === 'symbol-preview');
  return {
    providerSymbol: warning?.providerSymbol ?? providerSymbol,
    pointCount: 0,
    lastDate: null,
    lastClose: null,
    warning: warning?.message || '暂无有效行情',
  };
}

async function fetchBatchPriceSeries(
  symbols: SymbolItem[],
  interval: Interval,
  startDate: string,
  endDate: string,
  refresh = false,
): Promise<PriceBatchResult> {
  const pricesById = new Map<string, PricePoint[]>();
  const warningById = new Map<string, string>();
  const pending: PendingSymbol[] = [];

  symbols.forEach((symbol) => {
    const providerSymbol = toYahooSymbol(symbol.market, symbol.code);
    const cacheKey = `${providerSymbol}|${interval}|${startDate}|${endDate}`;
    if (!refresh && cache.has(cacheKey)) {
      pricesById.set(symbol.id, cache.get(cacheKey) ?? []);
      return;
    }
    if (!refresh) {
      const stored = readStoredPriceCache(cacheKey);
      if (stored) {
        cache.set(cacheKey, stored);
        pricesById.set(symbol.id, stored);
        return;
      }
    }
    pending.push({ symbol, cacheKey });
  });

  if (!pending.length) {
    return { pricesById, warningById };
  }

  const pendingById = new Map(pending.map((item) => [item.symbol.id, item]));
  const pendingChunks = chunkItems(pending, PRICE_BATCH_CHUNK_SIZE);
  for (const chunk of pendingChunks) {
    try {
      const payload = await requestBatchPriceSeries(
        chunk.map((item) => item.symbol),
        interval,
        startDate,
        endDate,
        refresh,
      );
      payload.items?.forEach((item) => {
        const pendingItem = pendingById.get(item.id);
        if (!pendingItem || !Array.isArray(item.prices)) {
          return;
        }
        pricesById.set(item.id, item.prices);
        cache.set(pendingItem.cacheKey, item.prices);
        writeStoredPriceCache(pendingItem.cacheKey, item.prices);
      });

      payload.warnings?.forEach((warning) => {
        if (warning.id) {
          warningById.set(warning.id, warning.message || '行情请求失败');
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '行情请求失败';
      chunk.forEach((item) => {
        const stored = readStoredPriceCache(item.cacheKey);
        if (stored) {
          cache.set(item.cacheKey, stored);
          pricesById.set(item.symbol.id, stored);
          return;
        }
        warningById.set(item.symbol.id, message);
      });
    }
  }

  return { pricesById, warningById };
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function readStoredPriceCache(cacheKey: string): PricePoint[] | null {
  clearPersistentPriceCache();
  try {
    const raw = window.localStorage.getItem(`${CACHE_PREFIX}${cacheKey}`);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { savedAt: number; data: PricePoint[] };
    if (!Array.isArray(parsed.data) || Date.now() - parsed.savedAt > CACHE_TTL_MS) {
      window.localStorage.removeItem(`${CACHE_PREFIX}${cacheKey}`);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function writeStoredPriceCache(cacheKey: string, data: PricePoint[]): void {
  void cacheKey;
  void data;
  clearPersistentPriceCache();
}

function clearPersistentPriceCache(): void {
  if (persistentCacheCleared) {
    return;
  }
  persistentCacheCleared = true;
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(CACHE_PREFIX)) {
        keys.push(key);
      }
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Memory cache and Node server cache still keep the app usable.
  }
}

async function requestBatchPriceSeries(
  symbols: SymbolItem[],
  interval: Interval,
  startDate: string,
  endDate: string,
  refresh: boolean,
  includeMeta = false,
): Promise<PriceBatchApiResponse> {
  const response = await fetchWithTimeout('/api/prices/batch', API_TIMEOUT_MS, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      symbols: symbols.map((symbol) => ({
        id: symbol.id,
        market: symbol.market,
        code: symbol.code,
        name: symbol.name,
      })),
      interval,
      startDate,
      endDate,
      refresh,
      includeMeta,
    }),
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return (await response.json()) as PriceBatchApiResponse;
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error ?? `行情接口请求失败：${response.status}`;
  } catch {
    return `行情接口请求失败：${response.status}`;
  }
}

export async function buildPerformanceSeries(
  symbols: SymbolItem[],
  tags: Tag[],
  mode: 'symbols' | 'tags' | 'mixed',
  interval: Interval,
  startDate: string,
  endDate: string,
  selectedTagIds: string[],
  refresh = false,
): Promise<{ series: PerformanceSeries[]; warnings: string[] }> {
  const tagMap = new Map(tags.map((tag) => [tag.id, tag]));
  const { pricesById, warningById } = await fetchBatchPriceSeries(
    symbols,
    interval,
    startDate,
    endDate,
    refresh,
  );

  const symbolSeries: PerformanceSeries[] = [];
  const warnings: string[] = [];
  symbols.forEach((symbol) => {
    const prices = pricesById.get(symbol.id) ?? [];
    if (prices.length) {
      const built = buildSymbolPerformance(symbol, prices, tagMap);
      if (built.data.length) {
        symbolSeries.push(built);
        return;
      }
    }

    const providerSymbol = toYahooSymbol(symbol.market, symbol.code);
    const message = warningById.get(symbol.id) ?? '暂无有效行情';
    warnings.push(`${symbol.name}(${providerSymbol})：${message}`);
  });

  if (!symbols.length) {
    return { series: [], warnings: [] };
  }

  const output: PerformanceSeries[] = [];
  if (mode === 'symbols' || mode === 'mixed') {
    output.push(...symbolSeries);
  }
  if (mode === 'tags' || mode === 'mixed') {
    output.push(...buildTagAggregates(selectedTagIds, symbolSeries, tagMap));
  }

  return { series: output, warnings };
}

function buildSymbolPerformance(
  symbol: SymbolItem,
  prices: PricePoint[],
  tagMap: Map<string, Tag>,
): PerformanceSeries {
  const first = prices[0]?.close;
  const points: PerformancePoint[] = first
    ? prices.map((item) => ({
        date: item.date,
        value: round((item.close / first - 1) * 100),
        close: item.close,
      }))
    : [];
  const repairedPoints = repairNeedleSpikes(points);
  const color = getSymbolColor(symbol, tagMap);
  const tagNames = symbol.tagIds.map((tagId) => tagMap.get(tagId)?.name).filter(Boolean) as string[];
  return {
    id: symbol.id,
    type: 'symbol',
    name: symbol.name,
    label: symbol.name,
    color,
    market: symbol.market,
    code: symbol.code,
    tagIds: symbol.tagIds,
    tagNames,
    data: repairedPoints,
    metrics: computeMetrics(repairedPoints),
  };
}

function getSymbolColor(symbol: SymbolItem, tagMap: Map<string, Tag>): string {
  if (symbol.lineColor) {
    return symbol.lineColor;
  }
  const primaryTagId =
    symbol.tagIds.find((id) => tagMap.get(id)?.category === '产业链环节') ??
    symbol.tagIds.find((id) => tagMap.get(id)?.category === '产业链位置') ??
    symbol.tagIds[0];
  return tagMap.get(primaryTagId)?.color ?? '#94a3b8';
}

function buildTagAggregates(
  tagIds: string[],
  symbolSeries: PerformanceSeries[],
  tagMap: Map<string, Tag>,
): PerformanceSeries[] {
  return tagIds.flatMap((tagId) => {
    const tag = tagMap.get(tagId);
    if (!tag) {
      return [];
    }
    const members = symbolSeries.filter((series) => series.tagIds.includes(tagId));
    if (!members.length) {
      return [];
    }
    const data = averageSeries(members);
    return [
      {
        id: `tag-${tagId}`,
        type: 'tag',
        name: tag.name,
        label: tag.name,
        color: tag.color,
        market: 'TAG' as const,
        code: tag.id,
        tagIds: [tag.id],
        tagNames: [tag.name],
        memberCount: members.length,
        members: members.map((member) => ({
          id: member.id,
          name: member.name,
          market: member.market,
          code: member.code,
          color: member.color,
          data: member.data,
        })),
        data,
        metrics: computeMetrics(data),
      },
    ];
  });
}

function averageSeries(seriesList: PerformanceSeries[]): PerformancePoint[] {
  const allDates = Array.from(
    new Set(seriesList.flatMap((series) => series.data.map((point) => point.date))),
  ).sort((a, b) => a.localeCompare(b));
  const cursors = seriesList.map((series) => ({
    data: series.data,
    index: -1,
    lastValue: null as number | null,
  }));
  const points: PerformancePoint[] = [];

  allDates.forEach((date) => {
    const values: number[] = [];
    cursors.forEach((cursor) => {
      while (cursor.index + 1 < cursor.data.length && cursor.data[cursor.index + 1].date <= date) {
        cursor.index += 1;
        cursor.lastValue = cursor.data[cursor.index].value;
      }
      if (cursor.lastValue !== null) {
        values.push(cursor.lastValue);
      }
    });
    if (values.length) {
      points.push({
        date,
        value: round(values.reduce((sum, value) => sum + value, 0) / values.length),
        close: null,
      });
    }
  });

  return repairNeedleSpikes(points);
}

function repairNeedleSpikes(points: PerformancePoint[]): PerformancePoint[] {
  if (points.length < 3) {
    return points;
  }
  const repaired = points.map((point) => ({ ...point }));
  for (let index = 1; index < repaired.length - 1; index += 1) {
    const previous = repaired[index - 1].value;
    const current = repaired[index].value;
    const next = repaired[index + 1].value;
    const jumpIn = current - previous;
    const jumpOut = next - current;
    const neighborMove = next - previous;
    const isNeedle =
      Math.abs(jumpIn) > 180 &&
      Math.abs(jumpOut) > 180 &&
      Math.sign(jumpIn) !== Math.sign(jumpOut) &&
      Math.abs(neighborMove) < 90;
    if (isNeedle) {
      repaired[index].value = round((previous + next) / 2);
    }
  }
  return repaired;
}

export function computeMetrics(points: PerformancePoint[]): SeriesMetrics {
  if (!points.length) {
    return {
      rangeReturn: null,
      ytdReturn: null,
      maxDrawdown: null,
      startDate: null,
      lastDate: null,
      stage: '无数据',
    };
  }

  const rangeReturn = points[points.length - 1].value;
  const lastYear = points[points.length - 1].date.slice(0, 4);
  const ytdPoints = points.filter((point) => point.date.startsWith(lastYear));
  let ytdReturn: number | null = null;
  if (ytdPoints.length) {
    const firstFactor = 1 + ytdPoints[0].value / 100;
    const lastFactor = 1 + ytdPoints[ytdPoints.length - 1].value / 100;
    ytdReturn = firstFactor > 0 ? round((lastFactor / firstFactor - 1) * 100) : null;
  }

  let peak = -Infinity;
  let maxDrawdown = 0;
  points.forEach((point) => {
    const factor = 1 + point.value / 100;
    peak = Math.max(peak, factor);
    if (peak > 0) {
      maxDrawdown = Math.min(maxDrawdown, factor / peak - 1);
    }
  });

  return {
    rangeReturn: round(rangeReturn),
    ytdReturn,
    maxDrawdown: round(maxDrawdown * 100),
    startDate: points[0].date,
    lastDate: points[points.length - 1].date,
    stage: inferStage(points),
  };
}

function inferStage(points: PerformancePoint[]): string {
  if (points.length < 8) {
    return '数据不足';
  }
  const last = points[points.length - 1].value;
  const recent = last - points[Math.max(0, points.length - 8)].value;
  const peak = Math.max(...points.map((point) => point.value));
  const drawdownFromPeak = last - peak;

  if (last < 5 && recent < 3) {
    return '沉寂';
  }
  if (recent > 20 && last < 80) {
    return '启动';
  }
  if (recent > 30 && last >= 80) {
    return '加速';
  }
  if (drawdownFromPeak < -25 && last > 80) {
    return '高位分化';
  }
  if (last > 120) {
    return '主升/验证';
  }
  if (last > 30) {
    return '扩散';
  }
  return '观察';
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
