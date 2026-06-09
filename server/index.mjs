import http from 'node:http';
import { execFile } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createStateStore } from './state-store.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(rootDir, 'dist');
const execFileAsync = promisify(execFile);
const stateStore = createStateStore(rootDir);
const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? '0.0.0.0';
const yahooBases = [
  'https://query1.finance.yahoo.com',
  'https://query2.finance.yahoo.com',
];
const cacheTtlMs = Number(process.env.MARKET_CACHE_TTL_MS ?? 1000 * 60 * 60 * 12);
const requestConcurrency = Number(process.env.MARKET_REQUEST_CONCURRENCY ?? 5);
const requestGapMs = Number(process.env.MARKET_REQUEST_GAP_MS ?? 150);
const requestTimeoutMs = Number(process.env.MARKET_REQUEST_TIMEOUT_MS ?? 18000);
const batchDeadlineMs = Number(process.env.MARKET_BATCH_DEADLINE_MS ?? 8500);
const allowedMarkets = new Set(['CN_A', 'US', 'HK', 'KR_KOSPI', 'KR_KOSDAQ', 'CUSTOM']);
const allowedIntervals = new Set(['1d', '1wk', '1mo']);
const priceCache = new Map();

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      sendNoContent(response);
      return;
    }

    if (url.pathname === '/api/health') {
      sendJson(response, 200, {
        ok: true,
        service: 'ai-trading-view',
        cacheSize: priceCache.size,
      });
      return;
    }

    if (url.pathname === '/api/workspaces') {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: '仅支持 POST' });
        return;
      }
      await handleCreateWorkspace(request, response);
      return;
    }

    if (url.pathname === '/api/workspaces/join') {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: '仅支持 POST' });
        return;
      }
      await handleJoinWorkspace(request, response);
      return;
    }

    const workspaceStateMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/state$/);
    if (workspaceStateMatch) {
      if (request.method === 'GET') {
        handleGetWorkspaceState(request, response, workspaceStateMatch[1]);
        return;
      }
      if (request.method === 'PUT') {
        await handleSaveWorkspaceState(request, response, workspaceStateMatch[1]);
        return;
      }
      sendJson(response, 405, { error: '仅支持 GET / PUT' });
      return;
    }

    const workspaceResetMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/reset$/);
    if (workspaceResetMatch) {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: '仅支持 POST' });
        return;
      }
      handleResetWorkspaceState(request, response, workspaceResetMatch[1]);
      return;
    }

    const workspaceRotateMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/rotate-code$/);
    if (workspaceRotateMatch) {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: '仅支持 POST' });
        return;
      }
      await handleRotateWorkspaceCode(request, response, workspaceRotateMatch[1]);
      return;
    }

    if (url.pathname === '/api/prices/batch') {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: '仅支持 POST' });
        return;
      }
      await handleBatchPrices(request, response);
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      sendJson(response, 404, { error: '接口不存在' });
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { error: '仅支持 GET' });
      return;
    }
    await serveStaticFile(request, response, url.pathname);
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : Number(error?.statusCode ?? 500);
    sendJson(response, statusCode, {
      error: error instanceof Error ? error.message : '服务器错误',
    });
  }
});

server.listen(port, host, () => {
  console.log(`AI Trading View server listening on http://${host}:${port}`);
});

async function handleCreateWorkspace(request, response) {
  const body = await readJsonBody(request);
  const state = body.state ? validateAppState(body.state) : null;
  sendJson(response, 200, stateStore.createWorkspace(body.name, state));
}

async function handleJoinWorkspace(request, response) {
  const body = await readJsonBody(request);
  const joined = stateStore.joinWorkspace(body.code);
  if (!joined) {
    sendJson(response, 404, { error: '工作区代码无效' });
    return;
  }
  sendJson(response, 200, joined);
}

function handleGetWorkspaceState(request, response, workspaceId) {
  sendJson(response, 200, stateStore.getWorkspaceState(workspaceId, readWorkspaceCode(request)));
}

async function handleSaveWorkspaceState(request, response, workspaceId) {
  const body = await readJsonBody(request);
  const state = validateAppState(body.state);
  sendJson(
    response,
    200,
    stateStore.saveWorkspaceState(workspaceId, readWorkspaceCode(request), state, body.version),
  );
}

function handleResetWorkspaceState(request, response, workspaceId) {
  sendJson(response, 200, stateStore.resetWorkspaceState(workspaceId, readWorkspaceCode(request)));
}

async function handleRotateWorkspaceCode(request, response, workspaceId) {
  const body = await readJsonBody(request);
  sendJson(
    response,
    200,
    stateStore.rotateWorkspaceCode(workspaceId, readWorkspaceCode(request), body.role),
  );
}

async function handleBatchPrices(request, response) {
  const body = await readJsonBody(request);
  const interval = validateInterval(body.interval);
  const { startDate, endDate, period1, period2 } = parseDateRange(body.startDate, body.endDate);
  const refresh = Boolean(body.refresh);
  const symbols = validateSymbols(body.symbols);
  const deadlineAt = Date.now() + batchDeadlineMs;

  const loaded = await mapWithConcurrency(symbols, requestConcurrency, async (symbol) => {
    return fetchYahooSeries(symbol, interval, startDate, endDate, period1, period2, refresh, deadlineAt);
  });

  const items = [];
  const warnings = [];
  loaded.forEach((result, index) => {
    const symbol = symbols[index];
    if (result.ok) {
      items.push(result.value);
    } else {
      warnings.push({
        id: symbol.id,
        market: symbol.market,
        code: symbol.code,
        name: symbol.name,
        providerSymbol: toYahooSymbol(symbol.market, symbol.code),
        message: result.error.message,
      });
    }
  });

  sendJson(response, 200, {
    items,
    warnings,
    generatedAt: new Date().toISOString(),
  });
}

function readWorkspaceCode(request) {
  const value = request.headers['x-workspace-code'];
  const code = Array.isArray(value) ? value[0] : value;
  if (!code) {
    throw new HttpError(401, '缺少工作区代码');
  }
  return code;
}

function validateAppState(state) {
  if (!state || typeof state !== 'object') {
    throw new HttpError(400, 'state 必须是对象');
  }
  if (!Array.isArray(state.tags)) {
    throw new HttpError(400, 'state.tags 必须是数组');
  }
  if (!Array.isArray(state.symbols)) {
    throw new HttpError(400, 'state.symbols 必须是数组');
  }
  if (!Array.isArray(state.selectedSymbolIds)) {
    throw new HttpError(400, 'state.selectedSymbolIds 必须是数组');
  }
  if (!Array.isArray(state.selectedTagIds)) {
    throw new HttpError(400, 'state.selectedTagIds 必须是数组');
  }
  if (typeof state.mode !== 'string' || typeof state.interval !== 'string') {
    throw new HttpError(400, 'state.mode / state.interval 无效');
  }
  if (typeof state.startDate !== 'string' || typeof state.endDate !== 'string') {
    throw new HttpError(400, 'state.startDate / state.endDate 无效');
  }
  return state;
}

async function fetchYahooSeries(symbol, interval, startDate, endDate, period1, period2, refresh, deadlineAt = Infinity) {
  const providerSymbol = toYahooSymbol(symbol.market, symbol.code);
  const cacheKey = `${providerSymbol}|${interval}|${startDate}|${endDate}`;
  const cached = priceCache.get(cacheKey);
  if (!refresh && cached && Date.now() - cached.savedAt < cacheTtlMs) {
    return {
      id: symbol.id,
      market: symbol.market,
      code: symbol.code,
      name: symbol.name,
      providerSymbol,
      prices: cached.data,
      cached: true,
    };
  }

  const params = new URLSearchParams({
    period1: String(period1),
    period2: String(period2),
    interval,
    events: 'history',
    includeAdjustedClose: 'true',
  });

  const payload = await fetchYahooJson(providerSymbol, params, deadlineAt);
  const chartError = payload?.chart?.error;
  if (chartError) {
    throw new Error(chartError.description ?? '暂无行情');
  }

  const result = payload?.chart?.result?.[0];
  if (!result) {
    throw new Error('暂无行情');
  }

  const prices = normalizeYahooPrices(result);
  if (!prices.length) {
    throw new Error('暂无有效行情');
  }

  priceCache.set(cacheKey, {
    savedAt: Date.now(),
    data: prices,
  });

  return {
    id: symbol.id,
    market: symbol.market,
    code: symbol.code,
    name: symbol.name,
    providerSymbol,
    prices,
    cached: false,
  };
}

async function fetchYahooJson(providerSymbol, params, deadlineAt = Infinity) {
  const errors = [];
  for (const base of yahooBases) {
    const url = `${base}/v8/finance/chart/${encodeURIComponent(providerSymbol)}?${params}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const remainingMs = getRemainingMs(deadlineAt);
        if (remainingMs < 1200) {
          throw new Error('本批次接近超时，稍后会继续请求');
        }
        const response = await requestYahooUrl(url, Math.min(requestTimeoutMs, Math.max(1000, remainingMs - 700)));
        if (response.statusCode < 200 || response.statusCode >= 300) {
          errors.push(`${new URL(base).hostname}:${response.statusCode}`);
          if (response.statusCode === 429) {
            await sleepWithinDeadline(2500 + attempt * 4500, deadlineAt);
            continue;
          }
          break;
        }
        return JSON.parse(response.body);
      } catch (error) {
        errors.push(`${new URL(base).hostname}:${error instanceof Error ? error.message : '请求失败'}`);
        await sleepWithinDeadline(700 + attempt * 1200, deadlineAt);
      }
    }
  }

  throw new Error(formatYahooError(errors));
}

function formatYahooError(errors) {
  if (!errors.length) {
    return 'Yahoo行情请求失败：网络不可用';
  }
  const hasForbidden = errors.some((error) => error.endsWith(':403'));
  const hasRateLimit = errors.some((error) => error.endsWith(':429'));
  if (hasForbidden && hasRateLimit) {
    return 'Yahoo返回403/429：当前 Node 出口被 Yahoo 拒绝或限流，请确认全局/TUN代理覆盖 Node 进程，或切换代理/服务器出口后再刷新';
  }
  if (errors.every((error) => error.endsWith(':403'))) {
    return 'Yahoo返回403：当前 Node 出口被 Yahoo 拒绝，请确认全局/TUN代理覆盖 Node 进程，或换一个可访问 Yahoo Finance 的服务器网络';
  }
  if (errors.every((error) => error.endsWith(':429'))) {
    return 'Yahoo返回429：当前出口请求过于频繁或被限流，请稍后刷新，或切换代理/服务器出口';
  }
  return `Yahoo行情请求失败：${errors[errors.length - 1]}`;
}

async function requestYahooUrl(url, timeoutMs) {
  try {
    const marker = '\n__AI_TRADING_VIEW_HTTP_STATUS__:';
    const { stdout } = await execFileAsync('curl', [
      '-sS',
      '--compressed',
      '--max-time',
      String(Math.ceil(timeoutMs / 1000)),
      '-A',
      'Mozilla/5.0',
      '-H',
      'Referer: https://finance.yahoo.com/',
      '-H',
      'Accept: application/json,text/plain,*/*',
      '-w',
      `${marker}%{http_code}`,
      url,
    ], {
      timeout: timeoutMs + 3000,
      maxBuffer: 20 * 1024 * 1024,
    });
    const markerIndex = stdout.lastIndexOf(marker);
    if (markerIndex === -1) {
      throw new Error('curl 未返回 HTTP 状态');
    }
    return {
      statusCode: Number(stdout.slice(markerIndex + marker.length).trim()),
      body: stdout.slice(0, markerIndex),
    };
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'curl 请求失败');
  }
}

function normalizeYahooPrices(result) {
  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const closes = quote.close ?? [];
  const volumes = quote.volume ?? [];
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose ?? [];
  const byDate = new Map();

  timestamps.forEach((timestamp, index) => {
    const close = adjusted[index] && adjusted[index] > 0 ? adjusted[index] : closes[index];
    if (!close || close <= 0) {
      return;
    }
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    byDate.set(date, {
      date,
      close,
      rawClose: closes[index] ?? null,
      volume: volumes[index] ?? null,
    });
  });

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function toYahooSymbol(market, code) {
  const clean = String(code ?? '').trim().toUpperCase();
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

function validateInterval(interval) {
  if (!allowedIntervals.has(interval)) {
    throw new HttpError(400, '周期只支持 1d、1wk、1mo');
  }
  return interval;
}

function parseDateRange(startDate, endDate) {
  const start = parseDate(startDate, '开始日期');
  const end = parseDate(endDate, '结束日期');
  if (start > end) {
    throw new HttpError(400, '开始日期不能晚于结束日期');
  }
  const periodEnd = new Date(end);
  periodEnd.setUTCDate(periodEnd.getUTCDate() + 1);
  return {
    startDate,
    endDate,
    period1: Math.floor(start.getTime() / 1000),
    period2: Math.floor(periodEnd.getTime() / 1000),
  };
}

function parseDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, `${label}格式应为 YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${label}无效`);
  }
  return date;
}

function validateSymbols(symbols) {
  if (!Array.isArray(symbols)) {
    throw new HttpError(400, 'symbols 必须是数组');
  }
  if (symbols.length > 160) {
    throw new HttpError(400, '单次最多请求 160 只股票');
  }

  return symbols.map((symbol, index) => {
    const id = String(symbol?.id ?? '').trim();
    const market = String(symbol?.market ?? '').trim();
    const code = String(symbol?.code ?? '').trim().toUpperCase();
    const name = String(symbol?.name ?? code).trim();

    if (!id) {
      throw new HttpError(400, `第 ${index + 1} 只股票缺少 id`);
    }
    if (!allowedMarkets.has(market)) {
      throw new HttpError(400, `${name || id} 的市场无效`);
    }
    if (!/^[A-Z0-9._^=-]{1,32}$/.test(code)) {
      throw new HttpError(400, `${name || id} 的代码格式无效`);
    }

    return { id, market, code, name };
  });
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = [];
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { ok: true, value: await mapper(items[index], index) };
      } catch (error) {
        results[index] = {
          ok: false,
          error: error instanceof Error ? error : new Error('行情请求失败'),
        };
      }
      if (cursor < items.length && requestGapMs > 0) {
        await sleep(requestGapMs + Math.floor(Math.random() * 150));
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      throw new HttpError(413, '请求体过大');
    }
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON 格式无效');
  }
}

async function serveStaticFile(request, response, pathname) {
  if (!existsSync(path.join(distDir, 'index.html'))) {
    sendJson(response, 503, { error: '请先运行 npm run build 生成 dist' });
    return;
  }

  const decoded = decodeURIComponent(pathname);
  const requestedPath = decoded === '/' ? '/index.html' : decoded;
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(distDir, safePath);

  if (!filePath.startsWith(distDir)) {
    sendJson(response, 403, { error: '路径无效' });
    return;
  }

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = path.join(distDir, 'index.html');
  }

  const contentType = getContentType(path.extname(filePath));
  response.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  createReadStream(filePath).pipe(response);
}

function getContentType(extension) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
  };
  return types[extension] ?? 'application/octet-stream';
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

function sendNoContent(response) {
  response.writeHead(204);
  response.end();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRemainingMs(deadlineAt) {
  if (!Number.isFinite(deadlineAt)) {
    return requestTimeoutMs;
  }
  return Math.max(0, deadlineAt - Date.now());
}

async function sleepWithinDeadline(ms, deadlineAt) {
  const remainingMs = getRemainingMs(deadlineAt);
  const safeDelay = Math.min(ms, Math.max(0, remainingMs - 400));
  if (safeDelay > 0) {
    await sleep(safeDelay);
  }
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}
