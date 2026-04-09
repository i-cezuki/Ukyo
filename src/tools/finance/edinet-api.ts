import { logger } from '../../utils/logger.js';

const EDINET_BASE_URL = 'https://api.edinet-fsa.go.jp/api/v2';
const NO_RETRY_STATUSES = new Set([400, 401, 403, 404]);
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500;

export interface RawEdinetDoc {
  docID: string;
  submitDateTime: string;
  filerName: string;
  edinetCode: string;
  secCode: string | null;
  companyName: string;
  docDescription: string;
  docURL: string;
}

interface EdinetRawResult {
  docID: string;
  submitDateTime: string;
  filerName: string;
  edinetCode: string;
  subjectEdinetCode: string | null;
  secCode: string | null;
  ordinanceCode: string;
  formCode: string;
  docDescription: string;
}

interface EdinetDocumentsResponse {
  statusCode?: number;
  message?: string;
  metadata?: { resultset?: { count?: number } };
  results?: EdinetRawResult[];
}

function getApiKey(): string {
  const apiKey = process.env.EDINET_API_KEY;
  if (!apiKey) {
    throw new Error('EDINET_API_KEY is not configured. Set EDINET_API_KEY in your environment.');
  }
  return apiKey;
}

function buildDocumentsUrl(date: string, apiKey: string): string {
  const url = new URL(`${EDINET_BASE_URL}/documents.json`);
  url.searchParams.set('date', date);
  url.searchParams.set('type', '2');
  url.searchParams.set('Subscription-Key', apiKey);
  return url.toString();
}

function buildViewerUrl(docID: string): string {
  return `https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?${docID}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getStatusFromPayload(payload: EdinetDocumentsResponse): number | null {
  return typeof payload.statusCode === 'number' ? payload.statusCode : null;
}

function toError(status: number, detail: string): Error {
  return new Error(`[EDINET API] ${status} ${detail}`);
}

function toRawDoc(raw: EdinetRawResult): RawEdinetDoc {
  return {
    docID: raw.docID,
    submitDateTime: raw.submitDateTime,
    filerName: raw.filerName,
    edinetCode: raw.subjectEdinetCode ?? raw.edinetCode,
    secCode: raw.secCode ?? null,
    companyName: '',
    docDescription: raw.docDescription,
    docURL: buildViewerUrl(raw.docID),
  };
}

async function requestDocuments(url: string): Promise<EdinetDocumentsResponse> {
  const response = await fetch(url);
  const payload = (await response.json().catch(() => {
    throw new Error('[EDINET API] invalid JSON response');
  })) as EdinetDocumentsResponse;

  const payloadStatus = getStatusFromPayload(payload);
  if (!response.ok || (payloadStatus !== null && payloadStatus >= 400)) {
    const status = payloadStatus ?? response.status;
    const detail = payload.message ?? response.statusText;
    throw toError(status, detail);
  }

  return payload;
}

async function fetchWithRetry(url: string): Promise<EdinetDocumentsResponse> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await requestDocuments(url);
    } catch (error) {
      const asError = error instanceof Error ? error : new Error(String(error));
      const status = Number(asError.message.match(/\b(\d{3})\b/)?.[1] ?? 0);
      lastError = asError;

      if (NO_RETRY_STATUSES.has(status) || attempt === MAX_RETRIES) {
        throw asError;
      }

      const waitMs = INITIAL_BACKOFF_MS * 2 ** (attempt - 1);
      logger.warn(`[EDINET API] attempt ${attempt} failed (${status || 'error'}), retrying in ${waitMs}ms`);
      await sleep(waitMs);
    }
  }

  throw lastError ?? new Error('[EDINET API] request failed');
}

export async function fetchEdinetDocuments(date: string): Promise<RawEdinetDoc[]> {
  const apiKey = getApiKey();
  const url = buildDocumentsUrl(date, apiKey);

  logger.info(`[EDINET API] fetch start: ${date}`);
  const payload = await fetchWithRetry(url);
  const results = Array.isArray(payload.results) ? payload.results : [];
  const filtered = results.filter((result) => result.ordinanceCode === '28');
  logger.info(`[EDINET API] fetch done: ${date} -> ${filtered.length} large-shareholding docs`);

  return filtered.map(toRawDoc);
}
