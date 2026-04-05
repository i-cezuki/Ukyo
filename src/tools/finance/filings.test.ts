import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { get8KFilingItems, get10KFilingItems, get10QFilingItems, getFilings } from './filings.js';

const ORIGINAL_API_KEY = process.env.JQUANTS_API_KEY;
const ORIGINAL_FETCH = global.fetch;

function parseToolPayload(result: unknown): { data: unknown; sourceUrls?: string[] } {
  expect(typeof result).toBe('string');
  return JSON.parse(result as string) as { data: unknown; sourceUrls?: string[] };
}

describe('filings tools', () => {
  beforeEach(() => {
    process.env.JQUANTS_API_KEY = 'test-key-123';
    global.fetch = (async () => {
      throw new Error('fetch should not be called');
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    if (ORIGINAL_API_KEY !== undefined) {
      process.env.JQUANTS_API_KEY = ORIGINAL_API_KEY;
    } else {
      delete process.env.JQUANTS_API_KEY;
    }
    global.fetch = ORIGINAL_FETCH;
  });

  test('returns EDINET-first search guidance for annual reports', async () => {
    const result = await getFilings.invoke({
      code: 'ソニーグループ',
      filing_type: 'annual_report',
    });
    const payload = parseToolPayload(result);

    expect(typeof payload.data).toBe('string');
    expect(payload.data).toContain('## IR書類検索ガイド');
    expect(payload.data).toContain('ソニーグループ (6758)');
    expect(payload.data).toContain('site:disclosure.edinet-fsa.go.jp 有価証券報告書');
  });

  test('legacy filing aliases point to the same tool instance', () => {
    expect(get10KFilingItems).toBe(getFilings);
    expect(get10QFilingItems).toBe(getFilings);
    expect(get8KFilingItems).toBe(getFilings);
  });
});
