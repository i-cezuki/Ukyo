import { describeRequest, readCache, writeCache } from '../../utils/cache.js';
import { logger } from '../../utils/logger.js';

const BASE_URL = 'https://api.jquants.com/v2';

type ParamValue = string | number | string[] | undefined;
type Params = Record<string, ParamValue>;

export interface GetOptions {
  cacheable?: boolean;
  ttlMs?: number;
  arrayKey?: string;
}

export interface ApiResponse<T = Record<string, unknown>> {
  data: T;
  url: string;
}

/**
 * Remove redundant fields from API payloads before they are returned to the LLM.
 * This reduces token usage while preserving the financial metrics needed for analysis.
 */
export function stripFieldsDeep(value: unknown, fields: readonly string[]): unknown {
  const fieldsToStrip = new Set(fields);

  function walk(node: unknown): unknown {
    if (Array.isArray(node)) {
      return node.map(walk);
    }

    if (!node || typeof node !== 'object') {
      return node;
    }

    const record = node as Record<string, unknown>;
    const cleaned: Record<string, unknown> = {};

    for (const [key, child] of Object.entries(record)) {
      if (fieldsToStrip.has(key)) {
        continue;
      }
      cleaned[key] = walk(child);
    }

    return cleaned;
  }

  return walk(value);
}

function getApiKey(): string {
  const apiKey = process.env.JQUANTS_API_KEY;
  if (!apiKey) {
    throw new Error(
      'J-Quants API key is not configured. Set JQUANTS_API_KEY in your environment.',
    );
  }
  return apiKey;
}

function buildUrl(endpoint: string, params: Params): string {
  const url = new URL(`${BASE_URL}${endpoint}`);

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, item);
      }
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

async function executeRequest<T>(
  apiKey: string,
  url: string,
  label: string,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  const headers = new Headers(init.headers);
  headers.set('x-api-key', apiKey);

  try {
    response = await fetch(url, {
      ...init,
      headers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[J-Quants API] network error: ${label} - ${message}`);
    throw new Error(`[J-Quants API] request failed for ${label}: ${message}`);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => `${response.status} ${response.statusText}`);
    logger.error(`[J-Quants API] error: ${label} - ${response.status}`);
    throw new Error(`[J-Quants API] request failed: ${response.status} ${detail}`);
  }

  const data = await response.json().catch(() => {
    const detail = `invalid JSON (${response.status} ${response.statusText})`;
    logger.error(`[J-Quants API] parse error: ${label} - ${detail}`);
    throw new Error(`[J-Quants API] request failed: ${detail}`);
  });

  return data as T;
}

async function fetchAllPages(
  apiKey: string,
  endpoint: string,
  params: Params,
  arrayKey: string,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let paginationKey: string | undefined;

  do {
    const pageParams: Params = paginationKey
      ? { ...params, pagination_key: paginationKey }
      : { ...params };
    const url = buildUrl(endpoint, pageParams);
    const label = describeRequest(endpoint, pageParams);
    const data = await executeRequest<Record<string, unknown>>(apiKey, url, label);
    const items = data[arrayKey];

    if (Array.isArray(items)) {
      results.push(...items);
    }

    paginationKey =
      typeof data.pagination_key === 'string' && data.pagination_key.length > 0
        ? data.pagination_key
        : undefined;
  } while (paginationKey);

  return results;
}

export const api = {
  async get<T = Record<string, unknown>>(
    endpoint: string,
    params: Params = {},
    options?: GetOptions,
  ): Promise<ApiResponse<T>> {
    const apiKey = getApiKey();
    const label = describeRequest(endpoint, params);
    const url = buildUrl(endpoint, params);

    if (options?.cacheable) {
      const cached = readCache(endpoint, params, options.ttlMs);
      if (cached) {
        return { data: cached.data as T, url: cached.url ?? url };
      }
    }

    let data: T;
    if (options?.arrayKey) {
      const items = await fetchAllPages(apiKey, endpoint, params, options.arrayKey);
      data = { [options.arrayKey]: items } as T;
    } else {
      data = await executeRequest<T>(apiKey, url, label);
    }

    if (options?.cacheable) {
      writeCache(endpoint, params, data as Record<string, unknown>, url);
    }

    return { data, url };
  },

  async post<T = Record<string, unknown>>(
    endpoint: string,
    body: unknown,
  ): Promise<ApiResponse<T>> {
    const apiKey = getApiKey();
    const url = `${BASE_URL}${endpoint}`;
    const data = await executeRequest<T>(apiKey, url, `POST ${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    return { data, url };
  },
};

/** @deprecated Use `api.get` instead */
export const callApi = api.get;
