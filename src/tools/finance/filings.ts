import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { normalizeCode, resolveJpTickerFull } from './ticker.js';

const FILING_SOURCES = {
  annual_report: 'site:disclosure.edinet-fsa.go.jp 有価証券報告書',
  quarterly_report: 'site:disclosure.edinet-fsa.go.jp 四半期報告書',
  earnings_release: 'site:release.tdnet.info 決算短信',
  presentation: 'site:*.co.jp 決算説明資料 IR',
} as const;

const FilingTypeSchema = z.enum([
  'annual_report',
  'quarterly_report',
  'earnings_release',
  'presentation',
]);

const FilingsInputSchema = z.object({
  code: z.string().describe('証券コード（例: 7203）または会社名（例: トヨタ、ソニー）'),
  filing_type: FilingTypeSchema.default('annual_report').describe('取得したいIR書類の種類'),
});

function getFilingTypeLabel(filingType: z.infer<typeof FilingTypeSchema>): string {
  switch (filingType) {
    case 'annual_report':
      return '有価証券報告書';
    case 'quarterly_report':
      return '四半期報告書';
    case 'earnings_release':
      return '決算短信';
    case 'presentation':
      return '決算説明資料';
  }
}

export const getFilings = new DynamicStructuredTool({
  name: 'get_filings',
  description:
    '日本株のIR書類（有価証券報告書・四半期報告書・決算短信・決算説明資料）を検索する。一次資料として EDINET・TDnet・公式IR を優先する。',
  schema: FilingsInputSchema,
  func: async (input) => {
    const code = await resolveJpTickerFull(input.code);
    const normalizedCode = code ? normalizeCode(code) : null;
    const filingLabel = getFilingTypeLabel(input.filing_type);
    const sourceQuery = FILING_SOURCES[input.filing_type];
    const searchTarget = normalizedCode ? `${input.code} ${normalizedCode}` : input.code;
    const searchQuery = `${searchTarget} ${sourceQuery}`;
    const ref = normalizedCode ? `${input.code} (${normalizedCode})` : input.code;

    return formatToolResult(`## IR書類検索ガイド
対象: ${ref}
書類種別: ${filingLabel}

1. \`web_search\` で次のクエリを検索:
   - "${searchQuery}"
2. 検索結果では一次資料を優先:
   - EDINET: disclosure.edinet-fsa.go.jp
   - TDnet: release.tdnet.info
   - 会社公式IR: 各社 IR / investor relations サイト
3. 採用したURLを \`web_fetch\` で取得
4. 二次メディアしか見つからない場合は、その旨を明記して利用する

検索の狙い:
- EDINET: 有価証券報告書・四半期報告書
- TDnet: 決算短信
- 公式IR: 決算説明資料や補足説明資料

推奨検索クエリ: "${searchQuery}"`);
  },
});

// 後方互換エイリアス
export const get10KFilingItems = getFilings;
export const get10QFilingItems = getFilings;
export const get8KFilingItems = getFilings;
