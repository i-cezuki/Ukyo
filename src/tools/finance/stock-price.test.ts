import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'fs';
import { getStockPrice, getStockPrices, getStockTickers } from './stock-price.js';
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

describe('stock-price tools', () => {
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

    const result = await getStockPrice.invoke({ code: '存在しない会社XYZ' });
    const payload = parseToolPayload(result);

    expect(payload.data).toBe(
      '証券コードを解決できません: "存在しない会社XYZ"。4桁の証券コード（例: 7203）または主要企業名で指定してください。',
    );
  });

  test('renders a Japanese current-price summary from V2 daily bars', async () => {
    global.fetch = (async () =>
      jsonResponse({
        data: [
          {
            Date: '2024-04-01',
            Code: '72030',
            O: 3000,
            H: 3050,
            L: 2990,
            C: 3040,
            Vo: 1_000_000,
            Va: 3_500_000_000,
            AdjC: 3040,
          },
        ],
      })) as unknown as typeof fetch;

    const result = await getStockPrice.invoke({ code: 'トヨタ' });
    const payload = parseToolPayload(result);

    expect(typeof payload.data).toBe('string');
    expect(payload.data).toContain('7203 株価');
    expect(payload.data).toContain('最新終値: **3,040円**');
    expect(payload.data).toContain('2024/04/01');
    expect(payload.sourceUrls?.[0]).toContain('/equities/bars/daily');
  });

  test('renders historical daily bars as a markdown table', async () => {
    global.fetch = (async () =>
      jsonResponse({
        data: [
          {
            Date: '2024-04-01',
            Code: '67580',
            O: 12000,
            H: 12100,
            L: 11900,
            C: 12050,
            Vo: 500_000,
            Va: 6_000_000_000,
          },
          {
            Date: '2024-04-02',
            Code: '67580',
            O: 12100,
            H: 12250,
            L: 12080,
            C: 12200,
            Vo: 520_000,
            Va: 6_300_000_000,
          },
        ],
      })) as unknown as typeof fetch;

    const result = await getStockPrices.invoke({
      code: 'ソニー',
      start_date: '2024-04-01',
      end_date: '2024-04-02',
    });
    const payload = parseToolPayload(result);

    expect(typeof payload.data).toBe('string');
    expect(payload.data).toContain('6758 株価推移');
    expect(payload.data).toContain('| 日付 | 始値 | 高値 | 安値 | 終値 | 出来高 |');
    expect(payload.data).toContain('2024/04/02');
    expect(payload.sourceUrls?.[0]).toContain('/equities/bars/daily');
  });

  test('returns a helpful error for unknown historical price queries', async () => {
    global.fetch = (async () => jsonResponse({ data: [] })) as unknown as typeof fetch;

    const result = await getStockPrices.invoke({
      code: '存在しない会社XYZ',
      start_date: '2024-04-01',
      end_date: '2024-04-02',
    });
    const payload = parseToolPayload(result);

    expect(payload.data).toBe(
      '証券コードを解決できません: "存在しない会社XYZ"。4桁の証券コード（例: 7203）または主要企業名で指定してください。',
    );
  });

  test('returns a no-data message when the API returns an empty array', async () => {
    global.fetch = (async () => jsonResponse({ data: [] })) as unknown as typeof fetch;

    const result = await getStockPrice.invoke({ code: 'トヨタ' });
    const payload = parseToolPayload(result);

    expect(payload.data).toBe('7203 の株価データが見つかりません。');
    expect(payload.sourceUrls?.[0]).toContain('/equities/bars/daily');
  });

  test('resolves stock tickers from the bootstrap map', async () => {
    const result = await getStockTickers.invoke({ query: 'ソニー' });
    const payload = parseToolPayload(result);

    expect(payload.data).toBe('ソニー → 証券コード: 6758');
  });
});
