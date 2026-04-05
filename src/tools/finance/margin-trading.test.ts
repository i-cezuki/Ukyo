import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'fs';
import { getMarginTrading } from './margin-trading.js';
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

describe('margin trading tool', () => {
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

    const result = await getMarginTrading.invoke({ code: '存在しないXYZ' });
    const payload = parseToolPayload(result);

    expect(payload.data).toBe(
      '証券コードを解決できません: "存在しないXYZ"。4桁の証券コード（例: 7203）または主要企業名で指定してください。',
    );
  });

  test('renders recent margin balances and leverage ratio', async () => {
    global.fetch = (async () =>
      jsonResponse({
        data: [
          { Date: '2024-04-05', Code: '72030', LongVol: 3000000, ShrtVol: 900000 },
          { Date: '2024-04-12', Code: '72030', LongVol: 3200000, ShrtVol: 800000 },
        ],
      })) as unknown as typeof fetch;

    const result = await getMarginTrading.invoke({ code: 'トヨタ' });
    const payload = parseToolPayload(result);

    expect(typeof payload.data).toBe('string');
    expect(payload.data).toContain('## 7203 信用取引残高（直近2週）');
    expect(payload.data).toContain('| 2024/04/12 | 3,200,000株 | 800,000株 | **4.00倍** ⚠️ 買い方過熱 |');
    expect(payload.sourceUrls?.[0]).toContain('/markets/margin-interest');
  });

  test('returns a no-data message when margin data is empty', async () => {
    global.fetch = (async () => jsonResponse({ data: [] })) as unknown as typeof fetch;

    const result = await getMarginTrading.invoke({ code: '7203' });
    const payload = parseToolPayload(result);

    expect(payload.data).toBe('7203 の信用取引データが見つかりません。');
    expect(payload.sourceUrls?.[0]).toContain('/markets/margin-interest');
  });
});
