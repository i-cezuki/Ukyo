import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { normalizeCode, resolveJpTickerFull } from './ticker.js';

/**
 * Rich description for the read_filings tool.
 * Used by registry.ts to register this tool in the agent.
 */
export const READ_FILINGS_DESCRIPTION =
  '日本企業のIR書類（有価証券報告書・四半期報告書・決算短信・決算説明資料・大量保有報告書）を検索し、一次資料を優先して読み込む。EDINET と TDnet を最優先に使い、必要に応じて公式IRサイトまで広げる。';

const ReadFilingsInputSchema = z.object({
  company: z.string().describe('証券コード（例: 7203）または会社名（例: トヨタ、ソニー）'),
  topic: z
    .string()
    .optional()
    .describe('探したい論点（例: 事業リスク、成長戦略、中期経営計画、設備投資）'),
  filing_type: z
    .enum(['有価証券報告書', '四半期報告書', '決算短信', '決算説明資料', '大量保有報告書'])
    .default('有価証券報告書')
    .describe('読み込みたい書類の種類'),
});

export function createReadFilings(_model?: string): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'read_filings',
    description: READ_FILINGS_DESCRIPTION,
    schema: ReadFilingsInputSchema,
    func: async (input) => {
      const code = await resolveJpTickerFull(input.company);
      const normalizedCode = code ? normalizeCode(code) : null;
      const ref = normalizedCode ? `${input.company}(${normalizedCode})` : input.company;
      const topic = input.topic?.trim();
      const topicSuffix = topic ? ` ${topic}` : '';

      const edinetQuery = `${input.company} ${input.filing_type}${topicSuffix} site:disclosure.edinet-fsa.go.jp`;
      const tdnetQuery = `${input.company} ${input.filing_type}${topicSuffix} site:release.tdnet.info`;
      const irQuery = `${input.company} ${input.filing_type}${topicSuffix} IR`;

      return formatToolResult(`## IR書類読み込みガイド
対象: ${ref}
書類: ${input.filing_type}${topic ? ` / トピック: ${topic}` : ''}

1. \`web_search\` で以下を順に検索:
   - EDINET優先: "${edinetQuery}"
   - TDnet: "${tdnetQuery}"
   - 公式IR: "${irQuery}"
2. 検索結果から一次資料のURLを選択:
   - 優先順: EDINET > TDnet > 公式IR > 二次メディア
3. 採用したURLを \`web_fetch\` で取得
4. ${topic ? `「${topic}」に関する` : '主要な'}記述を抽出して要約
5. 二次メディアを使った場合は、必ず一次資料が見つからなかった理由と出典URLを明記

検索メモ:
- 有価証券報告書 / 四半期報告書: EDINET を最優先
- 決算短信: TDnet を最優先
- 決算説明資料: 公式IR を優先
- 大量保有報告書: EDINET を最優先`);
    },
  });
}
