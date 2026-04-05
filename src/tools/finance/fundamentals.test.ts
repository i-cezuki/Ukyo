import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'fs';
import {
  getAllFinancialStatements,
  getBalanceSheets,
  getCashFlowStatements,
  getIncomeStatements,
} from './fundamentals.js';
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

describe('fundamentals tools', () => {
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

    const result = await getAllFinancialStatements.invoke({ code: '存在しない会社XYZ' });
    const payload = parseToolPayload(result);

    expect(payload.data).toBe(
      '証券コードを解決できません: "存在しない会社XYZ"。4桁の証券コード（例: 6758）または主要企業名で指定してください。',
    );
  });

  test('renders full financial statements from V2 fin-summary data', async () => {
    global.fetch = (async () =>
      jsonResponse({
        data: [
          {
            DiscDate: '2024-02-09',
            DiscTime: '15:00:00',
            Code: '67580',
            DocType: '3Q決算短信',
            CurPerType: '3Q累計',
            CurPerSt: '2023-04-01',
            CurPerEn: '2023-12-31',
            Sales: '8000000000000',
            OP: '900000000000',
            OdP: '950000000000',
            NP: '700000000000',
            EPS: '110.5',
            TA: '30000000000000',
            Eq: '13500000000000',
            EqAR: '45.0',
            BPS: '2200.5',
            CFO: '800000000000',
            CFI: '-300000000000',
            CFF: '-120000000000',
            DivAnn: '120',
          },
          {
            DiscDate: '2024-05-14',
            DiscTime: '15:00:00',
            Code: '67580',
            DocType: '本決算短信',
            CurPerType: '通期',
            CurPerSt: '2023-04-01',
            CurPerEn: '2024-03-31',
            Sales: '13000000000000',
            OP: '1200000000000',
            OdP: '1250000000000',
            NP: '970000000000',
            EPS: '152.3',
            TA: '32000000000000',
            Eq: '15000000000000',
            EqAR: '46.9',
            BPS: '2450.75',
            CFO: '1500000000000',
            CFI: '-600000000000',
            CFF: '-400000000000',
            DivAnn: '130',
          },
          {
            DiscDate: '2023-05-17',
            DiscTime: '15:00:00',
            Code: '67580',
            DocType: '本決算短信',
            CurPerType: '通期',
            CurPerSt: '2022-04-01',
            CurPerEn: '2023-03-31',
            Sales: '11800000000000',
            OP: '1100000000000',
            OdP: '1120000000000',
            NP: '890000000000',
            EPS: '139.2',
            TA: '30500000000000',
            Eq: '14200000000000',
            EqAR: '46.5',
            BPS: '2330.10',
            CFO: '1300000000000',
            CFI: '-550000000000',
            CFF: '-300000000000',
            DivAnn: '120',
          },
        ],
      })) as unknown as typeof fetch;

    const result = await getAllFinancialStatements.invoke({ code: 'ソニー', limit: 2 });
    const payload = parseToolPayload(result);

    expect(typeof payload.data).toBe('string');
    expect(payload.data).toContain('# 6758 財務諸表（直近2期）');
    expect(payload.data).toContain('### 通期 (2023/04/01〜2024/03/31)');
    expect(payload.data).toContain('### 通期 (2022/04/01〜2023/03/31)');
    expect(payload.data).toContain('**損益計算書（PL）**');
    expect(payload.data).toContain('| 売上高 | 13.0兆円 |');
    expect(payload.data).toContain('| 自己資本比率 | 46.9% |');
    expect(payload.data).toContain('| FCF（営業+投資） | 9000億円 |');
    expect(payload.data).toContain('| 年間配当 | 130円/株 |');
    expect(payload.sourceUrls?.[0]).toContain('/fins/summary');
  });

  test('accepts ticker as a compatibility alias for income statements', async () => {
    global.fetch = (async () =>
      jsonResponse({
        data: [
          {
            DiscDate: '2024-05-14',
            DiscTime: '15:00:00',
            Code: '72030',
            DocType: '本決算短信',
            CurPerType: '通期',
            CurPerSt: '2023-04-01',
            CurPerEn: '2024-03-31',
            Sales: '45000000000000',
            OP: '5000000000000',
            OdP: '5200000000000',
            NP: '4900000000000',
            EPS: '350.25',
          },
        ],
      })) as unknown as typeof fetch;

    const result = await getIncomeStatements.invoke({ ticker: 'トヨタ', limit: 1 });
    const payload = parseToolPayload(result);

    expect(typeof payload.data).toBe('string');
    expect(payload.data).toContain('# 7203 損益計算書（直近1期）');
    expect(payload.data).toContain('| 営業利益率 | 11.1% |');
    expect(payload.data).toContain('| EPS | 350.25円 |');
    expect(payload.sourceUrls?.[0]).toContain('/fins/summary');
  });

  test('returns a no-data message for empty balance-sheet responses', async () => {
    global.fetch = (async () => jsonResponse({ data: [] })) as unknown as typeof fetch;

    const result = await getBalanceSheets.invoke({ code: '6758', limit: 1 });
    const payload = parseToolPayload(result);

    expect(payload.data).toBe('6758 の財務データが見つかりません。');
    expect(payload.sourceUrls?.[0]).toContain('/fins/summary');
  });

  test('renders cash-flow statements with free cash flow', async () => {
    global.fetch = (async () =>
      jsonResponse({
        data: [
          {
            DiscDate: '2024-05-14',
            DiscTime: '15:00:00',
            Code: '67580',
            DocType: '本決算短信',
            CurPerType: '通期',
            CurPerSt: '2023-04-01',
            CurPerEn: '2024-03-31',
            CFO: '1500000000000',
            CFI: '-600000000000',
            CFF: '-400000000000',
            DivAnn: '130',
          },
        ],
      })) as unknown as typeof fetch;

    const result = await getCashFlowStatements.invoke({ code: '6758', limit: 1 });
    const payload = parseToolPayload(result);

    expect(typeof payload.data).toBe('string');
    expect(payload.data).toContain('# 6758 キャッシュフロー計算書（直近1期）');
    expect(payload.data).toContain('| FCF（営業+投資） | 9000億円 |');
    expect(payload.data).toContain('年間配当: 130円/株');
  });

  test('prefers annual statements when mixed annual and quarterly records are available', async () => {
    global.fetch = (async () =>
      jsonResponse({
        data: [
          {
            DiscDate: '2026-02-13',
            DiscTime: '15:00:00',
            Code: '67580',
            DocType: '3Q決算短信',
            CurPerType: '3Q累計',
            CurPerSt: '2025-04-01',
            CurPerEn: '2025-12-31',
            Sales: '9400000000000',
            OP: '1300000000000',
            NP: '-409700000000',
            EqAR: '0.5',
          },
          {
            DiscDate: '2025-05-14',
            DiscTime: '15:00:00',
            Code: '67580',
            DocType: '本決算短信',
            CurPerType: 'FY',
            CurPerSt: '2024-04-01',
            CurPerEn: '2025-03-31',
            Sales: '13000000000000',
            OP: '1400000000000',
            NP: '1100000000000',
            EqAR: '45.0',
          },
          {
            DiscDate: '2024-05-14',
            DiscTime: '15:00:00',
            Code: '67580',
            DocType: '本決算短信',
            CurPerType: 'FY',
            CurPerSt: '2023-04-01',
            CurPerEn: '2024-03-31',
            Sales: '12500000000000',
            OP: '1300000000000',
            NP: '970000000000',
            EqAR: '46.9',
          },
        ],
      })) as unknown as typeof fetch;

    const result = await getAllFinancialStatements.invoke({ code: '6758', limit: 2 });
    const payload = parseToolPayload(result);

    expect(typeof payload.data).toBe('string');
    expect(payload.data).toContain('# 6758 財務諸表（直近2期）');
    expect(payload.data).toContain('### 通期 (2024/04/01〜2025/03/31)');
    expect(payload.data).toContain('### 通期 (2023/04/01〜2024/03/31)');
    expect(payload.data).not.toContain('### 3Q累計 (2025/04/01〜2025/12/31)');
    expect(payload.data).not.toContain('| 自己資本比率 | 0.5% |');
  });

  test('falls back to quarterly statements when annual statements are unavailable', async () => {
    global.fetch = (async () =>
      jsonResponse({
        data: [
          {
            DiscDate: '2025-03-14',
            DiscTime: '15:00:00',
            Code: '73780',
            DocType: '3Q決算短信',
            CurPerType: '3Q累計',
            CurPerSt: '2024-06-01',
            CurPerEn: '2025-02-28',
            Sales: '3500000000',
            OP: '500000000',
            NP: '320000000',
            EqAR: '38.4',
          },
          {
            DiscDate: '2024-12-16',
            DiscTime: '15:00:00',
            Code: '73780',
            DocType: '2Q決算短信',
            CurPerType: '2Q累計',
            CurPerSt: '2024-06-01',
            CurPerEn: '2024-11-30',
            Sales: '2200000000',
            OP: '300000000',
            NP: '180000000',
            EqAR: '37.2',
          },
        ],
      })) as unknown as typeof fetch;

    const result = await getIncomeStatements.invoke({ code: '7378', limit: 2 });
    const payload = parseToolPayload(result);

    expect(typeof payload.data).toBe('string');
    expect(payload.data).toContain('### 3Q累計 (2024/06/01〜2025/02/28)');
    expect(payload.data).toContain('### 2Q累計 (2024/06/01〜2024/11/30)');
  });
});
