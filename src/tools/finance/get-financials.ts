import { DynamicStructuredTool, StructuredToolInterface } from '@langchain/core/tools';
import type { RunnableConfig } from '@langchain/core/runnables';
import { AIMessage, ToolCall } from '@langchain/core/messages';
import { z } from 'zod';
import { callLlm } from '../../model/llm.js';
import { getCurrentDate } from '../../agent/prompts.js';
import { formatToolResult } from '../types.js';
import { FINANCIAL_FORMATTERS } from './formatters.js';
import { getEarnings } from './earnings.js';
import { getAllFinancialStatements } from './fundamentals.js';
import { getKeyRatios } from './key-ratios.js';
import { getListedIssues } from './listed-issues.js';
import { SUB_TOOL_TIMEOUT_MS, withTimeout } from './utils.js';

export const GET_FINANCIALS_DESCRIPTION = `
日本株の財務データを取得するメタツール。自然言語クエリを解析し、適切な財務サブツールを自動選択して実行する。

## 使うべきとき

- 財務3表（損益計算書・貸借対照表・キャッシュフロー計算書）の取得
- PBR・ROE・配当利回りなど投資指標の確認
- 決算発表スケジュールの確認
- 上場銘柄の基本情報（業種・市場区分・証券コード）の検索

## 使うべきでないとき

- 株価・出来高・信用残・投資家別売買動向（get_market_data を使う）
- 大量保有報告書や保有者動向（get_market_data を使う）
- 有価証券報告書の定性情報の読み込み（read_filings を使う）

## 使い方

自然言語で完全なクエリを渡す。証券コード解決と日付推論はツール内部で処理する。
`.trim();

const JP_TICKER_EXAMPLES = `
証券コードへの変換例:
- トヨタ / トヨタ自動車 / Toyota → 7203
- ソニー / ソニーグループ / Sony → 6758
- 三菱UFJ / MUFG / 三菱UFJフィナンシャルグループ → 8306
- ソフトバンク / SoftBank / ソフトバンクグループ → 9984
- キーエンス / Keyence → 6861
- 任天堂 / Nintendo → 7974
- ホンダ / 本田技研 / Honda → 7267
- NTT / 日本電信電話 → 9432
4桁の数字はそのまま証券コードとして使用する。
`.trim();

function formatSubToolName(name: string): string {
  return name
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function parseSubToolResult(rawResult: unknown): { data: unknown; sourceUrls: string[] } {
  const result = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);

  try {
    const parsed = JSON.parse(result) as { data?: unknown; sourceUrls?: unknown };
    const sourceUrls = Array.isArray(parsed.sourceUrls)
      ? parsed.sourceUrls.filter((url): url is string => typeof url === 'string')
      : [];
    return {
      data: Object.prototype.hasOwnProperty.call(parsed, 'data') ? parsed.data : parsed,
      sourceUrls,
    };
  } catch {
    return {
      data: result,
      sourceUrls: [],
    };
  }
}

function buildResultKey(toolName: string, args: Record<string, unknown>): string {
  const suffix = [args.code, args.ticker, args.company, args.query]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    ?.trim();
  return suffix ? `${toolName}_${suffix}` : toolName;
}

const FINANCE_TOOLS: StructuredToolInterface[] = [
  getAllFinancialStatements,
  getKeyRatios,
  getEarnings,
  getListedIssues,
];

const FINANCE_TOOL_MAP = new Map(FINANCE_TOOLS.map((tool) => [tool.name, tool]));

function buildRouterPrompt(): string {
  return `あなたは日本株財務データのルーターです。
現在日付: ${getCurrentDate()}

ユーザーの自然言語クエリを解析し、適切なサブツールを選択して財務データを取得してください。

証券コード解決:
${JP_TICKER_EXAMPLES}

利用可能なツール:
- get_all_financial_statements: 財務3表（PL・BS・CF）の取得
- get_key_ratios: PBR・ROE・配当利回りなどの投資指標計算
- get_earnings: 決算発表スケジュールの確認
- get_listed_issues: 上場銘柄マスター検索

回答は日本語で、金額は「億円」「兆円」単位を優先して扱う。必要なツールだけを選んで実行すること。`;
}

const GetFinancialsInputSchema = z.object({
  query: z.string().describe('財務データに関する自然言語クエリ'),
});

export function createGetFinancials(model: string): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'get_financials',
    description: GET_FINANCIALS_DESCRIPTION,
    schema: GetFinancialsInputSchema,
    func: async (input, _runManager, config?: RunnableConfig) => {
      const onProgress = config?.metadata?.onProgress as ((msg: string) => void) | undefined;

      onProgress?.('財務データの取得先を選択しています...');
      const { response } = await callLlm(input.query, {
        model,
        systemPrompt: buildRouterPrompt(),
        tools: FINANCE_TOOLS,
      });
      const aiMessage = response as AIMessage;

      const toolCalls = aiMessage.tool_calls as ToolCall[] | undefined;
      if (!toolCalls || toolCalls.length === 0) {
        return formatToolResult({ error: 'クエリに対応する財務ツールを選択できませんでした。' }, []);
      }

      const toolNames = [...new Set(toolCalls.map((toolCall) => formatSubToolName(toolCall.name)))];
      onProgress?.(`財務データを取得しています: ${toolNames.join(', ')}`);

      const results = await Promise.all(
        toolCalls.map(async (toolCall) => {
          try {
            const tool = FINANCE_TOOL_MAP.get(toolCall.name);
            if (!tool) {
              throw new Error(`Tool '${toolCall.name}' not found`);
            }

            const rawResult = await withTimeout(
              tool.invoke(toolCall.args),
              SUB_TOOL_TIMEOUT_MS,
              toolCall.name,
            );
            const { data, sourceUrls } = parseSubToolResult(rawResult);

            return {
              tool: toolCall.name,
              args: toolCall.args,
              data,
              sourceUrls,
              error: null,
            };
          } catch (error) {
            return {
              tool: toolCall.name,
              args: toolCall.args,
              data: null,
              sourceUrls: [],
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }),
      );

      const successfulResults = results.filter((result) => result.error === null);
      const failedResults = results.filter((result) => result.error !== null);
      const allUrls = results.flatMap((result) => result.sourceUrls);
      const combinedData: Record<string, unknown> = {};

      for (const result of successfulResults) {
        const key = buildResultKey(result.tool, result.args as Record<string, unknown>);
        if (
          typeof result.data !== 'string' &&
          Object.prototype.hasOwnProperty.call(FINANCIAL_FORMATTERS, result.tool)
        ) {
          combinedData[key] = FINANCIAL_FORMATTERS[result.tool](
            result.data,
            result.args as Record<string, unknown>,
          );
        } else {
          combinedData[key] = result.data;
        }
      }

      if (failedResults.length > 0) {
        combinedData._errors = failedResults.map((result) => ({
          tool: result.tool,
          args: result.args,
          error: result.error,
        }));
      }

      return formatToolResult(combinedData, allUrls);
    },
  });
}
