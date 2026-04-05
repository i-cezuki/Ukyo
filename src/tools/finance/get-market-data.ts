import { DynamicStructuredTool, StructuredToolInterface } from '@langchain/core/tools';
import type { RunnableConfig } from '@langchain/core/runnables';
import { AIMessage, ToolCall } from '@langchain/core/messages';
import { z } from 'zod';
import { callLlm } from '../../model/llm.js';
import { getCurrentDate } from '../../agent/prompts.js';
import { formatToolResult } from '../types.js';
import { MARKET_DATA_FORMATTERS } from './formatters.js';
import { getInsiderHoldings } from './insider-holdings.js';
import { getInvestorTrading } from './investor-trading.js';
import { getListedIssues } from './listed-issues.js';
import { getMarginTrading } from './margin-trading.js';
import { getStockPrice } from './stock-price.js';
import { SUB_TOOL_TIMEOUT_MS, withTimeout } from './utils.js';

export const GET_MARKET_DATA_DESCRIPTION = `
日本株の市場データを取得するメタツール。自然言語クエリを解析し、適切な市場データサブツールを自動選択して実行する。

## 使うべきとき

- 株価（始値・終値・高値・安値・出来高）の取得
- 信用取引残高・貸借倍率の確認
- 投資家別売買動向（外国人・個人・機関投資家）の確認
- 大量保有報告書・役員持分の確認
- 上場銘柄の検索・証券コード確認

## 使うべきでないとき

- 財務3表・投資指標（get_financials を使う）
- 有価証券報告書や決算説明資料の内容読み込み（read_filings を使う）
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

const MARKET_DATA_TOOLS: StructuredToolInterface[] = [
  getStockPrice,
  getMarginTrading,
  getInvestorTrading,
  getInsiderHoldings,
  getListedIssues,
];

const MARKET_DATA_TOOL_MAP = new Map(MARKET_DATA_TOOLS.map((tool) => [tool.name, tool]));

function buildRouterPrompt(): string {
  return `あなたは日本株市場データのルーターです。
現在日付: ${getCurrentDate()}

証券コード解決:
${JP_TICKER_EXAMPLES}

利用可能なツール:
- get_stock_price: 株価（始値・終値・出来高）の取得
- get_margin_trading: 信用取引残高・貸借倍率の取得
- get_investor_trading: 投資家別売買動向の取得
- get_insider_holdings: 大量保有報告書・役員持分の取得
- get_listed_issues: 上場銘柄・証券コードの検索

回答は日本語で、必要なツールだけを選んで実行すること。`;
}

const GetMarketDataInputSchema = z.object({
  query: z.string().describe('市場データに関する自然言語クエリ'),
});

export function createGetMarketData(model: string): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'get_market_data',
    description: GET_MARKET_DATA_DESCRIPTION,
    schema: GetMarketDataInputSchema,
    func: async (input, _runManager, config?: RunnableConfig) => {
      const onProgress = config?.metadata?.onProgress as ((msg: string) => void) | undefined;

      onProgress?.('市場データの取得先を選択しています...');
      const { response } = await callLlm(input.query, {
        model,
        systemPrompt: buildRouterPrompt(),
        tools: MARKET_DATA_TOOLS,
      });
      const aiMessage = response as AIMessage;

      const toolCalls = aiMessage.tool_calls as ToolCall[] | undefined;
      if (!toolCalls || toolCalls.length === 0) {
        return formatToolResult({ error: 'クエリに対応する市場データツールを選択できませんでした。' }, []);
      }

      const toolNames = [...new Set(toolCalls.map((toolCall) => formatSubToolName(toolCall.name)))];
      onProgress?.(`市場データを取得しています: ${toolNames.join(', ')}`);

      const results = await Promise.all(
        toolCalls.map(async (toolCall) => {
          try {
            const tool = MARKET_DATA_TOOL_MAP.get(toolCall.name);
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
          Object.prototype.hasOwnProperty.call(MARKET_DATA_FORMATTERS, result.tool)
        ) {
          combinedData[key] = MARKET_DATA_FORMATTERS[result.tool](
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
