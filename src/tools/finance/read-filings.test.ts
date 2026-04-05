import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createReadFilings, READ_FILINGS_DESCRIPTION } from './read-filings.js';

const ORIGINAL_API_KEY = process.env.JQUANTS_API_KEY;
const ORIGINAL_FETCH = global.fetch;

function parseToolPayload(result: unknown): { data: unknown; sourceUrls?: string[] } {
  expect(typeof result).toBe('string');
  return JSON.parse(result as string) as { data: unknown; sourceUrls?: string[] };
}

describe('read filings tool', () => {
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

  test('exposes the Japanese IR description', () => {
    expect(READ_FILINGS_DESCRIPTION).toContain('EDINET');
    expect(READ_FILINGS_DESCRIPTION).toContain('TDnet');
  });

  test('returns EDINET / TDnet / IR search guidance with optional topic', async () => {
    const tool = createReadFilings();
    const result = await tool.invoke({
      company: 'トヨタ',
      filing_type: '有価証券報告書',
      topic: '事業リスク',
    });
    const payload = parseToolPayload(result);

    expect(typeof payload.data).toBe('string');
    expect(payload.data).toContain('## IR書類読み込みガイド');
    expect(payload.data).toContain('トヨタ(7203)');
    expect(payload.data).toContain('"トヨタ 有価証券報告書 事業リスク site:disclosure.edinet-fsa.go.jp"');
    expect(payload.data).toContain('EDINET > TDnet > 公式IR > 二次メディア');
  });
});
