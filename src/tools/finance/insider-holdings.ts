import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { normalizeCode, resolveJpTickerFull } from './ticker.js';

const InsiderHoldingsInputSchema = z.object({
  company: z.string().describe('証券コード（例: 7203）または会社名（例: トヨタ、ソニー）'),
  report_type: z
    .enum(['大量保有報告書', '変更報告書', '役員持分'])
    .default('大量保有報告書')
    .describe('確認したい保有報告の種類'),
});

export const getInsiderHoldings = new DynamicStructuredTool({
  name: 'get_insider_holdings',
  description:
    '大量保有報告書（5%ルール）・変更報告書・役員持分の確認に使う。EDINET の一次資料を優先して、保有比率や保有目的の変化を追う。',
  schema: InsiderHoldingsInputSchema,
  func: async (input) => {
    const code = await resolveJpTickerFull(input.company);
    const normalizedCode = code ? normalizeCode(code) : null;
    const ref = normalizedCode ? `${input.company}(${normalizedCode})` : input.company;

    return formatToolResult(`## 大量保有報告書ガイド
対象: ${ref}
書類: ${input.report_type}

1. \`web_search\` で以下を検索:
   - "${input.company} ${input.report_type} site:disclosure.edinet-fsa.go.jp"
   - "${input.company} 5%ルール 大量保有 EDINET"
2. EDINET の PDF / HTML / XBRL を優先して選択
3. \`web_fetch\` で取得し、次を抽出:
   - 保有者名（個人・法人・ファンド）
   - 保有株数と保有比率
   - 取得日 / 変更日
   - 保有目的（純投資 / 重要提案行為等）
4. 変化を解釈:
   - 5%超の新規取得: 新規参入の可能性
   - 継続的な積み増し: 経営関与や提案意図の可能性
   - 急な保有比率低下: 需給悪化やイベント通過の示唆`);
  },
});
