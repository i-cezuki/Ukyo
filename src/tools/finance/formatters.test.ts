import { describe, expect, test } from 'bun:test';
import {
  formatAllFinancials,
  formatEarnings,
  formatHistoricalKeyRatios,
  formatIncomeStatements,
  formatJpDate,
  formatJpyAmount,
  formatKeyRatios,
  formatLargeShareholding,
} from './formatters.js';

describe('formatJpyAmount', () => {
  test('returns — for non-finite values', () => {
    expect(formatJpyAmount(Number.NaN)).toBe('—');
    expect(formatJpyAmount(Number.POSITIVE_INFINITY)).toBe('—');
  });

  test('converts to trillions of yen', () => {
    expect(formatJpyAmount(1_350_000_000_000)).toBe('1.4兆円');
  });

  test('handles exact unit boundaries', () => {
    expect(formatJpyAmount(1_000_000_000_000)).toBe('1.0兆円');
    expect(formatJpyAmount(100_000_000)).toBe('1億円');
    expect(formatJpyAmount(10_000)).toBe('1万円');
    expect(formatJpyAmount(0)).toBe('0円');
  });

  test('converts to hundreds of millions of yen', () => {
    expect(formatJpyAmount(100_586_000_000)).toBe('1006億円');
  });

  test('converts to ten-thousands of yen', () => {
    expect(formatJpyAmount(5_000_000)).toBe('500万円');
  });

  test('keeps small amounts in yen', () => {
    expect(formatJpyAmount(9_999)).toBe('9999円');
  });

  test('supports negative amounts', () => {
    expect(formatJpyAmount(-50_000_000_000)).toBe('-500億円');
  });
});

describe('formatJpDate', () => {
  test('converts ISO dates to YYYY/MM/DD', () => {
    expect(formatJpDate('2024-01-05')).toBe('2024/01/05');
  });

  test('returns — for empty input', () => {
    expect(formatJpDate('')).toBe('—');
  });

  test('trims datetime input to the date portion', () => {
    expect(formatJpDate('2024-01-05T09:00:00')).toBe('2024/01/05');
  });
});

describe('financial formatter passthrough', () => {
  test('preserves preformatted income-statement markdown', () => {
    expect(formatIncomeStatements('already formatted')).toBe('already formatted');
  });

  test('preserves preformatted all-financials markdown', () => {
    expect(formatAllFinancials('all statements')).toBe('all statements');
  });

  test('preserves preformatted key-ratio markdown', () => {
    expect(formatKeyRatios('key ratios')).toBe('key ratios');
    expect(formatHistoricalKeyRatios('historical ratios')).toBe('historical ratios');
  });

  test('preserves preformatted earnings markdown', () => {
    expect(formatEarnings('earnings calendar')).toBe('earnings calendar');
  });

  test('renders large-shareholding tables and sync hints', () => {
    const formatted = formatLargeShareholding({
      table: '| 提出日 | 提出者 |\n|---|---|\n| 2026-04-03 | ブラックロック |',
      missing_dates: ['2026-04-02'],
    });

    expect(formatted).toContain('| 提出日 | 提出者 |');
    expect(formatted).toContain('未同期日');
    expect(formatLargeShareholding('already formatted')).toBe('already formatted');
  });
});
