// J-Quants often returns 5-digit issue codes (for example 72030),
// while users usually refer to the 4-digit securities code (7203).

const RAW_COMPANY_MAP: Record<string, string> = {
  'トヨタ': '7203',
  'トヨタ自動車': '7203',
  'toyota': '7203',
  'ホンダ': '7267',
  '本田技研工業': '7267',
  'honda': '7267',
  '日産': '7201',
  '日産自動車': '7201',
  'nissan': '7201',
  'スズキ': '7269',
  'suzuki': '7269',
  'マツダ': '7261',
  'mazda': '7261',
  'デンソー': '6902',
  'denso': '6902',
  'ソニー': '6758',
  'ソニーグループ': '6758',
  'sony': '6758',
  'キーエンス': '6861',
  'keyence': '6861',
  '東芝': '6502',
  'toshiba': '6502',
  'パナソニック': '6752',
  'panasonic': '6752',
  '京セラ': '6971',
  'kyocera': '6971',
  'ファナック': '6954',
  'fanuc': '6954',
  '村田製作所': '6981',
  'murata': '6981',
  'TDK': '6762',
  'tdk': '6762',
  '東京エレクトロン': '8035',
  'tel': '8035',
  'ルネサス': '6723',
  'renesas': '6723',
  'NTT': '9432',
  '日本電信電話': '9432',
  'NTTドコモ': '9437',
  'docomo': '9437',
  'KDDI': '9433',
  'au': '9433',
  'ソフトバンク': '9984',
  'softbank': '9984',
  'ソフトバンクグループ': '9984',
  'ソフトバンク（通信）': '9434',
  'NEC': '6701',
  'nec': '6701',
  '富士通': '6702',
  'fujitsu': '6702',
  'リクルート': '6098',
  'recruit': '6098',
  'エムスリー': '2413',
  'サイバーエージェント': '4751',
  '三菱UFJ': '8306',
  'mufg': '8306',
  '三菱UFJフィナンシャル': '8306',
  '三菱UFJフィナンシャル・グループ': '8306',
  '三井住友': '8316',
  'smfg': '8316',
  '三井住友フィナンシャルグループ': '8316',
  'みずほ': '8411',
  'mizuho': '8411',
  'みずほフィナンシャルグループ': '8411',
  '野村': '8604',
  'nomura': '8604',
  '大和証券': '8601',
  'daiwa': '8601',
  '日本取引所': '8697',
  'jpx': '8697',
  'JPX': '8697',
  'オリックス': '8591',
  'orix': '8591',
  '東京海上': '8766',
  'tokio marine': '8766',
  'MS&AD': '8725',
  'SOMPO': '8630',
  'sompo': '8630',
  '三菱商事': '8058',
  'mitsubishi corporation': '8058',
  '三井物産': '8031',
  'mitsui': '8031',
  '伊藤忠': '8001',
  'itochu': '8001',
  '住友商事': '8053',
  'sumitomo': '8053',
  '丸紅': '8002',
  'marubeni': '8002',
  '豊田通商': '8015',
  'ファーストリテイリング': '9983',
  'ユニクロ': '9983',
  'uniqlo': '9983',
  'fast retailing': '9983',
  'セブン&アイ': '3382',
  '7eleven': '3382',
  'イオン': '8267',
  'aeon': '8267',
  'ニトリ': '9843',
  '良品計画': '7453',
  'muji': '7453',
  '武田薬品': '4502',
  'takeda': '4502',
  'アステラス': '4503',
  'astellas': '4503',
  '大塚HD': '4578',
  'エーザイ': '4523',
  'eisai': '4523',
  '中外製薬': '4519',
  'chugai': '4519',
  '信越化学': '4063',
  'shin-etsu': '4063',
  '三菱ケミカル': '4188',
  '住友化学': '4005',
  '三井不動産': '8801',
  '三菱地所': '8802',
  '住友不動産': '8830',
  '味の素': '2802',
  'ajinomoto': '2802',
  'キリン': '2503',
  'kirin': '2503',
  'アサヒ': '2502',
  'asahi': '2502',
  '任天堂': '7974',
  'nintendo': '7974',
  'バンダイナムコ': '7832',
  'コナミ': '9766',
  'konami': '9766',
  'ダイキン': '6367',
  'daikin': '6367',
  'コマツ': '6301',
  'komatsu': '6301',
  '日立': '6501',
  'hitachi': '6501',
  '三菱電機': '6503',
  'mitsubishi electric': '6503',
};

export function canonicalizeCompanyKey(input: string): string {
  return input
    .trim()
    .normalize('NFKC')
    .replace(/[()（）]/g, '')
    .replace(/[・･]/g, '')
    .replace(/[&＆]/g, '&')
    .replace(/株式会社/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const JP_COMPANY_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(RAW_COMPANY_MAP).map(([name, code]) => [canonicalizeCompanyKey(name), code]),
);

/**
 * Convert a J-Quants issue code into the common 4-digit display code.
 * Expects a numeric 4-digit or 5-digit code string; other inputs are returned unchanged.
 */
export function normalizeCode(code: string): string {
  const normalized = code.trim().normalize('NFKC');
  return /^\d{5}$/.test(normalized) ? normalized.slice(0, 4) : normalized;
}

/**
 * Resolve a Japanese stock code from a company name or securities code.
 * Returns null when the company cannot be resolved from the static bootstrap map.
 */
export function resolveJpTicker(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const normalizedInput = trimmed.normalize('NFKC');
  if (/^\d{4,5}$/.test(normalizedInput)) {
    return normalizeCode(normalizedInput);
  }

  const companyKey = canonicalizeCompanyKey(trimmed);
  const exact = JP_COMPANY_MAP[companyKey];
  if (exact) {
    return exact;
  }

  for (const [key, code] of Object.entries(JP_COMPANY_MAP)) {
    if (key.startsWith(companyKey) || companyKey.startsWith(key)) {
      return code;
    }
  }

  return null;
}

/**
 * Resolve a Japanese stock code with a fallback to the J-Quants listed master.
 * Static aliases are tried first to avoid unnecessary API calls.
 */
export async function resolveJpTickerFull(input: string): Promise<string | null> {
  const fromMap = resolveJpTicker(input);
  if (fromMap) {
    return fromMap;
  }

  const { resolveTickerFromMaster } = await import('./listed-issues.js');
  return resolveTickerFromMaster(input);
}
