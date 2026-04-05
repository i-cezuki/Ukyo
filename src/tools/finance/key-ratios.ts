import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { api } from './api.js';
import { formatJpDate, formatJpyAmount } from './formatters.js';
import { normalizeCode, resolveJpTickerFull } from './ticker.js';
import { isAnnualPeriodType, normalizeAsciiUpper, TTL_15M, TTL_24H } from './utils.js';

type DailyQuote = {
  Date?: string;
  Code?: string;
  C?: number;
  AdjC?: number;
};

type PriceResponse = {
  data?: DailyQuote[];
};

type FinSummaryRecord = {
  DiscDate?: string;
  DiscTime?: string;
  Code?: string;
  DocType?: string;
  CurPerType?: string;
  CurPerSt?: string;
  CurPerEn?: string;
  Sales?: string | number;
  OP?: string | number;
  OdP?: string | number;
  NP?: string | number;
  EPS?: string | number;
  TA?: string | number;
  Eq?: string | number;
  EqAR?: string | number;
  BPS?: string | number;
  CFO?: string | number;
  DivAnn?: string | number;
};

type FinSummaryResponse = {
  data?: FinSummaryRecord[];
};

const KeyRatiosInputSchema = z
  .object({
    code: z
      .string()
      .optional()
      .describe('証券コード（例: 7203）または会社名（例: トヨタ、ソニー）'),
    ticker: z
      .string()
      .optional()
      .describe('互換用の別名引数。証券コードまたは会社名を指定できる。'),
  })
  .refine((input) => Boolean(input.code ?? input.ticker), {
    message: 'code または ticker を指定してください。',
    path: ['code'],
  });

const HistoricalKeyRatiosInputSchema = z
  .object({
    code: z
      .string()
      .optional()
      .describe('証券コード（例: 7203）または会社名（例: トヨタ、ソニー）'),
    ticker: z
      .string()
      .optional()
      .describe('互換用の別名引数。証券コードまたは会社名を指定できる。'),
    period: z
      .enum(['annual', 'quarterly', 'ttm'])
      .default('quarterly')
      .describe('annual: 通期中心、quarterly: 四半期中心、ttm: 直近開示を混在で表示'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(12)
      .default(4)
      .describe('表示する決算期数（デフォルト4、最大12）'),
  })
  .refine((input) => Boolean(input.code ?? input.ticker), {
    message: 'code または ticker を指定してください。',
    path: ['code'],
  });

type KeyRatiosInput = z.infer<typeof KeyRatiosInputSchema>;
type HistoricalKeyRatiosInput = z.infer<typeof HistoricalKeyRatiosInputSchema>;

function getLookupValue(input: KeyRatiosInput | HistoricalKeyRatiosInput): string {
  return (input.code ?? input.ticker ?? '').trim();
}

function tokyoDateString(date: Date): string {
  return date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

function getTodayInTokyo(): string {
  return tokyoDateString(new Date());
}

function getDateDaysAgoInTokyo(days: number): string {
  return tokyoDateString(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).replace(/,/g, '').trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPercentValue(value: unknown): number | null {
  const numeric = toNumber(value);
  if (numeric === null) {
    return null;
  }

  return numeric >= 0 && numeric <= 1 ? numeric * 100 : numeric;
}

function formatMultiple(value: number | null, digits: number): string {
  return value === null ? 'N/A' : `${value.toFixed(digits)}倍`;
}

function formatPercent(value: number | null, digits: number): string {
  return value === null ? 'N/A' : `${value.toFixed(digits)}%`;
}

function formatPerShare(value: unknown): string {
  const numeric = toNumber(value);
  return numeric === null ? '—' : `${numeric.toFixed(2)}円`;
}

function formatDividendPerShare(value: unknown): string {
  const numeric = toNumber(value);
  return numeric === null || numeric <= 0 ? '—' : `${numeric}円/株`;
}

function formatPrice(value: number): string {
  return `${value.toLocaleString('ja-JP')}円`;
}

function sortByDisclosure(records: FinSummaryRecord[]): FinSummaryRecord[] {
  return [...records].sort((left, right) => {
    const leftKey = `${left.DiscDate ?? ''} ${left.DiscTime ?? ''}`;
    const rightKey = `${right.DiscDate ?? ''} ${right.DiscTime ?? ''}`;
    return rightKey.localeCompare(leftKey);
  });
}

function sortQuotes(quotes: DailyQuote[]): DailyQuote[] {
  return [...quotes].sort((left, right) => (left.Date ?? '').localeCompare(right.Date ?? ''));
}

function isAnnual(record: FinSummaryRecord): boolean {
  return isAnnualPeriodType(record.CurPerType);
}

function formatPeriodTypeLabel(periodType: string | undefined): string {
  const raw = (periodType ?? '').trim();
  if (!raw) {
    return '';
  }
  const asciiNormalized = normalizeAsciiUpper(raw);
  if (asciiNormalized === 'FY' || asciiNormalized === 'ANNUAL') return '通期';
  if (asciiNormalized === '1Q') return '1Q';
  if (asciiNormalized === '2Q') return '2Q';
  if (asciiNormalized === '3Q') return '3Q';
  return raw;
}

function hasKeyRatioInputs(record: FinSummaryRecord): boolean {
  return (
    toNumber(record.Sales) !== null ||
    toNumber(record.EPS) !== null ||
    toNumber(record.BPS) !== null ||
    toNumber(record.DivAnn) !== null
  );
}

function selectKeyRatioStatement(statements: FinSummaryRecord[]): FinSummaryRecord | undefined {
  return (
    statements.find((record) => isAnnual(record) && hasKeyRatioInputs(record)) ??
    statements.find(isAnnual) ??
    statements.find(hasKeyRatioInputs)
  );
}

function formatPeriod(record: FinSummaryRecord): string {
  const start = formatJpDate(record.CurPerSt);
  const end = formatJpDate(record.CurPerEn);
  if (start === '—' && end === '—') {
    return record.CurPerType?.trim() || '期間情報なし';
  }
  if (start === '—') return end;
  if (end === '—') return start;
  return `${start}〜${end}`;
}

function filterStatements(
  records: FinSummaryRecord[],
  period: HistoricalKeyRatiosInput['period'],
): FinSummaryRecord[] {
  if (period === 'annual') {
    return records.filter(isAnnual);
  }
  if (period === 'quarterly') {
    const quarterly = records.filter((record) => !isAnnual(record));
    return quarterly.length > 0 ? quarterly : records;
  }
  return records;
}

async function fetchLatestPrice(
  code: string,
): Promise<{ quote: DailyQuote | null; url: string }> {
  const { data, url } = await api.get<PriceResponse>(
    '/equities/bars/daily',
    {
      code,
      from: getDateDaysAgoInTokyo(14),
      to: getTodayInTokyo(),
    },
    {
      cacheable: true,
      ttlMs: TTL_15M,
      arrayKey: 'data',
    },
  );

  const sortedQuotes = sortQuotes(data.data ?? []);
  return {
    quote: sortedQuotes.length > 0 ? sortedQuotes[sortedQuotes.length - 1] : null,
    url,
  };
}

async function fetchFinancialSummaries(
  code: string,
): Promise<{ statements: FinSummaryRecord[]; url: string }> {
  const { data, url } = await api.get<FinSummaryResponse>(
    '/fins/summary',
    { code },
    {
      cacheable: true,
      ttlMs: TTL_24H,
      arrayKey: 'data',
    },
  );

  return {
    statements: sortByDisclosure(data.data ?? []),
    url,
  };
}

function renderKeyRatios(code: string, price: number, quote: DailyQuote, statement: FinSummaryRecord): string {
  const eps = toNumber(statement.EPS);
  const bps = toNumber(statement.BPS);
  const equity = toNumber(statement.Eq);
  const totalAssets = toNumber(statement.TA);
  const netIncome = toNumber(statement.NP);
  const sales = toNumber(statement.Sales);
  const operatingProfit = toNumber(statement.OP);
  const ordinaryProfit = toNumber(statement.OdP);
  const dividend = toNumber(statement.DivAnn);
  const equityRatio = toPercentValue(statement.EqAR);
  const cfo = toNumber(statement.CFO);

  const per = eps !== null && eps > 0 ? price / eps : null;
  const pbr = bps !== null && bps > 0 ? price / bps : null;
  const roe = equity !== null && equity > 0 && netIncome !== null ? (netIncome / equity) * 100 : null;
  const roa =
    totalAssets !== null && totalAssets > 0 && netIncome !== null
      ? (netIncome / totalAssets) * 100
      : null;
  const dividendYield =
    dividend !== null && dividend > 0 && price > 0 ? (dividend / price) * 100 : null;
  const payoutRatio =
    dividend !== null && dividend > 0 && eps !== null && eps > 0 ? (dividend / eps) * 100 : null;
  const operatingMargin =
    sales !== null && sales > 0 && operatingProfit !== null ? (operatingProfit / sales) * 100 : null;
  const ordinaryMargin =
    sales !== null && sales > 0 && ordinaryProfit !== null ? (ordinaryProfit / sales) * 100 : null;

  const pbrFlag = pbr !== null && pbr < 1 ? ' ⚠️ PBR1倍割れ（バリュー候補）' : '';
  const dividendFlag = dividendYield !== null && dividendYield >= 3 ? ' ✓ 高配当（3%超）' : '';
  const roeFlag = roe !== null && roe < 8 ? ' △ JPX目標8%未満' : '';
  const equityRatioFlag =
    equityRatio !== null ? (equityRatio >= 40 ? ' ✓' : ' △ 40%未満') : '';

  return `## ${code} 投資指標
現在株価: **${formatPrice(price)}** (${formatJpDate(quote.Date)})

### バリュエーション
| 指標 | 値 | 備考 |
|------|-----|------|
| PBR | **${formatMultiple(pbr, 2)}**${pbrFlag} | 1倍割れ = 純資産より安い |
| PER | ${formatMultiple(per, 1)} | |
| 配当利回り | ${formatPercent(dividendYield, 2)}${dividendFlag} | 年間${formatDividendPerShare(dividend)} |
| 配当性向 | ${formatPercent(payoutRatio, 1)} | |

### 収益性
| 指標 | 値 | 備考 |
|------|-----|------|
| ROE | ${formatPercent(roe, 1)}${roeFlag} | JPX推奨水準: 8%以上 |
| ROA | ${formatPercent(roa, 1)} | |
| 営業利益率 | ${formatPercent(operatingMargin, 1)} | |
| 経常利益率 | ${formatPercent(ordinaryMargin, 1)} | 日本独自指標 |

### 財務健全性
| 指標 | 値 | 備考 |
|------|-----|------|
| 自己資本比率 | ${formatPercent(equityRatio, 1)}${equityRatioFlag} | 安全ライン: 40% |
| 純資産 | ${formatJpyAmount(equity)} | |
| 営業CF | ${formatJpyAmount(cfo)} | |

参照決算: ${formatPeriodTypeLabel(statement.CurPerType) || '最新決算'} (${formatPeriod(statement)}, 開示: ${formatJpDate(statement.DiscDate)})`;
}

function renderHistoricalKeyRatios(
  code: string,
  statements: FinSummaryRecord[],
  period: HistoricalKeyRatiosInput['period'],
): string {
  const periodLabel =
    period === 'annual' ? '通期中心' : period === 'quarterly' ? '四半期中心' : '直近開示';

  const rows = statements.map((statement) => {
    const equity = toNumber(statement.Eq);
    const totalAssets = toNumber(statement.TA);
    const netIncome = toNumber(statement.NP);
    const sales = toNumber(statement.Sales);
    const operatingProfit = toNumber(statement.OP);
    const roe =
      equity !== null && equity > 0 && netIncome !== null ? (netIncome / equity) * 100 : null;
    const roa =
      totalAssets !== null && totalAssets > 0 && netIncome !== null
        ? (netIncome / totalAssets) * 100
        : null;
    const operatingMargin =
      sales !== null && sales > 0 && operatingProfit !== null ? (operatingProfit / sales) * 100 : null;

    return `| ${formatPeriodTypeLabel(statement.CurPerType) || '—'} | ${formatPeriod(statement)} | ${formatPerShare(statement.EPS)} | ${formatPerShare(statement.BPS)} | ${formatPercent(roe, 1)} | ${formatPercent(roa, 1)} | ${formatPercent(operatingMargin, 1)} | ${formatPercent(toPercentValue(statement.EqAR), 1)} | ${formatDividendPerShare(statement.DivAnn)} |`;
  });

  return `## ${code} 投資指標推移（直近${statements.length}期）
表示モード: ${periodLabel}

| 区分 | 対象期間 | EPS | BPS | ROE | ROA | 営業利益率 | 自己資本比率 | 年間配当 |
|------|----------|-----|-----|-----|-----|------------|--------------|----------|
${rows.join('\n')}`;
}

export const getKeyRatios = new DynamicStructuredTool({
  name: 'get_key_ratios',
  description:
    '日本株の主要投資指標を返す。PBR、PER、ROE、ROA、配当利回り、配当性向、営業利益率、自己資本比率などを日本株向けに整理して表示する。',
  schema: KeyRatiosInputSchema,
  func: async (input) => {
    const lookup = getLookupValue(input);
    const resolved = await resolveJpTickerFull(lookup);
    if (!resolved) {
      return formatToolResult(
        `証券コードを解決できません: "${lookup}"。4桁の証券コード（例: 7203）または主要企業名で指定してください。`,
      );
    }

    const code = normalizeCode(resolved);
    const [{ quote, url: priceUrl }, { statements, url: financialUrl }] = await Promise.all([
      fetchLatestPrice(code),
      fetchFinancialSummaries(code),
    ]);

    if (!quote) {
      return formatToolResult(`${code} の株価データが見つかりません。`, [priceUrl]);
    }

    const latestPrice = quote.AdjC ?? quote.C;
    if (latestPrice === undefined || !Number.isFinite(latestPrice)) {
      return formatToolResult(`${code} の株価データが見つかりません。`, [priceUrl]);
    }

    const statement = selectKeyRatioStatement(statements);

    if (!statement) {
      return formatToolResult(`${code} の財務データが見つかりません。`, [financialUrl]);
    }

    return formatToolResult(renderKeyRatios(code, latestPrice, quote, statement), [
      priceUrl,
      financialUrl,
    ]);
  },
});

export const getHistoricalKeyRatios = new DynamicStructuredTool({
  name: 'get_historical_key_ratios',
  description:
    '日本株の投資指標推移を返す。直近複数期の EPS、BPS、ROE、ROA、営業利益率、自己資本比率、配当水準を表形式で確認できる。',
  schema: HistoricalKeyRatiosInputSchema,
  func: async (input) => {
    const lookup = getLookupValue(input);
    const resolved = await resolveJpTickerFull(lookup);
    if (!resolved) {
      return formatToolResult(
        `証券コードを解決できません: "${lookup}"。4桁の証券コード（例: 7203）または主要企業名で指定してください。`,
      );
    }

    const code = normalizeCode(resolved);
    const { statements, url } = await fetchFinancialSummaries(code);
    const filtered = filterStatements(statements, input.period).slice(0, input.limit);

    if (filtered.length === 0) {
      return formatToolResult(`${code} の財務データが見つかりません。`, [url]);
    }

    return formatToolResult(renderHistoricalKeyRatios(code, filtered, input.period), [url]);
  },
});
