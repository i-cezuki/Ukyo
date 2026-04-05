import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { queryLargeShareholding, syncLargeShareholding } from './large-shareholding.js';
import type { LargeShareholdingDoc } from './large-shareholding.js';

const ORIGINAL_EDINET_KEY = process.env.EDINET_API_KEY;
const ORIGINAL_JQUANTS_KEY = process.env.JQUANTS_API_KEY;
const ORIGINAL_STORAGE_DIR = process.env.LARGE_SHAREHOLDING_DIR;
const ORIGINAL_FETCH = global.fetch;
const TEST_DIR = '.dexter/test-large-shareholding';

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

function tokyoDateString(date: Date): string {
  return date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

function daysAgoInTokyo(days: number): string {
  return tokyoDateString(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
}

function makeSavedDoc(overrides: Partial<LargeShareholdingDoc> = {}): LargeShareholdingDoc {
  return {
    docID: 'S100TEST',
    submitDateTime: `${daysAgoInTokyo(0)} 09:00:00`,
    filerName: 'ブラックロック・ジャパン株式会社',
    filerNameNorm: 'ブラックロック・ジャパン株式会社',
    edinetCode: 'E02144',
    secCode: '72030',
    companyName: 'トヨタ自動車株式会社',
    companyNameNorm: 'トヨタ自動車株式会社',
    tickerCode: '7203',
    docDescription: '大量保有報告書',
    docURL: 'https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?S100TEST',
    ...overrides,
  };
}

function writeDayFile(date: string, docs: LargeShareholdingDoc[]): void {
  mkdirSync(TEST_DIR, { recursive: true });
  writeFileSync(join(TEST_DIR, `${date}.json`), JSON.stringify(docs, null, 2), 'utf-8');
}

describe('syncLargeShareholding', () => {
  beforeEach(() => {
    process.env.EDINET_API_KEY = 'test-edinet-key';
    delete process.env.JQUANTS_API_KEY;
    process.env.LARGE_SHAREHOLDING_DIR = TEST_DIR;
    mkdirSync(TEST_DIR, { recursive: true });
    global.fetch = ORIGINAL_FETCH;
  });

  afterEach(() => {
    if (ORIGINAL_EDINET_KEY !== undefined) {
      process.env.EDINET_API_KEY = ORIGINAL_EDINET_KEY;
    } else {
      delete process.env.EDINET_API_KEY;
    }
    if (ORIGINAL_JQUANTS_KEY !== undefined) {
      process.env.JQUANTS_API_KEY = ORIGINAL_JQUANTS_KEY;
    } else {
      delete process.env.JQUANTS_API_KEY;
    }
    if (ORIGINAL_STORAGE_DIR !== undefined) {
      process.env.LARGE_SHAREHOLDING_DIR = ORIGINAL_STORAGE_DIR;
    } else {
      delete process.env.LARGE_SHAREHOLDING_DIR;
    }
    global.fetch = ORIGINAL_FETCH;
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  test('fetches and stores a daily snapshot using secCode as ticker source', async () => {
    global.fetch = (async () =>
      jsonResponse({
        metadata: { resultset: { count: 2 } },
        results: [
          {
            docID: 'S100TEST',
            submitDateTime: '2026-04-03 09:00:00',
            filerName: 'ブラックロック・ジャパン株式会社',
            edinetCode: 'E09096',
            subjectEdinetCode: 'E02144',
            secCode: '72030',
            ordinanceCode: '28',
            formCode: '07600',
            docDescription: '大量保有報告書',
          },
          {
            docID: 'S100TEST',
            submitDateTime: '2026-04-03 09:00:00',
            filerName: 'ブラックロック・ジャパン株式会社',
            edinetCode: 'E09096',
            subjectEdinetCode: 'E02144',
            secCode: '72030',
            ordinanceCode: '28',
            formCode: '07601',
            docDescription: '変更報告書',
          },
        ],
      })) as unknown as typeof fetch;

    const result = await syncLargeShareholding.invoke({ date: '2026-04-03', days: 1 });
    const payload = parseToolPayload(result);
    const data = payload.data as {
      success_dates: string[];
      fetched_count: number;
      saved_count: number;
      deduplicated_count: number;
      storage_paths: string[];
    };

    expect(data.success_dates).toEqual(['2026-04-03']);
    expect(data.fetched_count).toBe(2);
    expect(data.saved_count).toBe(1);
    expect(data.deduplicated_count).toBe(1);
    expect(data.storage_paths).toHaveLength(1);

    const saved = JSON.parse(readFileSync(join(TEST_DIR, '2026-04-03.json'), 'utf-8')) as LargeShareholdingDoc[];
    expect(saved).toHaveLength(1);
    expect(saved[0]?.tickerCode).toBe('7203');
    expect(saved[0]?.secCode).toBe('72030');
    expect(saved[0]?.companyName).toBe('');
    expect(saved[0]?.docURL).toBe('https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?S100TEST');
  });

  test('skips cached dates without refetching', async () => {
    writeDayFile('2026-04-03', [makeSavedDoc({ submitDateTime: '2026-04-03 09:00:00' })]);

    global.fetch = (async () => {
      throw new Error('fetch should not be called');
    }) as unknown as typeof fetch;

    const result = await syncLargeShareholding.invoke({ date: '2026-04-03', days: 1 });
    const payload = parseToolPayload(result);
    const data = payload.data as { skipped_count: number; success_dates: string[] };

    expect(data.skipped_count).toBe(1);
    expect(data.success_dates).toHaveLength(0);
  });
});

describe('queryLargeShareholding', () => {
  beforeEach(() => {
    process.env.EDINET_API_KEY = 'test-edinet-key';
    delete process.env.JQUANTS_API_KEY;
    process.env.LARGE_SHAREHOLDING_DIR = TEST_DIR;
    mkdirSync(TEST_DIR, { recursive: true });
    global.fetch = (async () => {
      throw new Error('fetch should not be called');
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    if (ORIGINAL_EDINET_KEY !== undefined) {
      process.env.EDINET_API_KEY = ORIGINAL_EDINET_KEY;
    } else {
      delete process.env.EDINET_API_KEY;
    }
    if (ORIGINAL_JQUANTS_KEY !== undefined) {
      process.env.JQUANTS_API_KEY = ORIGINAL_JQUANTS_KEY;
    } else {
      delete process.env.JQUANTS_API_KEY;
    }
    if (ORIGINAL_STORAGE_DIR !== undefined) {
      process.env.LARGE_SHAREHOLDING_DIR = ORIGINAL_STORAGE_DIR;
    } else {
      delete process.env.LARGE_SHAREHOLDING_DIR;
    }
    global.fetch = ORIGINAL_FETCH;
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  test('filters by tickerCode exact match', async () => {
    const today = daysAgoInTokyo(0);
    writeDayFile(today, [
      makeSavedDoc({ tickerCode: '7203', secCode: '72030' }),
      makeSavedDoc({
        docID: 'S100OTHER',
        tickerCode: '6758',
        secCode: '67580',
        companyName: 'ソニーグループ株式会社',
        companyNameNorm: 'ソニーグループ株式会社',
      }),
    ]);

    const result = await queryLargeShareholding.invoke({ company: '7203', days: 1 });
    const payload = parseToolPayload(result);
    const data = payload.data as { docs: Array<{ docID: string }> };

    expect(data.docs).toHaveLength(1);
    expect(data.docs[0]?.docID).toBe('S100TEST');
  });

  test('filters by companyNameNorm partial match', async () => {
    const today = daysAgoInTokyo(0);
    writeDayFile(today, [
      makeSavedDoc({ companyNameNorm: 'トヨタ自動車株式会社' }),
      makeSavedDoc({
        docID: 'S100OTHER',
        companyName: 'ソニーグループ株式会社',
        companyNameNorm: 'ソニーグループ株式会社',
        tickerCode: '6758',
        secCode: '67580',
      }),
    ]);

    const result = await queryLargeShareholding.invoke({ company: 'トヨタ', days: 1 });
    const payload = parseToolPayload(result);
    const data = payload.data as { docs: Array<{ docID: string }> };

    expect(data.docs).toHaveLength(1);
    expect(data.docs[0]?.docID).toBe('S100TEST');
  });

  test('filters by filerNameNorm partial match', async () => {
    const today = daysAgoInTokyo(0);
    writeDayFile(today, [
      makeSavedDoc({ filerNameNorm: 'ブラックロック・ジャパン株式会社' }),
      makeSavedDoc({ docID: 'S100OTHER', filerNameNorm: 'バンガード・グループ' }),
    ]);

    const result = await queryLargeShareholding.invoke({ submitter: 'ブラックロック', days: 1 });
    const payload = parseToolPayload(result);
    const data = payload.data as { docs: Array<{ docID: string }> };

    expect(data.docs).toHaveLength(1);
    expect(data.docs[0]?.docID).toBe('S100TEST');
  });

  test('applies AND condition when both company and submitter are specified', async () => {
    const today = daysAgoInTokyo(0);
    writeDayFile(today, [
      makeSavedDoc({ tickerCode: '7203', filerNameNorm: 'ブラックロック・ジャパン株式会社' }),
      makeSavedDoc({ docID: 'S100B', tickerCode: '7203', filerNameNorm: 'バンガード・グループ' }),
      makeSavedDoc({ docID: 'S100C', tickerCode: '6758', filerNameNorm: 'ブラックロック・ジャパン株式会社' }),
    ]);

    const result = await queryLargeShareholding.invoke({
      company: '7203',
      submitter: 'ブラックロック',
      days: 1,
    });
    const payload = parseToolPayload(result);
    const data = payload.data as { docs: Array<{ docID: string }> };

    expect(data.docs).toHaveLength(1);
    expect(data.docs[0]?.docID).toBe('S100TEST');
  });

  test('respects limit parameter', async () => {
    const today = daysAgoInTokyo(0);
    const docs = Array.from({ length: 20 }, (_, index) =>
      makeSavedDoc({
        docID: `S100${String(index).padStart(3, '0')}`,
        submitDateTime: `${today} ${String(20 - index).padStart(2, '0')}:00:00`,
      }),
    );
    writeDayFile(today, docs);

    const result = await queryLargeShareholding.invoke({ days: 1, limit: 5 });
    const payload = parseToolPayload(result);
    const data = payload.data as { docs: unknown[] };

    expect(data.docs).toHaveLength(5);
  });

  test('returns missing_dates for unsynced days without auto-sync', async () => {
    const today = daysAgoInTokyo(0);
    writeDayFile(today, [makeSavedDoc({ submitDateTime: `${today} 09:00:00` })]);

    const result = await queryLargeShareholding.invoke({ days: 2 });
    const payload = parseToolPayload(result);
    const data = payload.data as {
      coverage_dates: string[];
      missing_dates: string[];
      docs: Array<{ docID: string }>;
    };

    expect(data.docs).toHaveLength(1);
    expect(data.coverage_dates).toContain(today);
    expect(data.missing_dates).toHaveLength(1);
  });

  test('returns a no-match message when nothing matches', async () => {
    const today = daysAgoInTokyo(0);
    writeDayFile(today, []);

    const result = await queryLargeShareholding.invoke({ company: '任天堂', days: 1 });
    const payload = parseToolPayload(result);
    const data = payload.data as { message?: string; docs: unknown[] };

    expect(data.docs).toHaveLength(0);
    expect(data.message).toContain('該当する大量保有報告書が見つかりませんでした');
  });
});
