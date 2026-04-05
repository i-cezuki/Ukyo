import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { api } from './api.js';
import { formatJpDate, formatJpyAmount } from './formatters.js';
import { normalizeCode, resolveJpTickerFull } from './ticker.js';
import { isAnnualPeriodType, normalizeAsciiUpper, TTL_24H } from './utils.js';

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
  CFI?: string | number;
  CFF?: string | number;
  DivAnn?: string | number;
};

type FinSummaryResponse = {
  data?: FinSummaryRecord[];
};

const FinancialsInputSchema = z
  .object({
    code: z
      .string()
      .optional()
      .describe('証券コード（例: 6758）または会社名（例: ソニー、トヨタ）'),
    ticker: z
      .string()
      .optional()
      .describe('互換用の別名引数。証券コードまたは会社名を指定できる。'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(12)
      .default(4)
      .describe('取得する決算期数（デフォルト4、最大12）'),
  })
  .refine((input) => Boolean(input.code ?? input.ticker), {
    message: 'code または ticker を指定してください。',
    path: ['code'],
  });

type FinancialsInput = z.infer<typeof FinancialsInputSchema>;

function getLookupValue(input: FinancialsInput): string {
  return (input.code ?? input.ticker ?? '').trim();
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

function formatRatio(value: unknown): string {
  const numeric = toPercentValue(value);
  return numeric === null ? '—' : `${numeric.toFixed(1)}%`;
}

function formatPerShare(value: unknown): string {
  const numeric = toNumber(value);
  return numeric === null ? '—' : `${numeric.toFixed(2)}円`;
}

function formatDividend(value: unknown): string {
  const numeric = toNumber(value);
  return numeric === null || numeric <= 0 ? '非開示' : `${numeric}円/株`;
}

function formatPeriod(record: FinSummaryRecord): string {
  const start = formatJpDate(record.CurPerSt);
  const end = formatJpDate(record.CurPerEn);

  if (start === '—' && end === '—') {
    return record.CurPerType?.trim() || '期間情報なし';
  }

  if (start === '—') {
    return end;
  }

  if (end === '—') {
    return start;
  }

  return `${start}〜${end}`;
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

function formatHeading(record: FinSummaryRecord): string {
  const periodType = formatPeriodTypeLabel(record.CurPerType);
  const period = formatPeriod(record);
  return periodType ? `${periodType} (${period})` : period;
}

function sortRecords(records: FinSummaryRecord[]): FinSummaryRecord[] {
  return [...records].sort((left, right) => {
    const leftKey = `${left.DiscDate ?? ''} ${left.DiscTime ?? ''}`;
    const rightKey = `${right.DiscDate ?? ''} ${right.DiscTime ?? ''}`;
    return rightKey.localeCompare(leftKey);
  });
}

function isAnnual(record: FinSummaryRecord): boolean {
  return isAnnualPeriodType(record.CurPerType);
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
    statements: sortRecords(data.data ?? []),
    url,
  };
}

function renderIncomeStatement(record: FinSummaryRecord): string {
  const sales = toNumber(record.Sales);
  const operatingProfit = toNumber(record.OP);
  const operatingMargin =
    sales !== null && sales !== 0 && operatingProfit !== null
      ? `${((operatingProfit / sales) * 100).toFixed(1)}%`
      : '—';

  return `### ${formatHeading(record)}
開示日: ${formatJpDate(record.DiscDate)} | ${record.DocType ?? '財務情報サマリ'}

| 項目 | 金額 |
|------|------|
| 売上高 | ${formatJpyAmount(sales)} |
| 営業利益 | ${formatJpyAmount(operatingProfit)} |
| 営業利益率 | ${operatingMargin} |
| 経常利益 | ${formatJpyAmount(toNumber(record.OdP))} |
| 当期純利益 | ${formatJpyAmount(toNumber(record.NP))} |
| EPS | ${formatPerShare(record.EPS)} |`;
}

function renderBalanceSheet(record: FinSummaryRecord): string {
  return `### ${formatHeading(record)}
開示日: ${formatJpDate(record.DiscDate)} | ${record.DocType ?? '財務情報サマリ'}

| 項目 | 金額 |
|------|------|
| 総資産 | ${formatJpyAmount(toNumber(record.TA))} |
| 純資産 | ${formatJpyAmount(toNumber(record.Eq))} |
| 自己資本比率 | ${formatRatio(record.EqAR)} |
| BPS | ${formatPerShare(record.BPS)} |`;
}

function renderCashFlowStatement(record: FinSummaryRecord): string {
  const cfo = toNumber(record.CFO);
  const cfi = toNumber(record.CFI);
  const cff = toNumber(record.CFF);
  const freeCashFlow =
    cfo !== null && cfi !== null ? cfo + cfi : null;

  return `### ${formatHeading(record)}
開示日: ${formatJpDate(record.DiscDate)} | ${record.DocType ?? '財務情報サマリ'}

| 区分 | 金額 |
|------|------|
| 営業CF | ${formatJpyAmount(cfo)} |
| 投資CF | ${formatJpyAmount(cfi)} |
| 財務CF | ${formatJpyAmount(cff)} |
| FCF（営業+投資） | ${formatJpyAmount(freeCashFlow)} |

年間配当: ${formatDividend(record.DivAnn)}`;
}

function renderFullStatement(record: FinSummaryRecord): string {
  const cfo = toNumber(record.CFO);
  const cfi = toNumber(record.CFI);
  const freeCashFlow =
    cfo !== null && cfi !== null ? cfo + cfi : null;

  return `### ${formatHeading(record)}
開示日: ${formatJpDate(record.DiscDate)} | ${record.DocType ?? '財務情報サマリ'}

**損益計算書（PL）**
| 項目 | 金額 |
|------|------|
| 売上高 | ${formatJpyAmount(toNumber(record.Sales))} |
| 営業利益 | ${formatJpyAmount(toNumber(record.OP))} |
| 経常利益 | ${formatJpyAmount(toNumber(record.OdP))} |
| 当期純利益 | ${formatJpyAmount(toNumber(record.NP))} |
| EPS | ${formatPerShare(record.EPS)} |

**貸借対照表（BS）**
| 項目 | 金額 |
|------|------|
| 総資産 | ${formatJpyAmount(toNumber(record.TA))} |
| 純資産 | ${formatJpyAmount(toNumber(record.Eq))} |
| 自己資本比率 | ${formatRatio(record.EqAR)} |
| BPS | ${formatPerShare(record.BPS)} |

**キャッシュフロー（CF）**
| 区分 | 金額 |
|------|------|
| 営業CF | ${formatJpyAmount(cfo)} |
| 投資CF | ${formatJpyAmount(cfi)} |
| 財務CF | ${formatJpyAmount(toNumber(record.CFF))} |
| FCF（営業+投資） | ${formatJpyAmount(freeCashFlow)} |
| 年間配当 | ${formatDividend(record.DivAnn)} |`;
}

async function runFinancialsTool(
  input: FinancialsInput,
  render: (record: FinSummaryRecord) => string,
  title: string,
): Promise<string> {
  const lookup = getLookupValue(input);
  const resolved = await resolveJpTickerFull(lookup);

  if (!resolved) {
    return formatToolResult(
      `証券コードを解決できません: "${lookup}"。4桁の証券コード（例: 6758）または主要企業名で指定してください。`,
    );
  }

  const code = normalizeCode(resolved);
  const { statements, url } = await fetchFinancialSummaries(code);
  const annualStatements = statements.filter(isAnnual);
  const sourceStatements = annualStatements.length > 0 ? annualStatements : statements;
  const visibleStatements = sourceStatements
    .filter((statement) => statement.CurPerType || statement.DiscDate)
    .slice(0, input.limit);

  if (visibleStatements.length === 0) {
    return formatToolResult(`${code} の財務データが見つかりません。`, [url]);
  }

  const body = visibleStatements.map(render).join('\n\n---\n\n');
  return formatToolResult(`# ${code} ${title}（直近${visibleStatements.length}期）\n\n${body}`, [url]);
}

export const getIncomeStatements = new DynamicStructuredTool({
  name: 'get_income_statements',
  description:
    '日本株の損益計算書サマリを取得する。証券コードまたは会社名で指定できる。',
  schema: FinancialsInputSchema,
  func: async (input) => runFinancialsTool(input, renderIncomeStatement, '損益計算書'),
});

export const getBalanceSheets = new DynamicStructuredTool({
  name: 'get_balance_sheets',
  description:
    '日本株の貸借対照表サマリを取得する。証券コードまたは会社名で指定できる。',
  schema: FinancialsInputSchema,
  func: async (input) => runFinancialsTool(input, renderBalanceSheet, '貸借対照表'),
});

export const getCashFlowStatements = new DynamicStructuredTool({
  name: 'get_cash_flow_statements',
  description:
    '日本株のキャッシュフロー計算書サマリを取得する。証券コードまたは会社名で指定できる。',
  schema: FinancialsInputSchema,
  func: async (input) => runFinancialsTool(input, renderCashFlowStatement, 'キャッシュフロー計算書'),
});

export const getAllFinancialStatements = new DynamicStructuredTool({
  name: 'get_all_financial_statements',
  description:
    '日本株の財務3表サマリ（PL・BS・CF）をまとめて取得する。証券コードまたは会社名で指定できる。',
  schema: FinancialsInputSchema,
  func: async (input) => runFinancialsTool(input, renderFullStatement, '財務諸表'),
});
