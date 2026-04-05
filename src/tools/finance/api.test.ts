import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { api } from './api.js';

const ORIGINAL_API_KEY = process.env.JQUANTS_API_KEY;
const ORIGINAL_FETCH = global.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('J-Quants API client', () => {
  beforeEach(() => {
    process.env.JQUANTS_API_KEY = 'test-key-123';
    global.fetch = ORIGINAL_FETCH;
  });

  afterEach(() => {
    if (ORIGINAL_API_KEY === undefined) {
      delete process.env.JQUANTS_API_KEY;
    } else {
      process.env.JQUANTS_API_KEY = ORIGINAL_API_KEY;
    }
    global.fetch = ORIGINAL_FETCH;
  });

  test('throws when JQUANTS_API_KEY is not set', async () => {
    delete process.env.JQUANTS_API_KEY;

    await expect(api.get('/equities/bars/daily', { code: '7203' })).rejects.toThrow(
      'JQUANTS_API_KEY',
    );
  });

  test('sends x-api-key header', async () => {
    const requests: RequestInit[] = [];

    global.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(init ?? {});
      return jsonResponse({ quotes: [] });
    }) as typeof fetch;

    await api.get('/equities/bars/daily', { code: '7203' });

    const headers = new Headers(requests[0]?.headers);
    expect(headers.get('x-api-key')).toBe('test-key-123');
  });

  test('preserves array query params for legacy callers', async () => {
    let requestedUrl = '';

    global.fetch = (async (url: string | URL | Request) => {
      requestedUrl = String(url);
      return jsonResponse({ items: [] });
    }) as typeof fetch;

    const response = await api.get('/filings/items', {
      ticker: '7203',
      item: ['Item-1', 'Item-7'],
    });

    const url = new URL(requestedUrl);
    expect(response.url).toBe(requestedUrl);
    expect(url.searchParams.getAll('item')).toEqual(['Item-1', 'Item-7']);
  });

  test('propagates network errors from fetch', async () => {
    global.fetch = (async () => {
      throw new Error('socket hang up');
    }) as unknown as typeof fetch;

    await expect(api.get('/equities/bars/daily', { code: '7203' })).rejects.toThrow(
      'socket hang up',
    );
  });

  test('throws on non-ok HTTP responses', async () => {
    global.fetch = (async () =>
      new Response('rate limit', {
        status: 429,
        statusText: 'Too Many Requests',
      })) as unknown as typeof fetch;

    await expect(api.get('/equities/bars/daily', { code: '7203' })).rejects.toThrow(
      '429 rate limit',
    );
  });

  test('throws when the response body is not valid JSON', async () => {
    global.fetch = (async () =>
      new Response('not-json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch;

    await expect(api.get('/equities/bars/daily', { code: '7203' })).rejects.toThrow(
      'invalid JSON',
    );
  });

  test('fetches all pages when arrayKey is provided', async () => {
    const requestedUrls: string[] = [];
    let callCount = 0;

    global.fetch = (async (url: string | URL | Request) => {
      requestedUrls.push(String(url));
      callCount += 1;

      if (callCount === 1) {
        return jsonResponse({
          listed_info: [{ code: '7203' }],
          pagination_key: 'page-2',
        });
      }

      return jsonResponse({
        listed_info: [{ code: '6758' }],
      });
    }) as typeof fetch;

    const { data } = await api.get<{ listed_info: Array<{ code: string }> }>(
      '/listed/info',
      { date: '20250101' },
      { arrayKey: 'listed_info' },
    );

    expect(data.listed_info).toEqual([{ code: '7203' }, { code: '6758' }]);
    expect(requestedUrls).toHaveLength(2);
    expect(new URL(requestedUrls[1]!).searchParams.get('pagination_key')).toBe('page-2');
  });
});
