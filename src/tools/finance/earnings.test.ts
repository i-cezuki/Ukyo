import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'fs';
import { getEarnings } from './earnings.js';
import { resetListedIssuesCacheForTests } from './listed-issues.js';

const ORIGINAL_API_KEY = process.env.JQUANTS_API_KEY;
const ORIGINAL_FETCH = global.fetch;
const TEST_CACHE_DIR = '.dexter/cache';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parseToolPayload(result: unknown): { data: unknown; sourceUrls?: string[] } {
  expect(typeof result).toBe('string');
  return JSON.parse(result as string) as { data: unknown; sourceUrls?: string[] };
}

describe('earnings tool', () => {
  beforeEach(() => {
    process.env.JQUANTS_API_KEY = 'test-key-123';
    global.fetch = ORIGINAL_FETCH;
    resetListedIssuesCacheForTests();
    if (existsSync(TEST_CACHE_DIR)) {
      rmSync(TEST_CACHE_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (ORIGINAL_API_KEY === undefined) {
      delete process.env.JQUANTS_API_KEY;
    } else {
      process.env.JQUANTS_API_KEY = ORIGINAL_API_KEY;
    }
    global.fetch = ORIGINAL_FETCH;
    resetListedIssuesCacheForTests();
    if (existsSync(TEST_CACHE_DIR)) {
      rmSync(TEST_CACHE_DIR, { recursive: true });
    }
  });

  test('returns a helpful error for unknown company names', async () => {
    global.fetch = (async () => jsonResponse({ data: [] })) as unknown as typeof fetch;

    const result = await getEarnings.invoke({ code: '不明企業ZZZ' });
    const payload = parseToolPayload(result);

    expect(payload.data).toBe(
      '証券コードを解決できません: "不明企業ZZZ"。4桁の証券コード（例: 7203）または主要企業名で指定してください。',
    );
  });

  test('renders filtered earnings announcements for a company alias', async () => {
    global.fetch = (async () =>
      jsonResponse({
        data: [
          {
            Date: '2024-05-08',
            Code: '72030',
            CoName: 'トヨタ自動車',
            FY: '2024',
            SectorNm: '自動車・輸送機',
            FQ: '通期',
            Section: 'Prime',
          },
          {
            Date: '2024-05-09',
            Code: '67580',
            CoName: 'ソニーグループ',
            FY: '2024',
            SectorNm: '電機・精密',
            FQ: '通期',
            Section: 'Prime',
          },
        ],
      })) as unknown as typeof fetch;

    const result = await getEarnings.invoke({ ticker: 'トヨタ' });
    const payload = parseToolPayload(result);

    expect(typeof payload.data).toBe('string');
    expect(payload.data).toContain('## 7203 決算発表予定');
    expect(payload.data).toContain('| 2024/05/08 | 7203 | トヨタ自動車 | 通期 | 自動車・輸送機 | Prime |');
    expect(payload.data).not.toContain('ソニーグループ');
    expect(payload.sourceUrls?.[0]).toContain('/equities/earnings-calendar');
  });

  test('renders a date-filtered market-wide schedule', async () => {
    global.fetch = (async () =>
      jsonResponse({
        data: [
          {
            Date: '2024-05-08',
            Code: '72030',
            CoName: 'トヨタ自動車',
            FY: '2024',
            SectorNm: '自動車・輸送機',
            FQ: '通期',
            Section: 'Prime',
          },
          {
            Date: '2024-05-08',
            Code: '67580',
            CoName: 'ソニーグループ',
            FY: '2024',
            SectorNm: '電機・精密',
            FQ: '通期',
            Section: 'Prime',
          },
          {
            Date: '2024-05-09',
            Code: '99830',
            CoName: 'ファーストリテイリング',
            FY: '2024',
            SectorNm: '小売',
            FQ: '2Q',
            Section: 'Prime',
          },
        ],
      })) as unknown as typeof fetch;

    const result = await getEarnings.invoke({ date: '2024-05-08' });
    const payload = parseToolPayload(result);

    expect(typeof payload.data).toBe('string');
    expect(payload.data).toContain('## 決算発表スケジュール (2024/05/08)');
    expect(payload.data).toContain('トヨタ自動車');
    expect(payload.data).toContain('ソニーグループ');
    expect(payload.data).not.toContain('ファーストリテイリング');
  });

  test('returns a no-data message when no announcements match', async () => {
    global.fetch = (async () => jsonResponse({ data: [] })) as unknown as typeof fetch;

    const result = await getEarnings.invoke({ date: '2024-05-08' });
    const payload = parseToolPayload(result);

    expect(payload.data).toBe('該当する決算発表予定が見つかりません。');
    expect(payload.sourceUrls?.[0]).toContain('/equities/earnings-calendar');
  });
});
