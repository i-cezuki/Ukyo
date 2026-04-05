import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { api } from './api.js';
import { formatJpDate } from './formatters.js';
import { TTL_24H } from './utils.js';

type InvestorTradingRecord = {
  PubDate?: string;
  StDate?: string;
  EnDate?: string;
  Section?: string;
  IndBuy?: number | string;
  IndSell?: number | string;
  IndBal?: number | string;
  FrgnBuy?: number | string;
  FrgnSell?: number | string;
  FrgnBal?: number | string;
  InvTrBuy?: number | string;
  InvTrSell?: number | string;
  InvTrBal?: number | string;
  TrstBnkBuy?: number | string;
  TrstBnkSell?: number | string;
  TrstBnkBal?: number | string;
};

type InvestorTradingResponse = {
  data?: InvestorTradingRecord[];
};

const InvestorTradingInputSchema = z.object({
  section: z
    .enum(['TSEPrime', 'TSEStandard', 'TSEGrowth', 'TokyoNagoya'])
    .optional()
    .default('TSEPrime')
    .describe('対象市場（デフォルト: TSEPrime）'),
  from: z.string().optional().describe('開始日 YYYY-MM-DD（省略時は過去8週）'),
  to: z.string().optional().describe('終了日 YYYY-MM-DD（省略時は最新）'),
});

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

  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function formatBalance(value: unknown): string {
  const numeric = toNumber(value);
  if (numeric === null) {
    return '—';
  }

  const sign = numeric > 0 ? '+' : '';
  return `${sign}${numeric.toLocaleString('ja-JP')}`;
}

function sortRecords(records: InvestorTradingRecord[]): InvestorTradingRecord[] {
  return [...records].sort((left, right) => {
    const leftKey = `${left.StDate ?? ''}_${left.Section ?? ''}`;
    const rightKey = `${right.StDate ?? ''}_${right.Section ?? ''}`;
    return leftKey.localeCompare(rightKey);
  });
}

export const getInvestorTrading = new DynamicStructuredTool({
  name: 'get_investor_trading',
  description:
    '投資家別売買動向（外国人・個人・投資信託・信託銀行）を取得する。市場センチメントと相場の方向性分析に使う。',
  schema: InvestorTradingInputSchema,
  func: async (input) => {
    const from = input.from ?? getDateDaysAgoInTokyo(56);
    const to = input.to ?? getTodayInTokyo();

    const { data, url } = await api.get<InvestorTradingResponse>(
      '/equities/investor-types',
      {
        section: input.section,
        from,
        to,
      },
      {
        cacheable: true,
        ttlMs: TTL_24H,
        arrayKey: 'data',
      },
    );

    const records = sortRecords(data.data ?? []).slice(-8);
    if (records.length === 0) {
      return formatToolResult('投資家別売買データが見つかりません。', [url]);
    }

    const rows = records
      .map((record) => {
        return `| ${formatJpDate(record.StDate)} | ${formatBalance(record.FrgnBal)} | ${formatBalance(record.IndBal)} | ${formatBalance(record.InvTrBal)} | ${formatBalance(record.TrstBnkBal)} |`;
      })
      .join('\n');

    const latest = records[records.length - 1];
    const latestForeign = toNumber(latest.FrgnBal) ?? 0;

    return formatToolResult(
      `## 投資家別売買動向（${input.section ?? 'TSEPrime'}、直近${records.length}週）

最新週（${formatJpDate(latest.StDate)}〜${formatJpDate(latest.EnDate)}）:
外国人: **${formatBalance(latest.FrgnBal)}** ${latestForeign > 0 ? '買越' : latestForeign < 0 ? '売越' : '均衡'}

| 週 | 外国人 | 個人 | 投資信託 | 信託銀行 |
|----|--------|------|----------|----------|
${rows}

**解釈の目安:**
- 外国人の連続買越 → 強気相場の継続シグナル
- 外国人の連続売越 → 調整局面の可能性
- 個人の大幅買越 + 外国人売越 → 天井圏の注意サイン`,
      [url],
    );
  },
});
