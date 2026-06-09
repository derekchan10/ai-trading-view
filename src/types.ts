export type Market = 'CN_A' | 'US' | 'HK' | 'KR_KOSPI' | 'KR_KOSDAQ' | 'CUSTOM';

export type MarketFilter = Market | 'ALL';

export type ChartMode = 'symbols' | 'tags' | 'mixed';

export type Interval = '1d' | '1wk' | '1mo';

export interface Tag {
  id: string;
  name: string;
  category: string;
  color: string;
}

export interface SymbolItem {
  id: string;
  market: Market;
  code: string;
  name: string;
  tagIds: string[];
  lineColor?: string;
  defaultVisible?: boolean;
}

export interface PricePoint {
  date: string;
  close: number;
  rawClose?: number | null;
  volume?: number | null;
}

export interface PerformancePoint {
  date: string;
  value: number;
  close?: number | null;
}

export interface SeriesMetrics {
  rangeReturn: number | null;
  ytdReturn: number | null;
  maxDrawdown: number | null;
  startDate: string | null;
  lastDate: string | null;
  stage: string;
}

export interface PerformanceSeries {
  id: string;
  type: 'symbol' | 'tag';
  name: string;
  label: string;
  color: string;
  market: Market | 'TAG';
  code: string;
  tagIds: string[];
  tagNames?: string[];
  memberCount?: number;
  members?: Array<{
    id: string;
    name: string;
    market: Market | 'TAG';
    code: string;
  }>;
  data: PerformancePoint[];
  metrics: SeriesMetrics;
}

export interface ViewTab {
  id: string;
  name: string;
  selectedSymbolIds: string[];
  selectedTagIds: string[];
  marketFilter: MarketFilter;
  mode: ChartMode;
  interval: Interval;
  startDate: string;
  endDate: string;
}

export interface AppState {
  tags: Tag[];
  symbols: SymbolItem[];
  selectedSymbolIds: string[];
  selectedTagIds: string[];
  viewTabs: ViewTab[];
  activeViewId: string;
  marketFilter: MarketFilter;
  mode: ChartMode;
  interval: Interval;
  startDate: string;
  endDate: string;
}
