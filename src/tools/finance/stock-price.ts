import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { api } from './api.js';
import { formatJpDate, formatJpyAmount } from './formatters.js';
import { canonicalizeCompanyKey, normalizeCode, resolveJpTicker, resolveJpTickerFull } from './ticker.js';
import { TTL_15M } from './utils.js';

type DailyQuote = {
  Date: string;
  Code: string;
  O: number;
  H: number;
  L: number;
  C: number;
  Vo: number;
  Va: number;
  AdjFactor?: number;
  AdjC?: number;
};

type PriceResponse = { data: DailyQuote[] };

const DEFAULT_LOOKBACK_DAYS = 30;

export const STOCK_PRICE_DESCRIPTION = `
日本株の株価データを取得する。会社名または証券コードから、直近の終値、日足の推移、出来高や売買代金を確認できる。
`.trim();

function tokyoDateString(date: Date): string {
  return date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

function getTodayInTokyo(): string {
  return tokyoDateString(new Date());
}

function getDateDaysAgoInTokyo(days: number): string {
  return tokyoDateString(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
}

function formatNumber(value: number | undefined): string {
  return Number.isFinite(value) ? Number(value).toLocaleString('ja-JP') : '—';
}

function sortQuotes(quotes: DailyQuote[]): DailyQuote[] {
  return [...quotes].sort((a, b) => a.Date.localeCompare(b.Date));
}

function renderPriceTable(code: string, quotes: DailyQuote[]): string {
  const sorted = sortQuotes(quotes);
  const latest = sorted[sorted.length - 1];
  const rows = sorted
    .slice(-15)
    .map(
      (quote) =>
        `| ${formatJpDate(quote.Date)} | ${formatNumber(quote.O)} | ${formatNumber(quote.H)} | ${formatNumber(quote.L)} | **${formatNumber(quote.C)}** | ${formatJpyAmount(quote.Va)} |`,
    )
    .join('\n');

  return `## ${normalizeCode(code)} 株価
最新終値: **${formatNumber(latest.C)}円** (${formatJpDate(latest.Date)})
修正終値: ${formatNumber(latest.AdjC ?? latest.C)}円
出来高: ${formatNumber(latest.Vo)}株

| 日付 | 始値 | 高値 | 安値 | 終値 | 売買代金 |
|------|------|------|------|------|---------|
${rows}`;
}

function renderHistoricalTable(code: string, quotes: DailyQuote[]): string {
  const sorted = sortQuotes(quotes);
  const rows = sorted
    .map(
      (quote) =>
        `| ${formatJpDate(quote.Date)} | ${formatNumber(quote.O)} | ${formatNumber(quote.H)} | ${formatNumber(quote.L)} | ${formatNumber(quote.C)} | ${formatNumber(quote.Vo)} |`,
    )
    .join('\n');

  return `## ${normalizeCode(code)} 株価推移

| 日付 | 始値 | 高値 | 安値 | 終値 | 出来高 |
|------|------|------|------|------|--------|
${rows}`;
}

async function fetchDailyBars(
  code: string,
  startDate: string,
  endDate: string,
): Promise<{ quotes: DailyQuote[]; url: string }> {
  const { data, url } = await api.get<PriceResponse>(
    '/equities/bars/daily',
    {
      code,
      from: startDate,
      to: endDate,
    },
    {
      cacheable: true,
      ttlMs: TTL_15M,
      arrayKey: 'data',
    },
  );

  return {
    quotes: data.data ?? [],
    url,
  };
}

const StockPriceInputSchema = z.object({
  code: z.string().describe('証券コード（例: 7203）または会社名（例: トヨタ、ソニー）'),
  start_date: z.string().optional().describe('取得開始日 YYYY-MM-DD（省略時は過去30日）'),
  end_date: z.string().optional().describe('取得終了日 YYYY-MM-DD（省略時は本日）'),
});

export const getStockPrice = new DynamicStructuredTool({
  name: 'get_stock_price',
  description:
    '日本株の株価（始値・高値・安値・終値・出来高・売買代金）を取得する。証券コードまたは会社名で指定できる。',
  schema: StockPriceInputSchema,
  func: async (input) => {
    const code = await resolveJpTickerFull(input.code);
    if (!code) {
      return formatToolResult(
        `証券コードを解決できません: "${input.code}"。4桁の証券コード（例: 7203）または主要企業名で指定してください。`,
      );
    }

    const endDate = input.end_date ?? getTodayInTokyo();
    const startDate = input.start_date ?? getDateDaysAgoInTokyo(DEFAULT_LOOKBACK_DAYS);
    const { quotes, url } = await fetchDailyBars(code, startDate, endDate);

    if (quotes.length === 0) {
      return formatToolResult(`${normalizeCode(code)} の株価データが見つかりません。`, [url]);
    }

    return formatToolResult(renderPriceTable(code, quotes), [url]);
  },
});

const StockPricesInputSchema = z.object({
  code: z.string().describe('証券コード（例: 7203）または会社名（例: トヨタ、ソニー）'),
  start_date: z.string().describe('取得開始日 YYYY-MM-DD'),
  end_date: z.string().describe('取得終了日 YYYY-MM-DD'),
});

export const getStockPrices = new DynamicStructuredTool({
  name: 'get_stock_prices',
  description:
    '日本株の過去の日足データを取得する。証券コードまたは会社名と日付範囲を指定する。',
  schema: StockPricesInputSchema,
  func: async (input) => {
    const code = await resolveJpTickerFull(input.code);
    if (!code) {
      return formatToolResult(
        `証券コードを解決できません: "${input.code}"。4桁の証券コード（例: 7203）または主要企業名で指定してください。`,
      );
    }

    const { quotes, url } = await fetchDailyBars(code, input.start_date, input.end_date);
    if (quotes.length === 0) {
      return formatToolResult(`${normalizeCode(code)} の株価データが見つかりません。`, [url]);
    }

    return formatToolResult(renderHistoricalTable(code, quotes), [url]);
  },
});

export const getStockTickers = new DynamicStructuredTool({
  name: 'get_stock_tickers',
  description: '主要な上場企業の証券コードを検索する。listed-issues 実装前の暫定版。',
  schema: z.object({
    query: z.string().describe('会社名またはキーワード（例: トヨタ、銀行、自動車）'),
  }),
  func: async (input) => {
    const resolved = resolveJpTicker(input.query);
    if (resolved) {
      return formatToolResult(`${input.query} → 証券コード: ${normalizeCode(resolved)}`);
    }

    const normalizedQuery = canonicalizeCompanyKey(input.query);
    const partialMatches = ['トヨタ', 'ソニー', '三菱UFJ', 'キーエンス', '任天堂']
      .filter((name) => canonicalizeCompanyKey(name).includes(normalizedQuery))
      .slice(0, 5)
      .map((name) => `${name} → ${resolveJpTicker(name)}`);

    if (partialMatches.length > 0) {
      return formatToolResult(
        `静的マップの候補:\n${partialMatches.map((line) => `- ${line}`).join('\n')}`,
      );
    }

    return formatToolResult(
      `"${input.query}" に対応する銘柄コードが静的マップに見つかりません。listed-issues 実装後に上場銘柄マスター検索へ切り替えます。`,
      [],
    );
  },
});
