import { describe, expect, test } from 'bun:test';
import { canonicalizeCompanyKey, normalizeCode, resolveJpTicker } from './ticker.js';

describe('resolveJpTicker', () => {
  test('returns a 4-digit code unchanged', () => {
    expect(resolveJpTicker('7203')).toBe('7203');
  });

  test('normalizes a 5-digit issue code to 4 digits', () => {
    expect(resolveJpTicker('72030')).toBe('7203');
  });

  test('resolves Japanese company names', () => {
    expect(resolveJpTicker('トヨタ')).toBe('7203');
    expect(resolveJpTicker('ソニー')).toBe('6758');
  });

  test('resolves English company names case-insensitively', () => {
    expect(resolveJpTicker('toyota')).toBe('7203');
    expect(resolveJpTicker('Sony')).toBe('6758');
  });

  test('resolves holding company aliases', () => {
    expect(resolveJpTicker('ソニーグループ')).toBe('6758');
    expect(resolveJpTicker('三菱UFJフィナンシャル')).toBe('8306');
  });

  test('resolves SoftBank telecom subsidiary aliases', () => {
    expect(resolveJpTicker('ソフトバンク（通信）')).toBe('9434');
    expect(resolveJpTicker('ソフトバンク通信')).toBe('9434');
  });

  test('handles full-width and spacing variations', () => {
    expect(resolveJpTicker(' ＴＤＫ ')).toBe('6762');
    expect(resolveJpTicker('Fast   Retailing')).toBe('9983');
  });

  test('returns null for unknown companies', () => {
    expect(resolveJpTicker('存在しない会社')).toBeNull();
  });
});

describe('normalizeCode', () => {
  test('normalizes a 5-digit code to 4 digits', () => {
    expect(normalizeCode('72030')).toBe('7203');
  });

  test('keeps a 4-digit code unchanged', () => {
    expect(normalizeCode('7203')).toBe('7203');
  });
});

describe('canonicalizeCompanyKey', () => {
  test('removes parentheses and middle dots', () => {
    expect(canonicalizeCompanyKey('ソフトバンク（通信）')).toBe('ソフトバンク通信');
    expect(canonicalizeCompanyKey('三菱UFJフィナンシャル・グループ')).toBe(
      '三菱ufjフィナンシャルグループ',
    );
  });

  test('removes corporation suffix and folds spaces', () => {
    expect(canonicalizeCompanyKey('  株式会社   Fast   Retailing  ')).toBe('fast retailing');
  });

  test('applies NFKC normalization', () => {
    expect(canonicalizeCompanyKey('ＴＤＫ')).toBe('tdk');
  });
});
