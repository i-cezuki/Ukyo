import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { api } from './api.js';
import { formatJpDate } from './formatters.js';
import { normalizeCode, resolveJpTickerFull } from './ticker.js';
import { TTL_1H } from './utils.js';

type EarningsAnnouncement = {
  Date?: string;
  Code?: string;
  CoName?: string;
  FY?: string;
  SectorNm?: string;
  FQ?: string;
  Section?: string;
};

type EarningsCalendarResponse = {
  data?: EarningsAnnouncement[];
};

const EarningsInputSchema = z.object({
  code: z
    .string()
    .optional()
    .describe('証券コードまたは会社名。省略時は全銘柄を対象にする。'),
  ticker: z
    .string()
    .optional()
    .describe('互換用の別名引数。証券コードまたは会社名を指定できる。'),
  date: z
    .string()
    .optional()
    .describe('特定日 YYYY-MM-DD。省略時は取得結果の先頭から表示する。'),
});

function getLookupValue(input: z.infer<typeof EarningsInputSchema>): string {
  return (input.code ?? input.ticker ?? '').trim();
}

function normalizeIsoDate(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, 10);
}

function sortAnnouncements(records: EarningsAnnouncement[]): EarningsAnnouncement[] {
  return [...records].sort((left, right) => {
    const leftKey = `${left.Date ?? ''}_${left.Code ?? ''}`;
    const rightKey = `${right.Date ?? ''}_${right.Code ?? ''}`;
    return leftKey.localeCompare(rightKey);
  });
}

async function fetchEarningsCalendar(): Promise<{ announcements: EarningsAnnouncement[]; url: string }> {
  const { data, url } = await api.get<EarningsCalendarResponse>(
    '/equities/earnings-calendar',
    {},
    {
      cacheable: true,
      ttlMs: TTL_1H,
      arrayKey: 'data',
    },
  );

  return {
    announcements: sortAnnouncements(data.data ?? []),
    url,
  };
}

function renderHeading(
  filtered: EarningsAnnouncement[],
  code: string | null,
  date: string | null,
): string {
  if (code && date) {
    return `## ${code} 決算発表予定 (${formatJpDate(date)})`;
  }
  if (code) {
    return `## ${code} 決算発表予定`;
  }
  if (date) {
    return `## 決算発表スケジュール (${formatJpDate(date)})`;
  }
  return `## 決算発表スケジュール（最大${filtered.length}件）`;
}

function renderRows(records: EarningsAnnouncement[]): string {
  return records
    .map(
      (record) =>
        `| ${formatJpDate(record.Date)} | ${normalizeCode(record.Code ?? '—')} | ${record.CoName ?? '—'} | ${record.FQ ?? '—'} | ${record.SectorNm ?? '—'} | ${record.Section ?? '—'} |`,
    )
    .join('\n');
}

export const getEarnings = new DynamicStructuredTool({
  name: 'get_earnings',
  description:
    '決算発表スケジュール・決算カレンダーを取得する。特定銘柄または特定日付の決算予定を確認できる。',
  schema: EarningsInputSchema,
  func: async (input) => {
    const lookup = getLookupValue(input);
    const requestedDate = normalizeIsoDate(input.date);
    let resolvedCode: string | null = null;

    if (lookup) {
      resolvedCode = await resolveJpTickerFull(lookup);
      if (!resolvedCode) {
        return formatToolResult(
          `証券コードを解決できません: "${lookup}"。4桁の証券コード（例: 7203）または主要企業名で指定してください。`,
        );
      }
      resolvedCode = normalizeCode(resolvedCode);
    }

    const { announcements, url } = await fetchEarningsCalendar();

    const filtered = announcements
      .filter((announcement) => {
        const announcementCode = normalizeCode(announcement.Code ?? '');
        if (resolvedCode && announcementCode !== resolvedCode) {
          return false;
        }

        const announcementDate = normalizeIsoDate(announcement.Date);
        if (requestedDate && announcementDate !== requestedDate) {
          return false;
        }

        return true;
      })
      .slice(0, 20);

    if (filtered.length === 0) {
      return formatToolResult('該当する決算発表予定が見つかりません。', [url]);
    }

    const heading = renderHeading(filtered, resolvedCode, requestedDate);
    const rows = renderRows(filtered);

    return formatToolResult(
      `${heading}

| 発表日 | コード | 会社名 | 決算期 | セクター | 市場区分 |
|--------|--------|--------|--------|----------|----------|
${rows}

※ 業績修正や決算関連開示が含まれる場合があります。`,
      [url],
    );
  },
});
