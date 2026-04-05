import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { api } from './api.js';
import { canonicalizeCompanyKey, normalizeCode } from './ticker.js';
import { TTL_24H } from './utils.js';

type ListedIssue = {
  Date?: string;
  Code?: string;
  CoName?: string;
  CoNameEn?: string;
  S17?: string;
  S17Nm?: string;
  S33?: string;
  S33Nm?: string;
  ScaleCat?: string;
  Mkt?: string;
  MktNm?: string;
  Mrgn?: string;
  MrgnNm?: string;
};

type ListedIssuesResponse = {
  data?: ListedIssue[];
};

type ListedIssuesCache = {
  issues: ListedIssue[];
  url: string;
};

let allIssuesCache: ListedIssuesCache | null = null;
let allIssuesPromise: Promise<ListedIssuesCache> | null = null;

const MARKET_FILTERS = {
  prime: ['prime', 'プライム'],
  standard: ['standard', 'スタンダード'],
  growth: ['growth', 'グロース'],
} as const;

function canonicalizeText(value: string | undefined): string {
  return canonicalizeCompanyKey(value ?? '');
}

function normalizeMarketFilter(value: string | undefined): keyof typeof MARKET_FILTERS | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'prime' || normalized === 'プライム') return 'prime';
  if (normalized === 'standard' || normalized === 'スタンダード') return 'standard';
  if (normalized === 'growth' || normalized === 'グロース') return 'growth';
  return null;
}

function getIssueSearchScore(issue: ListedIssue, query: string): number {
  if (!query) {
    return 0;
  }

  const companyName = canonicalizeText(issue.CoName);
  const companyNameEn = canonicalizeText(issue.CoNameEn);
  const sectorName = canonicalizeText(issue.S33Nm);
  const marketName = canonicalizeText(issue.MktNm);

  if (companyName === query || companyNameEn === query) return 100;
  if (companyName.startsWith(query) || companyNameEn.startsWith(query)) return 70;
  if (companyName.includes(query) || companyNameEn.includes(query)) return 50;
  if (sectorName.includes(query)) return 20;
  if (marketName.includes(query)) return 10;
  return 0;
}

async function loadAllIssues(): Promise<ListedIssuesCache> {
  const { data, url } = await api.get<ListedIssuesResponse>(
    '/equities/master',
    {},
    {
      cacheable: true,
      ttlMs: TTL_24H,
      arrayKey: 'data',
    },
  );

  const issues = Array.isArray(data.data) ? data.data : [];
  const cacheEntry = { issues, url };
  allIssuesCache = cacheEntry;
  allIssuesPromise = null;
  return cacheEntry;
}

export async function getAllListedIssues(): Promise<ListedIssuesCache> {
  if (allIssuesCache) {
    return allIssuesCache;
  }

  if (!allIssuesPromise) {
    allIssuesPromise = loadAllIssues().catch((error) => {
      allIssuesPromise = null;
      throw error;
    });
  }

  return allIssuesPromise;
}

export async function resolveTickerFromMaster(companyName: string): Promise<string | null> {
  const query = canonicalizeText(companyName);
  if (!query) {
    return null;
  }

  const { issues } = await getAllListedIssues();
  const matches = issues
    .map((issue) => ({ issue, score: getIssueSearchScore(issue, query) }))
    .filter((entry) => entry.score >= 50)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return (left.issue.Code ?? '').localeCompare(right.issue.Code ?? '');
    });

  const first = matches[0]?.issue;
  return first?.Code ? normalizeCode(first.Code) : null;
}

export function resetListedIssuesCacheForTests(): void {
  allIssuesCache = null;
  allIssuesPromise = null;
}

const ListedIssuesInputSchema = z.object({
  query: z.string().describe('会社名・英語名・業種などのキーワード'),
  market: z
    .enum(['', 'prime', 'standard', 'growth', 'プライム', 'スタンダード', 'グロース'])
    .optional()
    .describe('市場区分フィルター'),
});

export const getListedIssues = new DynamicStructuredTool({
  name: 'get_listed_issues',
  description:
    '東証上場銘柄の一覧を検索する。会社名・英語名・業種・市場区分で検索できる。証券コードと会社名の対応を調べるときに使う。',
  schema: ListedIssuesInputSchema,
  func: async (input) => {
    const query = canonicalizeText(input.query);
    const marketFilter = normalizeMarketFilter(input.market);
    const { issues, url } = await getAllListedIssues();

    let matches = issues
      .map((issue) => ({ issue, score: getIssueSearchScore(issue, query) }))
      .filter((entry) => entry.score > 0);

    if (marketFilter) {
      matches = matches.filter((entry) => {
        const marketName = (entry.issue.MktNm ?? '').toLowerCase();
        return MARKET_FILTERS[marketFilter].some((candidate) =>
          marketName.includes(candidate.toLowerCase()),
        );
      });
    }

    matches.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return (left.issue.Code ?? '').localeCompare(right.issue.Code ?? '');
    });

    if (matches.length === 0) {
      return formatToolResult(`"${input.query}" に該当する上場銘柄が見つかりません。`, [url]);
    }

    const rows = matches
      .slice(0, 15)
      .map(({ issue }) => {
        const code = normalizeCode(issue.Code ?? '—');
        return `| ${code} | ${issue.CoName ?? '—'} | ${issue.CoNameEn ?? '—'} | ${issue.S33Nm ?? '—'} | ${issue.MktNm ?? '—'} |`;
      })
      .join('\n');

    return formatToolResult(
      `## 上場銘柄検索結果: "${input.query}"（${matches.length}件、上位15件表示）

| コード | 会社名 | 英語名 | 業種 | 市場 |
|--------|--------|--------|------|------|
${rows}`,
      [url],
    );
  },
});
