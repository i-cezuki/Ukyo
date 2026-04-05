import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getInsiderHoldings } from './insider-holdings.js';

const ORIGINAL_API_KEY = process.env.JQUANTS_API_KEY;
const ORIGINAL_FETCH = global.fetch;

function parseToolPayload(result: unknown): { data: unknown; sourceUrls?: string[] } {
  expect(typeof result).toBe('string');
  return JSON.parse(result as string) as { data: unknown; sourceUrls?: string[] };
}

describe('insider holdings tool', () => {
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

  test('returns EDINET-based search guidance for holdings reports', async () => {
    const result = await getInsiderHoldings.invoke({
      company: '任天堂',
      report_type: '大量保有報告書',
    });
    const payload = parseToolPayload(result);

    expect(typeof payload.data).toBe('string');
    expect(payload.data).toContain('## 大量保有報告書ガイド');
    expect(payload.data).toContain('任天堂(7974)');
    expect(payload.data).toContain('5%ルール 大量保有 EDINET');
    expect(payload.data).toContain('保有目的');
  });
});
