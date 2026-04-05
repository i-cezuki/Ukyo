import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { api } from './api.js';
import { formatJpDate } from './formatters.js';
import { normalizeCode, resolveJpTickerFull } from './ticker.js';
import { TTL_24H } from './utils.js';

type MarginInterestRecord = {
  Date?: string;
  Code?: string;
  ShrtVol?: number | string;
  LongVol?: number | string;
  ShrtNegVol?: number | string;
  LongNegVol?: number | string;
  ShrtStdVol?: number | string;
  LongStdVol?: number | string;
  IssType?: string;
};

type MarginInterestResponse = {
  data?: MarginInterestRecord[];
};

const MarginTradingInputSchema = z.object({
  code: z.string().describe('証券コードまたは会社名'),
  from: z.string().optional().describe('取得開始日 YYYY-MM-DD（省略時は過去8週）'),
  to: z.string().optional().describe('取得終了日 YYYY-MM-DD（省略時は最新）'),
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

function formatVolume(value: unknown): string {
  const numeric = toNumber(value);
  return numeric === null ? '—' : `${numeric.toLocaleString('ja-JP')}株`;
}

function sortRecords(records: MarginInterestRecord[]): MarginInterestRecord[] {
  return [...records].sort((left, right) => (left.Date ?? '').localeCompare(right.Date ?? ''));
}

export const getMarginTrading = new DynamicStructuredTool({
  name: 'get_margin_trading',
  description:
    '信用取引残高（信用買い残・信用売り残・貸借倍率）を取得する。需給の過熱感や売り圧力の判断に使う。',
  schema: MarginTradingInputSchema,
  func: async (input) => {
    const resolved = await resolveJpTickerFull(input.code);
    if (!resolved) {
      return formatToolResult(
        `証券コードを解決できません: "${input.code}"。4桁の証券コード（例: 7203）または主要企業名で指定してください。`,
      );
    }

    const code = normalizeCode(resolved);
    const from = input.from ?? getDateDaysAgoInTokyo(56);
    const to = input.to ?? getTodayInTokyo();

    const { data, url } = await api.get<MarginInterestResponse>(
      '/markets/margin-interest',
      { code, from, to },
      {
        cacheable: true,
        ttlMs: TTL_24H,
        arrayKey: 'data',
      },
    );

    const records = sortRecords(data.data ?? []).slice(-8);
    if (records.length === 0) {
      return formatToolResult(`${code} の信用取引データが見つかりません。`, [url]);
    }

    const rows = records
      .map((record) => {
        const longVolume = toNumber(record.LongVol);
        const shortVolume = toNumber(record.ShrtVol);
        const ratio =
          longVolume !== null && shortVolume !== null && shortVolume > 0
            ? (longVolume / shortVolume).toFixed(2)
            : 'N/A';
        const ratioFlag =
          ratio !== 'N/A' && Number(ratio) > 3
            ? ' ⚠️ 買い方過熱'
            : ratio !== 'N/A' && Number(ratio) < 1
              ? ' ↓ 売り優勢'
              : '';

        return `| ${formatJpDate(record.Date)} | ${formatVolume(record.LongVol)} | ${formatVolume(record.ShrtVol)} | **${ratio}倍**${ratioFlag} |`;
      })
      .join('\n');

    return formatToolResult(
      `## ${code} 信用取引残高（直近${records.length}週）

| 週 | 信用買い残 | 信用売り残 | 貸借倍率 |
|----|-----------|-----------|---------|
${rows}

**解釈の目安:**
- 貸借倍率 > 3倍: 買い方過熱（調整リスク）
- 貸借倍率 < 1倍: 売り方優勢（ショート圧力）
- 貸借倍率 ≒ 1倍: 需給バランス`,
      [url],
    );
  },
});
