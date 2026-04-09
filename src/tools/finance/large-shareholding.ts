import { DynamicStructuredTool } from '@langchain/core/tools';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import { dexterPath } from '../../utils/paths.js';
import { formatToolResult } from '../types.js';
import type { RawEdinetDoc } from './edinet-api.js';
import { fetchEdinetDocuments } from './edinet-api.js';
import { getAllListedIssues } from './listed-issues.js';
import { normalizeCode, resolveJpTickerFull } from './ticker.js';

export interface LargeShareholdingDoc {
  docID: string;
  submitDateTime: string;
  filerName: string;
  filerNameNorm: string;
  edinetCode: string;
  secCode: string | null;
  companyName: string;
  companyNameNorm: string;
  tickerCode: string | null;
  docDescription: string;
  docURL: string;
}

export interface SyncResult {
  dates_processed: string[];
  success_dates: string[];
  failed_dates: string[];
  fetched_count: number;
  saved_count: number;
  skipped_count: number;
  deduplicated_count: number;
  storage_paths: string[];
}

export interface QueryResult {
  docs: LargeShareholdingDoc[];
  coverage_dates: string[];
  missing_dates: string[];
}

export const SYNC_LARGE_SHAREHOLDING_DESCRIPTION =
  'EDINET から大量保有報告書のメタデータを取得し .dexter/large-shareholding/ に蓄積する。query の前に実行することで最新データを取得できる。';

function getStorageDir(): string {
  return process.env.LARGE_SHAREHOLDING_DIR ?? dexterPath('large-shareholding');
}

function getDayFilePath(date: string): string {
  return join(getStorageDir(), `${date}.json`);
}

function normalizeForSearch(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

function readDayFile(date: string): LargeShareholdingDoc[] | null {
  const filePath = getDayFilePath(date);
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as LargeShareholdingDoc[];
  } catch {
    logger.warn(`[large-shareholding] corrupt file for ${date}, will re-fetch`);
    return null;
  }
}

function writeDayFile(date: string, docs: LargeShareholdingDoc[]): string {
  const dir = getStorageDir();
  mkdirSync(dir, { recursive: true });

  const finalPath = getDayFilePath(date);
  const tempPath = `${finalPath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(docs, null, 2), 'utf-8');
  renameSync(tempPath, finalPath);
  return finalPath;
}

async function buildDoc(raw: RawEdinetDoc): Promise<LargeShareholdingDoc> {
  const tickerCode = raw.secCode ? normalizeCode(raw.secCode) : null;
  let companyName = raw.companyName;

  if (tickerCode && !companyName) {
    try {
      const { issues } = await getAllListedIssues();
      const match = issues.find((issue) => {
        const code = typeof issue.Code === 'string' ? normalizeCode(issue.Code) : '';
        return code === tickerCode;
      });
      companyName = match?.CoName ?? '';
    } catch {
      companyName = '';
    }
  }

  return {
    ...raw,
    secCode: raw.secCode,
    tickerCode,
    companyName,
    filerNameNorm: normalizeForSearch(raw.filerName),
    companyNameNorm: normalizeForSearch(companyName),
  };
}

function tokyoDateString(date: Date): string {
  return date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

function jstToday(): string {
  return tokyoDateString(new Date());
}

function generateDateRange(baseDate: string, days: number): string[] {
  const dates: string[] = [];
  const base = new Date(`${baseDate}T12:00:00+09:00`);

  for (let index = 0; index < days; index += 1) {
    const next = new Date(base.getTime() - index * 24 * 60 * 60 * 1000);
    dates.push(tokyoDateString(next));
  }

  return dates;
}

const SyncInputSchema = z.object({
  date: z.string().optional().describe('基準日 YYYY-MM-DD（省略時: 今日JST）'),
  days: z.number().int().min(1).max(30).default(1).describe('何日分遡るか（最大30）'),
});

export const syncLargeShareholding = new DynamicStructuredTool({
  name: 'sync_large_shareholding_reports',
  description: SYNC_LARGE_SHAREHOLDING_DESCRIPTION,
  schema: SyncInputSchema,
  func: async (input) => {
    const baseDate = input.date ?? jstToday();
    const dates = generateDateRange(baseDate, input.days);
    const result: SyncResult = {
      dates_processed: dates,
      success_dates: [],
      failed_dates: [],
      fetched_count: 0,
      saved_count: 0,
      skipped_count: 0,
      deduplicated_count: 0,
      storage_paths: [],
    };

    for (const date of dates) {
      const existing = readDayFile(date);
      if (existing !== null) {
        result.skipped_count += 1;
        continue;
      }

      try {
        logger.info(`[large-shareholding] syncing ${date}`);
        const rawDocs = await fetchEdinetDocuments(date);
        result.fetched_count += rawDocs.length;

        const seenDocIds = new Set<string>();
        const docs: LargeShareholdingDoc[] = [];
        let dedupCount = 0;

        for (const rawDoc of rawDocs) {
          if (seenDocIds.has(rawDoc.docID)) {
            dedupCount += 1;
            continue;
          }

          seenDocIds.add(rawDoc.docID);
          docs.push(await buildDoc(rawDoc));
        }

        result.deduplicated_count += dedupCount;
        result.saved_count += docs.length;
        result.success_dates.push(date);
        result.storage_paths.push(writeDayFile(date, docs));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`[large-shareholding] sync failed for ${date}: ${message}`);
        result.failed_dates.push(date);
      }
    }

    const summary =
      `大量保有報告書 sync 完了: ${result.success_dates.length}日成功 / ` +
      `${result.failed_dates.length}日失敗 / ${result.skipped_count}日スキップ / ` +
      `新規保存 ${result.saved_count}件`;

    return formatToolResult({ summary, ...result });
  },
});

const QueryInputSchema = z.object({
  company: z.string().optional().describe('銘柄コード / EDINET コード / 会社名（部分一致）'),
  submitter: z.string().optional().describe('提出者名（部分一致）'),
  days: z.number().int().min(1).max(90).default(7).describe('何日分遡るか（デフォルト 7）'),
  limit: z.number().int().min(1).max(200).default(50).describe('最大返却件数（デフォルト 50）'),
});

async function matchCompany(doc: LargeShareholdingDoc, query: string): Promise<boolean> {
  const trimmed = query.trim();
  const normalized = normalizeForSearch(query);
  const normalizedCode = /^\d{4,5}$/.test(trimmed.normalize('NFKC')) ? normalizeCode(trimmed) : trimmed;

  if (doc.edinetCode === trimmed) {
    return true;
  }
  if (doc.tickerCode && doc.tickerCode === normalizedCode) {
    return true;
  }
  if (doc.companyNameNorm && doc.companyNameNorm.includes(normalized)) {
    return true;
  }

  const resolved = await resolveJpTickerFull(query).catch(() => null);
  return Boolean(resolved && doc.tickerCode === resolved);
}

function matchSubmitter(doc: LargeShareholdingDoc, query: string): boolean {
  return doc.filerNameNorm.includes(normalizeForSearch(query));
}

function renderLargeShareholdingTable(docs: LargeShareholdingDoc[]): string {
  const lines = [
    '| 提出日 | 提出者 | 対象企業 | 証券コード | 書類 | URL |',
    '|---|---|---|---|---|---|',
  ];

  for (const doc of docs) {
    const date = doc.submitDateTime.slice(0, 10);
    const company = doc.companyName || doc.edinetCode;
    const ticker = doc.tickerCode ?? '—';
    lines.push(
      `| ${date} | ${doc.filerName} | ${company} | ${ticker} | ${doc.docDescription} | [EDINET](${doc.docURL}) |`,
    );
  }

  return lines.join('\n');
}

export const queryLargeShareholding = new DynamicStructuredTool({
  name: 'query_large_shareholding_reports',
  description:
    '蓄積済みの大量保有報告書メタデータを検索する。銘柄コード・会社名・提出者名で絞り込み、直近の履歴を返す。\n\n' +
    '注意: このツールは蓄積済みデータのみを読む。最新データが必要な場合は先に `sync_large_shareholding_reports` を実行すること。',
  schema: QueryInputSchema,
  func: async (input) => {
    const dates = generateDateRange(jstToday(), input.days);
    const allDocs: LargeShareholdingDoc[] = [];
    const coverageDates: string[] = [];
    const missingDates: string[] = [];

    for (const date of dates) {
      const docs = readDayFile(date);
      if (docs !== null) {
        allDocs.push(...docs);
        coverageDates.push(date);
      } else {
        missingDates.push(date);
      }
    }

    let filtered = allDocs;
    if (input.company) {
      const matches = await Promise.all(
        filtered.map(async (doc) => ({
          doc,
          match: await matchCompany(doc, input.company ?? ''),
        })),
      );
      filtered = matches.filter((entry) => entry.match).map((entry) => entry.doc);
    }

    if (input.submitter) {
      filtered = filtered.filter((doc) => matchSubmitter(doc, input.submitter ?? ''));
    }

    filtered.sort((left, right) => right.submitDateTime.localeCompare(left.submitDateTime));
    const docs = filtered.slice(0, input.limit);
    const queryResult: QueryResult = {
      docs,
      coverage_dates: coverageDates,
      missing_dates: missingDates,
    };
    const sourceUrls = [...new Set(docs.map((doc) => doc.docURL))];

    if (docs.length === 0) {
      const syncHint =
        missingDates.length > 0
          ? ` 未同期日が ${missingDates.length} 日あります。先に sync_large_shareholding_reports を実行してください。`
          : '';

      return formatToolResult(
        {
          message: `該当する大量保有報告書が見つかりませんでした。${syncHint}`.trim(),
          ...queryResult,
        },
        sourceUrls,
      );
    }

    return formatToolResult(
      {
        table: renderLargeShareholdingTable(docs),
        ...queryResult,
      },
      sourceUrls,
    );
  },
});
