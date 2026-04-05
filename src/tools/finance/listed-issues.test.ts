import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'fs';
import {
  getListedIssues,
  resetListedIssuesCacheForTests,
  resolveTickerFromMaster,
} from './listed-issues.js';
import { resolveJpTickerFull } from './ticker.js';

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

describe('listed issues tools', () => {
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

  test('resolves a ticker from the listed master fallback', async () => {
    global.fetch = (async () =>
      jsonResponse({
        data: [
          {
            Date: '2024-04-01',
            Code: '28750',
            CoName: '東洋水産',
            CoNameEn: 'Toyo Suisan Kaisha, Ltd.',
            S33Nm: '食料品',
            MktNm: 'Prime',
          },
        ],
      })) as unknown as typeof fetch;

    await expect(resolveTickerFromMaster('東洋水産')).resolves.toBe('2875');
    await expect(resolveJpTickerFull('東洋水産')).resolves.toBe('2875');
  });

  test('uses the static map before calling the master API', async () => {
    global.fetch = (async () => {
      throw new Error('master lookup should not be called');
    }) as unknown as typeof fetch;

    await expect(resolveJpTickerFull('トヨタ')).resolves.toBe('7203');
  });

  test('renders listed issues with market filtering', async () => {
    global.fetch = (async () =>
      jsonResponse({
        data: [
          {
            Date: '2024-04-01',
            Code: '28750',
            CoName: '東洋水産',
            CoNameEn: 'Toyo Suisan Kaisha, Ltd.',
            S33Nm: '食料品',
            MktNm: 'Prime',
          },
          {
            Date: '2024-04-01',
            Code: '28010',
            CoName: 'キッコーマン',
            CoNameEn: 'Kikkoman Corporation',
            S33Nm: '食料品',
            MktNm: 'Standard',
          },
        ],
      })) as unknown as typeof fetch;

    const result = await getListedIssues.invoke({ query: '食料品', market: 'prime' });
    const payload = parseToolPayload(result);

    expect(typeof payload.data).toBe('string');
    expect(payload.data).toContain('## 上場銘柄検索結果: "食料品"');
    expect(payload.data).toContain('| 2875 | 東洋水産 | Toyo Suisan Kaisha, Ltd. | 食料品 | Prime |');
    expect(payload.data).not.toContain('キッコーマン');
    expect(payload.sourceUrls?.[0]).toContain('/equities/master');
  });

  test('returns a no-data message when the master has no matches', async () => {
    global.fetch = (async () => jsonResponse({ data: [] })) as unknown as typeof fetch;

    const result = await getListedIssues.invoke({ query: '存在しない銘柄' });
    const payload = parseToolPayload(result);

    expect(payload.data).toBe('"存在しない銘柄" に該当する上場銘柄が見つかりません。');
    expect(payload.sourceUrls?.[0]).toContain('/equities/master');
  });
});
