import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'fs';
import { getHistoricalKeyRatios, getKeyRatios } from './key-ratios.js';
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

describe('key-ratio tools', () => {
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

    const result = await getKeyRatios.invoke({ code: '不明企業ZZZ' });
    const payload = parseToolPayload(result);

    expect(payload.data).toBe(
      '証券コードを解決できません: "不明企業ZZZ"。4桁の証券コード（例: 7203）または主要企業名で指定してください。',
    );
  });

  test('renders Japanese investment ratios from latest price and fin-summary data', async () => {
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));

      if (url.pathname === '/v2/equities/bars/daily') {
        return jsonResponse({
          data: [
            {
              Date: '2024-05-10',
              Code: '72030',
              C: 3000,
              AdjC: 3000,
            },
          ],
        });
      }

      if (url.pathname === '/v2/fins/summary') {
        return jsonResponse({
          data: [
            {
              DiscDate: '2024-05-08',
              DiscTime: '15:00:00',
              Code: '72030',
              DocType: '本決算短信',
              CurPerType: '通期',
              CurPerSt: '2023-04-01',
              CurPerEn: '2024-03-31',
              Sales: '1000000000000',
              OP: '100000000000',
              OdP: '80000000000',
              NP: '50000000000',
              EPS: '200',
              BPS: '4000',
              TA: '1000000000000',
              Eq: '500000000000',
              EqAR: '50',
              CFO: '120000000000',
              DivAnn: '120',
            },
          ],
        });
      }

      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;

    const result = await getKeyRatios.invoke({ ticker: 'トヨタ' });
    const payload = parseToolPayload(result);

    expect(typeof payload.data).toBe('string');
    expect(payload.data).toContain('## 7203 投資指標');
    expect(payload.data).toContain('現在株価: **3,000円**');
    expect(payload.data).toContain('| PBR | **0.75倍** ⚠️ PBR1倍割れ（バリュー候補） |');
    expect(payload.data).toContain('| PER | 15.0倍 |');
    expect(payload.data).toContain('| 配当利回り | 4.00% ✓ 高配当（3%超） | 年間120円/株 |');
    expect(payload.data).toContain('| ROE | 10.0% | JPX推奨水準: 8%以上 |');
    expect(payload.data).toContain('| 自己資本比率 | 50.0% ✓ | 安全ライン: 40% |');
    expect(payload.sourceUrls).toHaveLength(2);
  });

  test('prefers annual statements when the latest quarterly record lacks BPS and dividend data', async () => {
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));

      if (url.pathname === '/v2/equities/bars/daily') {
        return jsonResponse({
          data: [
            {
              Date: '2026-04-03',
              Code: '68610',
              C: 57730,
              AdjC: 57730,
            },
          ],
        });
      }

      if (url.pathname === '/v2/fins/summary') {
        return jsonResponse({
          data: [
            {
              DiscDate: '2026-02-03',
              DiscTime: '15:00:00',
              Code: '68610',
              DocType: '3Q決算短信',
              CurPerType: '3Q累計',
              CurPerSt: '2025-04-01',
              CurPerEn: '2025-12-31',
              Sales: '800000000000',
              OP: '420000000000',
              OdP: '421000000000',
              NP: '300000000000',
              EPS: '500.0',
              TA: '2800000000000',
              Eq: '2500000000000',
              EqAR: '89.0',
              BPS: '',
              DivAnn: '',
            },
            {
              DiscDate: '2025-04-26',
              DiscTime: '15:00:00',
              Code: '68610',
              DocType: '本決算短信',
              CurPerType: 'FY',
              CurPerSt: '2024-04-01',
              CurPerEn: '2025-03-31',
              Sales: '1000000000000',
              OP: '520000000000',
              OdP: '523000000000',
              NP: '380000000000',
              EPS: '620.0',
              TA: '2900000000000',
              Eq: '2550000000000',
              EqAR: '88.0',
              BPS: '6100.0',
              DivAnn: '350',
              CFO: '450000000000',
            },
          ],
        });
      }

      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;

    const result = await getKeyRatios.invoke({ code: '6861' });
    const payload = parseToolPayload(result);

    expect(typeof payload.data).toBe('string');
    expect(payload.data).toContain('| PBR | **9.46倍** |');
    expect(payload.data).toContain('| 配当利回り | 0.61% | 年間350円/株 |');
    expect(payload.data).toContain('参照決算: 通期 (2024/04/01〜2025/03/31, 開示: 2025/04/26)');
  });

  test('returns a no-data message when price data is empty', async () => {
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));

      if (url.pathname === '/v2/equities/bars/daily') {
        return jsonResponse({ data: [] });
      }

      if (url.pathname === '/v2/fins/summary') {
        return jsonResponse({
          data: [
            {
              DiscDate: '2024-05-08',
              CurPerType: '通期',
              Sales: '100',
            },
          ],
        });
      }

      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;

    const result = await getKeyRatios.invoke({ code: '7203' });
    const payload = parseToolPayload(result);

    expect(payload.data).toBe('7203 の株価データが見つかりません。');
    expect(payload.sourceUrls?.[0]).toContain('/equities/bars/daily');
  });

  test('renders historical key ratios with period filtering and limit', async () => {
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));

      if (url.pathname === '/v2/fins/summary') {
        return jsonResponse({
          data: [
            {
              DiscDate: '2024-05-08',
              DiscTime: '15:00:00',
              Code: '67580',
              CurPerType: '通期',
              CurPerSt: '2023-04-01',
              CurPerEn: '2024-03-31',
              EPS: '150',
              BPS: '2400',
              NP: '90000000000',
              Eq: '1000000000000',
              TA: '2000000000000',
              Sales: '5000000000000',
              OP: '500000000000',
              EqAR: '50',
              DivAnn: '130',
            },
            {
              DiscDate: '2024-02-08',
              DiscTime: '15:00:00',
              Code: '67580',
              CurPerType: '3Q累計',
              CurPerSt: '2023-04-01',
              CurPerEn: '2023-12-31',
              EPS: '100',
              BPS: '2300',
              NP: '70000000000',
              Eq: '980000000000',
              TA: '1950000000000',
              Sales: '3800000000000',
              OP: '380000000000',
              EqAR: '48',
              DivAnn: '120',
            },
            {
              DiscDate: '2023-11-09',
              DiscTime: '15:00:00',
              Code: '67580',
              CurPerType: '2Q累計',
              CurPerSt: '2023-04-01',
              CurPerEn: '2023-09-30',
              EPS: '80',
              BPS: '2250',
              NP: '55000000000',
              Eq: '960000000000',
              TA: '1900000000000',
              Sales: '2400000000000',
              OP: '240000000000',
              EqAR: '47',
              DivAnn: '120',
            },
          ],
        });
      }

      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;

    const result = await getHistoricalKeyRatios.invoke({
      code: 'ソニー',
      period: 'quarterly',
      limit: 2,
    });
    const payload = parseToolPayload(result);

    expect(typeof payload.data).toBe('string');
    expect(payload.data).toContain('## 6758 投資指標推移（直近2期）');
    expect(payload.data).toContain('表示モード: 四半期中心');
    expect(payload.data).toContain('| 3Q累計 | 2023/04/01〜2023/12/31 | 100.00円 |');
    expect(payload.data).toContain('| 2Q累計 | 2023/04/01〜2023/09/30 | 80.00円 |');
    expect(payload.data).not.toContain('| 通期 | 2023/04/01〜2024/03/31 |');
    expect(payload.sourceUrls?.[0]).toContain('/fins/summary');
  });
});
