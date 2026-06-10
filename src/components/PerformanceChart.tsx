import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';
import { Download } from 'lucide-react';
import type { PerformancePoint, PerformanceSeries } from '../types';

interface PerformanceChartProps {
  title: string;
  series: PerformanceSeries[];
  loading: boolean;
  onExportImage?: (payload: ChartExportPayload) => void;
}

export interface ChartExportPayload {
  dataUrl: string;
  width: number;
  height: number;
  endLabels: ChartExportEndLabel[];
}

export interface ChartExportEndLabel {
  label: string;
  color: string;
  left: number;
  top: number;
  width: number;
}

interface HoverInfo {
  series: PerformanceSeries;
  date: string;
  value: number;
}

interface EndLabelInfo extends HoverInfo {
  id: string;
  color: string;
  label: string;
  left: number;
  top: number;
  width: number;
}

export function PerformanceChart({ title, series, loading, onExportImage }: PerformanceChartProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const latestSeriesRef = useRef(series);
  const highlightedSeriesIdRef = useRef<string | null>(null);
  const syncEndLabelsRef = useRef<() => void>(() => {});
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [endLabels, setEndLabels] = useState<EndLabelInfo[]>([]);

  const option = useMemo<EChartsOption>(() => {
    const endLabelLayout = getEndLabelLayout(series);
    return {
      backgroundColor: '#050505',
      animation: false,
      title: {
        text: title,
        left: 18,
        top: 12,
        textStyle: {
          color: '#ffffff',
          fontSize: 20,
          fontWeight: 800,
          fontFamily: 'PingFang SC, Microsoft YaHei, Arial',
        },
      },
      color: series.map((item) => item.color),
      legend: {
        type: 'scroll',
        top: 44,
        left: 18,
        right: 18,
        icon: 'roundRect',
        itemWidth: 18,
        itemHeight: 8,
        textStyle: {
          color: '#e5e7eb',
          fontSize: 12,
        },
        pageIconColor: '#ffffff',
        pageIconInactiveColor: '#6b7280',
        pageTextStyle: {
          color: '#d1d5db',
        },
      },
      grid: {
        left: 66,
        right: endLabelLayout.gridRight,
        top: 88,
        bottom: 72,
      },
      tooltip: {
        show: false,
      },
      graphic: series.length
        ? []
        : [
            {
              type: 'text',
              left: 'center',
              top: 'middle',
              style: {
                text: '当前没有入图曲线',
                fill: '#94a3b8',
                font: '700 16px PingFang SC, Microsoft YaHei, Arial',
              },
            },
            {
              type: 'text',
              left: 'center',
              top: '54%',
              style: {
                text: '请选择股票或标签后查看走势',
                fill: '#64748b',
                font: '12px PingFang SC, Microsoft YaHei, Arial',
              },
            },
          ],
      toolbox: {
        right: 56,
        top: 12,
        feature: {
          restore: {},
        },
        iconStyle: {
          borderColor: '#e5e7eb',
        },
      },
      xAxis: {
        type: 'time',
        boundaryGap: ['0%', '0%'],
        axisLine: {
          lineStyle: {
            color: '#64748b',
          },
        },
        axisLabel: {
          color: '#cbd5e1',
          hideOverlap: true,
        },
        splitLine: {
          show: true,
          lineStyle: {
            color: '#1f2937',
            type: 'dashed',
          },
        },
      },
      yAxis: {
        type: 'value',
        scale: true,
        splitNumber: 14,
        axisLabel: {
          color: '#cbd5e1',
          formatter: '{value}%',
        },
        axisLine: {
          lineStyle: {
            color: '#64748b',
          },
        },
        splitLine: {
          lineStyle: {
            color: '#28313a',
            type: 'dashed',
          },
        },
        minorTick: {
          show: true,
          splitNumber: 5,
        },
        minorSplitLine: {
          show: true,
          lineStyle: {
            color: '#151b22',
            type: 'dashed',
          },
        },
      },
      dataZoom: [
        {
          type: 'inside',
          throttle: 50,
        },
        {
          type: 'slider',
          height: 26,
          bottom: 22,
          borderColor: '#2d3748',
          fillerColor: 'rgba(59, 130, 246, 0.28)',
          backgroundColor: '#111827',
          dataBackground: {
            lineStyle: {
              color: '#64748b',
            },
            areaStyle: {
              color: '#1f2937',
            },
          },
          selectedDataBackground: {
            lineStyle: {
              color: '#93c5fd',
            },
            areaStyle: {
              color: '#1d4ed8',
            },
          },
          textStyle: {
            color: '#cbd5e1',
          },
        },
      ],
      series: series.flatMap((item) => {
        const data = item.data.map((point) => [point.date, point.value]);
        return [
          {
            id: `${item.id}-line`,
            name: item.label,
            type: 'line',
            data,
            showSymbol: false,
            symbolSize: 4,
            connectNulls: true,
            triggerLineEvent: true,
            clip: false,
            sampling: 'lttb',
            z: item.type === 'tag' ? 5 : 3,
            lineStyle: {
              width: item.type === 'tag' ? 3.4 : 1.6,
              color: item.color,
              type: item.type === 'tag' ? 'solid' : 'solid',
              opacity: item.type === 'tag' ? 0.96 : 0.82,
              shadowBlur: item.type === 'tag' ? 8 : 0,
              shadowColor: item.type === 'tag' ? item.color : undefined,
            },
            endLabel: {
              show: false,
              formatter: item.label,
              color: item.color,
              distance: 8,
              align: 'left',
              width: 145,
              overflow: 'break',
              lineHeight: 15,
              fontSize: item.type === 'tag' ? 12 : 11,
              fontWeight: item.type === 'tag' ? 800 : 700,
            },
            emphasis: {
              focus: 'series',
              scale: false,
              lineStyle: {
                width: item.type === 'tag' ? 4.8 : 3.2,
                opacity: 1,
              },
            },
            blur: {
              lineStyle: {
                opacity: 0.25,
              },
            },
          },
          {
            id: `${item.id}-hitbox`,
            name: item.label,
            type: 'line',
            data,
            showSymbol: false,
            connectNulls: true,
            triggerLineEvent: true,
            clip: false,
            sampling: 'lttb',
            z: 20,
            lineStyle: {
              width: item.type === 'tag' ? 16 : 12,
              color: item.color,
              opacity: 0,
            },
            emphasis: {
              disabled: true,
            },
            endLabel: {
              show: false,
            },
          },
        ];
      }),
    };
  }, [series, title]);

  useEffect(() => {
    if (!nodeRef.current) {
      return;
    }
    chartRef.current = echarts.init(nodeRef.current);
    const resize = () => {
      chartRef.current?.resize();
      window.requestAnimationFrame(() => syncEndLabelsRef.current());
    };
    window.addEventListener('resize', resize);
    const observer = new ResizeObserver(resize);
    observer.observe(nodeRef.current);
    const chart = chartRef.current;
    const zr = chart.getZr();
    let frame = 0;
    let latestEvent: { offsetX?: number; offsetY?: number } | null = null;

    const clearHover = () => {
      updateChartHighlight(chart, highlightedSeriesIdRef, null);
      setHoverInfo(null);
    };

    const syncAfterChartChange = () => {
      window.requestAnimationFrame(() => syncEndLabelsRef.current());
    };

    const handleMove = (event: { offsetX?: number; offsetY?: number }) => {
      latestEvent = event;
      if (frame) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (!latestEvent || typeof latestEvent.offsetX !== 'number' || typeof latestEvent.offsetY !== 'number') {
          clearHover();
          return;
        }
        const next = findNearestHover(chart, latestSeriesRef.current, latestEvent.offsetX, latestEvent.offsetY);
        updateChartHighlight(chart, highlightedSeriesIdRef, next?.series.id ?? null);
        setHoverInfo(next);
      });
    };

    zr.on('mousemove', handleMove);
    zr.on('globalout', clearHover);
    chart.on('dataZoom', syncAfterChartChange);
    chart.on('restore', syncAfterChartChange);
    chart.on('finished', syncAfterChartChange);

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      zr.off('mousemove', handleMove);
      zr.off('globalout', clearHover);
      chart.off('dataZoom', syncAfterChartChange);
      chart.off('restore', syncAfterChartChange);
      chart.off('finished', syncAfterChartChange);
      observer.disconnect();
      window.removeEventListener('resize', resize);
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    latestSeriesRef.current = series;
    highlightedSeriesIdRef.current = null;
    setHoverInfo(null);
    window.requestAnimationFrame(() => syncEndLabelsRef.current());
  }, [series]);

  useEffect(() => {
    chartRef.current?.setOption(option, true);
    window.requestAnimationFrame(() => syncEndLabelsRef.current());
  }, [option]);

  syncEndLabelsRef.current = () => {
    const chart = chartRef.current;
    const currentSeries = latestSeriesRef.current;
    if (!chart || currentSeries.length > 12) {
      setEndLabels([]);
      return;
    }
    setEndLabels(buildEndLabels(chart, currentSeries));
  };

  useEffect(() => {
    if (loading) {
      chartRef.current?.showLoading('default', {
        text: '加载行情中',
        color: '#93c5fd',
        textColor: '#ffffff',
        maskColor: 'rgba(5, 5, 5, 0.65)',
      });
    } else {
      chartRef.current?.hideLoading();
    }
  }, [loading]);

  useEffect(() => {
    const syncActionPosition = () => {
      const shell = shellRef.current;
      if (!shell) {
        return;
      }
      const rect = shell.getBoundingClientRect();
      const minLeft = 17;
      const maxLeft = Math.max(minLeft, rect.width - 51);
      const viewportLeft = window.innerWidth - rect.left - 51;
      shell.style.setProperty('--chart-action-left', `${clamp(viewportLeft, minLeft, maxLeft)}px`);
    };

    syncActionPosition();
    const observer = new ResizeObserver(syncActionPosition);
    if (shellRef.current) {
      observer.observe(shellRef.current);
    }
    window.addEventListener('resize', syncActionPosition);
    window.addEventListener('scroll', syncActionPosition, true);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncActionPosition);
      window.removeEventListener('scroll', syncActionPosition, true);
    };
  }, []);

  const showEndLabelHover = (item: EndLabelInfo) => {
    updateChartHighlight(chartRef.current, highlightedSeriesIdRef, item.series.id);
    setHoverInfo({
      series: item.series,
      date: item.date,
      value: item.value,
    });
  };

  const clearEndLabelHover = () => {
    updateChartHighlight(chartRef.current, highlightedSeriesIdRef, null);
    setHoverInfo(null);
  };

  const exportCurrentChart = () => {
    const chart = chartRef.current;
    if (!chart || !onExportImage) {
      return;
    }
    const labels = latestSeriesRef.current.length <= 12 ? buildEndLabels(chart, latestSeriesRef.current) : [];
    onExportImage({
      dataUrl: chart.getDataURL({
        type: 'png',
        pixelRatio: 2,
        backgroundColor: '#050505',
        excludeComponents: ['toolbox'],
      }),
      width: chart.getWidth(),
      height: chart.getHeight(),
      endLabels: labels.map((item) => ({
        label: item.label,
        color: item.color,
        left: item.left,
        top: item.top,
        width: item.width,
      })),
    });
  };

  return (
    <div className="chart-shell" ref={shellRef}>
      <div className="chart-root" ref={nodeRef} />
      <button
        className="chart-download-button"
        type="button"
        onClick={exportCurrentChart}
        title="下载图表和涨幅表"
        aria-label="下载图表和涨幅表"
      >
        <Download size={22} strokeWidth={1.8} />
      </button>
      <div className="end-label-layer">
        {endLabels.map((item) => (
          <button
            key={item.id}
            className={`end-line-label ${hoverInfo?.series.id === item.series.id ? 'active' : ''}`}
            style={{ color: item.color, left: item.left, top: item.top, maxWidth: item.width }}
            type="button"
            onClick={() => showEndLabelHover(item)}
            onMouseEnter={() => showEndLabelHover(item)}
            onMouseMove={() => showEndLabelHover(item)}
            onMouseOver={() => showEndLabelHover(item)}
            onMouseLeave={clearEndLabelHover}
            onPointerEnter={() => showEndLabelHover(item)}
            onPointerMove={() => showEndLabelHover(item)}
            onPointerLeave={clearEndLabelHover}
            title={`${item.label}：${item.value.toFixed(2)}%`}
          >
            <span>{item.label}</span>
          </button>
        ))}
      </div>
      {hoverInfo && <HoverInspector info={hoverInfo} />}
    </div>
  );
}

function formatMarket(market: PerformanceSeries['market']): string {
  const labels: Record<PerformanceSeries['market'], string> = {
    CN_A: 'A股',
    US: '美股',
    HK: '港股',
    KR_KOSPI: '韩股',
    KR_KOSDAQ: '韩股',
    CUSTOM: '自定义',
    TAG: '标签',
  };
  return labels[market] ?? String(market);
}

function HoverInspector({ info }: { info: HoverInfo }) {
  const meta = info.series;
  const isTag = meta.type === 'tag';
  const members = meta.members ?? [];
  const tags = meta.tagNames ?? [];
  const memberReturns = isTag
    ? members
        .map((member) => ({
          ...member,
          value: getSeriesValueAtDate(member.data, info.date),
        }))
        .sort((a, b) => {
          if (a.value === null && b.value === null) {
            return a.name.localeCompare(b.name, 'zh-Hans-CN');
          }
          if (a.value === null) {
            return 1;
          }
          if (b.value === null) {
            return -1;
          }
          return b.value - a.value;
        })
    : [];

  return (
    <aside className={`hover-inspector ${isTag && members.length > 8 ? 'dense' : ''}`} style={{ borderColor: meta.color }}>
      <header>
        <span className="hover-dot" style={{ backgroundColor: meta.color, boxShadow: `0 0 16px ${meta.color}` }} />
        <div>
          <strong>{meta.label}</strong>
          <small>
            {isTag ? `标签 · ${meta.memberCount ?? members.length} 只` : `${formatMarket(meta.market)} · ${meta.code}`} ·{' '}
            {info.date}
          </small>
        </div>
      </header>
      <div className="hover-value-label">{isTag ? '标签该日区间涨幅' : '个股该日区间涨幅'}</div>
      <div className="hover-value" style={{ color: meta.color }}>
        {formatReturnPercent(info.value)}
      </div>

      {isTag ? (
        <div className="hover-block">
          <div className="hover-block-title">
            <span>成员股票该日区间涨幅</span>
            <em>{memberReturns.length} 只</em>
          </div>
          <div className="hover-member-grid">
            {memberReturns.map((member) => (
              <span key={member.id} className="hover-member">
                <span className="hover-member-head">
                  <b>{member.name}</b>
                  <span className={`hover-member-return ${getReturnTone(member.value)}`}>
                    {formatReturnPercent(member.value)}
                  </span>
                </span>
                <em>
                  {formatMarket(member.market)} · {member.code}
                </em>
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="hover-block">
          <div className="hover-block-title">
            <span>所属标签</span>
          </div>
          <div className="hover-tag-list">
            {tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

function getSeriesValueAtDate(points: PerformancePoint[] | undefined, date: string): number | null {
  if (!points?.length || points[0].date > date) {
    return null;
  }

  let left = 0;
  let right = points.length - 1;
  while (left <= right) {
    const middle = Math.floor((left + right) / 2);
    if (points[middle].date <= date) {
      left = middle + 1;
    } else {
      right = middle - 1;
    }
  }

  return points[right]?.value ?? null;
}

function formatReturnPercent(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '暂无';
  }
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function getReturnTone(value: number | null): string {
  if (value === null) {
    return 'empty';
  }
  if (value > 0) {
    return 'positive';
  }
  if (value < 0) {
    return 'negative';
  }
  return 'neutral';
}

function updateChartHighlight(
  chart: echarts.ECharts | null,
  highlightedSeriesIdRef: { current: string | null },
  nextId: string | null,
): void {
  if (!chart || highlightedSeriesIdRef.current === nextId) {
    return;
  }
  if (highlightedSeriesIdRef.current) {
    chart.dispatchAction({
      type: 'downplay',
      seriesId: `${highlightedSeriesIdRef.current}-line`,
    });
  }
  if (nextId) {
    chart.dispatchAction({
      type: 'highlight',
      seriesId: `${nextId}-line`,
    });
  }
  highlightedSeriesIdRef.current = nextId;
}

function buildEndLabels(chart: echarts.ECharts, seriesList: PerformanceSeries[]): EndLabelInfo[] {
  const chartWidth = chart.getWidth();
  const chartHeight = chart.getHeight();
  const layout = getEndLabelLayout(seriesList);
  const labels = seriesList
    .map((item) => {
      const point = item.data[item.data.length - 1];
      if (!point) {
        return null;
      }
      const pixel = chart.convertToPixel({ gridIndex: 0 }, [dateToTime(point.date), point.value]);
      if (!Array.isArray(pixel) || pixel.length < 2) {
        return null;
      }
      const top = clamp(Number(pixel[1]), 104, chartHeight - 90);
      const width = estimateEndLabelWidth(item.label);
      const maxLeft = chartWidth - width - 18;
      const left = clamp(Number(pixel[0]) + 6, 88, maxLeft);
      return {
        id: item.id,
        series: item,
        date: point.date,
        value: point.value,
        color: item.color,
        label: item.label,
        left,
        top,
        width: Math.min(width, layout.labelMaxWidth),
      };
    })
    .filter((item): item is EndLabelInfo => Boolean(item))
    .sort((a, b) => a.top - b.top);

  const rowGap = 22;
  for (let index = 1; index < labels.length; index += 1) {
    labels[index].top = Math.max(labels[index].top, labels[index - 1].top + rowGap);
  }

  const last = labels[labels.length - 1];
  if (last && last.top > chartHeight - 58) {
    const shift = last.top - (chartHeight - 58);
    labels.forEach((item) => {
      item.top = Math.max(104, item.top - shift);
    });
  }

  return labels;
}

function getEndLabelLayout(seriesList: PerformanceSeries[]) {
  if (!seriesList.length) {
    return {
      gridRight: 44,
      labelMaxWidth: 0,
    };
  }

  if (seriesList.length > 12) {
    return {
      gridRight: 34,
      labelMaxWidth: 0,
    };
  }

  const maxLabelWidth = Math.max(...seriesList.map((item) => estimateEndLabelWidth(item.label)));
  const labelMaxWidth = clamp(maxLabelWidth, 50, 112);
  return {
    gridRight: clamp(labelMaxWidth + 18, 64, 128),
    labelMaxWidth,
  };
}

function estimateEndLabelWidth(label: string): number {
  const contentWidth = Array.from(label).reduce((sum, char) => {
    if (/[A-Za-z0-9]/.test(char)) {
      return sum + 7;
    }
    if (char === '/' || char === '-' || char === '·') {
      return sum + 5;
    }
    return sum + 12;
  }, 0);
  return clamp(contentWidth + 10, 46, 112);
}

function findNearestHover(
  chart: echarts.ECharts,
  seriesList: PerformanceSeries[],
  offsetX: number,
  offsetY: number,
): HoverInfo | null {
  if (!seriesList.length || !chart.containPixel({ gridIndex: 0 }, [offsetX, offsetY])) {
    return null;
  }

  const converted = chart.convertFromPixel({ gridIndex: 0 }, [offsetX, offsetY]);
  const targetTime = readConvertedTime(converted);
  if (targetTime === null) {
    return null;
  }

  let bestSeries: PerformanceSeries | null = null;
  let bestPoint: PerformancePoint | null = null;
  let bestDistance = Infinity;

  for (const item of seriesList) {
    if (!item.data.length) {
      continue;
    }
    const nearestIndex = findNearestDataIndex(item.data, targetTime);
    for (const index of getNearbyIndexes(nearestIndex, item.data.length, seriesList.length)) {
      const point = item.data[index];
      if (!point) {
        continue;
      }
      const pixel = chart.convertToPixel({ gridIndex: 0 }, [dateToTime(point.date), point.value]);
      if (!Array.isArray(pixel) || pixel.length < 2) {
        continue;
      }
      const dx = Number(pixel[0]) - offsetX;
      const dy = Number(pixel[1]) - offsetY;
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance) {
        bestSeries = item;
        bestPoint = point;
        bestDistance = distance;
      }
    }
  }

  if (!bestSeries || !bestPoint || bestDistance > getHoverDistanceLimit(seriesList.length)) {
    return null;
  }

  return {
    series: bestSeries,
    date: bestPoint.date,
    value: bestPoint.value,
  };
}

function readConvertedTime(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function findNearestDataIndex(points: PerformancePoint[], targetTime: number): number {
  let left = 0;
  let right = points.length - 1;

  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (dateToTime(points[middle].date) < targetTime) {
      left = middle + 1;
    } else {
      right = middle;
    }
  }

  if (left > 0) {
    const currentDistance = Math.abs(dateToTime(points[left].date) - targetTime);
    const previousDistance = Math.abs(dateToTime(points[left - 1].date) - targetTime);
    return previousDistance < currentDistance ? left - 1 : left;
  }

  return left;
}

function getNearbyIndexes(center: number, length: number, seriesCount: number): number[] {
  const radius = seriesCount > 24 ? 4 : seriesCount > 12 ? 3 : 2;
  const indexes: number[] = [];
  for (let index = center - radius; index <= center + radius; index += 1) {
    if (index >= 0 && index < length) {
      indexes.push(index);
    }
  }
  return indexes;
}

function dateToTime(date: string): number {
  return Date.parse(`${date}T00:00:00`);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getHoverDistanceLimit(seriesCount: number): number {
  if (seriesCount > 24) {
    return 70;
  }
  if (seriesCount > 12) {
    return 56;
  }
  return 32;
}
