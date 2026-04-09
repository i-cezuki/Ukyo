import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { fetchEdinetDocuments } from './edinet-api.js';

const ORIGINAL_EDINET_KEY = process.env.EDINET_API_KEY;
const ORIGINAL_FETCH = global.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeEdinetResult(
  overrides: Partial<{
    docID: string;
    ordinanceCode: string;
    formCode: string;
    filerName: string;
    edinetCode: string;
    subjectEdinetCode: string | null;
    secCode: string | null;
    submitDateTime: string;
    docDescription: string;
  }> = {},
): object {
  return {
    docID: 'S100TEST',
    seqNumber: 1,
    edinetCode: 'E99001',
    type: '2',
    ordinanceCode: '28',
    formCode: '07600',
    issuerEdinetCode: null,
    subjectEdinetCode: 'E12345',
    secCode: '72030',
    subsidiaryEdinetCode: null,
    currentReportReason: null,
    parentDocID: null,
    opeDateTime: null,
    withdrawalStatus: '0',
    docInfoEditStatus: '0',
    disclosureStatus: '0',
    xbrlFlag: '1',
    pdfFlag: '1',
    attachDocFlag: '0',
    englishDocFlag: '0',
    csvFlag: '1',
    legalStatus: '0',
    submitDateTime: '2026-04-03 09:00:00',
    docDescription: '大量保有報告書',
    issuerName: null,
    filerName: 'BlackRock Japan Co., Ltd.',
    ...overrides,
  };
}

function makeEdinetResponse(results: object[]): object {
  return {
    metadata: { title: '提出書類一覧', resultset: { count: results.length } },
    results,
  };
}

describe('EDINET API client', () => {
  beforeEach(() => {
    process.env.EDINET_API_KEY = 'test-edinet-key';
    global.fetch = ORIGINAL_FETCH;
  });

  afterEach(() => {
    if (ORIGINAL_EDINET_KEY !== undefined) {
      process.env.EDINET_API_KEY = ORIGINAL_EDINET_KEY;
    } else {
      delete process.env.EDINET_API_KEY;
    }
    global.fetch = ORIGINAL_FETCH;
  });

  test('throws when EDINET_API_KEY is not set', async () => {
    delete process.env.EDINET_API_KEY;

    await expect(fetchEdinetDocuments('2026-04-03')).rejects.toThrow('EDINET_API_KEY');
  });

  test('returns RawEdinetDoc[] for ordinanceCode 28 results', async () => {
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('/documents.json');
      expect(url).toContain('date=2026-04-03');
      expect(url).toContain('type=2');
      expect(url).toContain('Subscription-Key=test-edinet-key');

      return jsonResponse(
        makeEdinetResponse([
          makeEdinetResult(),
          makeEdinetResult({
            docID: 'S100OTHER',
            ordinanceCode: '010',
            formCode: '03000',
            docDescription: '有価証券報告書',
          }),
        ]),
      );
    }) as unknown as typeof fetch;

    const docs = await fetchEdinetDocuments('2026-04-03');

    expect(docs).toHaveLength(1);
    expect(docs[0]).toEqual({
      docID: 'S100TEST',
      submitDateTime: '2026-04-03 09:00:00',
      filerName: 'BlackRock Japan Co., Ltd.',
      edinetCode: 'E12345',
      secCode: '72030',
      companyName: '',
      docDescription: '大量保有報告書',
      docURL: 'https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?S100TEST',
    });
  });

  test('retries on transient 503 responses', async () => {
    let attempts = 0;

    global.fetch = (async () => {
      attempts += 1;
      if (attempts === 1) {
        return jsonResponse({ error: 'busy' }, 503);
      }

      return jsonResponse(makeEdinetResponse([makeEdinetResult()]));
    }) as unknown as typeof fetch;

    const docs = await fetchEdinetDocuments('2026-04-03');

    expect(attempts).toBe(2);
    expect(docs).toHaveLength(1);
  });

  test('does not retry on 401 responses', async () => {
    let attempts = 0;

    global.fetch = (async () => {
      attempts += 1;
      return jsonResponse(
        {
          statusCode: 401,
          message:
            'Access denied due to invalid subscription key.Make sure to provide a valid key for an active subscription.',
        },
        401,
      );
    }) as unknown as typeof fetch;

    await expect(fetchEdinetDocuments('2026-04-03')).rejects.toThrow('401');
    expect(attempts).toBe(1);
  });

  test('treats 200 responses with statusCode 401 payloads as auth failures', async () => {
    let attempts = 0;

    global.fetch = (async () => {
      attempts += 1;
      return jsonResponse({
        statusCode: 401,
        message:
          'Access denied due to invalid subscription key.Make sure to provide a valid key for an active subscription.',
      });
    }) as unknown as typeof fetch;

    await expect(fetchEdinetDocuments('2026-04-03')).rejects.toThrow('401');
    expect(attempts).toBe(1);
  });
});
