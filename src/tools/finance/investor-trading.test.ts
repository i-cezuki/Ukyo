import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'fs';
import { getInvestorTrading } from './investor-trading.js';

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

describe('investor trading tool', () => {
  beforeEach(() => {
    process.env.JQUANTS_API_KEY = 'test-key-123';
    global.fetch = ORIGINAL_FETCH;
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
    if (existsSync(TEST_CACHE_DIR)) {
      rmSync(TEST_CACHE_DIR, { recursive: true });
    }
  });

  test('renders investor flows for the default section', async () => {
    global.fetch = (async () =>
      jsonResponse({
        data: [
          {
            PubDate: '2024-04-18',
            StDate: '2024-04-08',
            EnDate: '2024-04-12',
            Section: 'TSEPrime',
            FrgnBal: 120000000,
            IndBal: -80000000,
            InvTrBal: 30000000,
            TrstBnkBal: 45000000,
          },
          {
            PubDate: '2024-04-25',
            StDate: '2024-04-15',
            EnDate: '2024-04-19',
            Section: 'TSEPrime',
            FrgnBal: -20000000,
            IndBal: 50000000,
            InvTrBal: 10000000,
            TrstBnkBal: 15000000,
          },
        ],
      })) as unknown as typeof fetch;

    const result = await getInvestorTrading.invoke({});
    const payload = parseToolPayload(result);

    expect(typeof payload.data).toBe('string');
    expect(payload.data).toContain('## 投資家別売買動向（TSEPrime、直近2週）');
    expect(payload.data).toContain('外国人: **-20,000,000** 売越');
    expect(payload.data).toContain('| 2024/04/15 | -20,000,000 | +50,000,000 | +10,000,000 | +15,000,000 |');
    expect(payload.sourceUrls?.[0]).toContain('/equities/investor-types');
  });

  test('returns a no-data message when no investor data exists', async () => {
    global.fetch = (async () => jsonResponse({ data: [] })) as unknown as typeof fetch;

    const result = await getInvestorTrading.invoke({ section: 'TSEPrime' });
    const payload = parseToolPayload(result);

    expect(payload.data).toBe('投資家別売買データが見つかりません。');
    expect(payload.sourceUrls?.[0]).toContain('/equities/investor-types');
  });
});
