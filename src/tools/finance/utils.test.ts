import { describe, expect, test } from 'bun:test';
import { isAnnualPeriodType, normalizeAsciiUpper } from './utils.js';

describe('normalizeAsciiUpper', () => {
  test('uppercases ASCII letters without changing CJK text', () => {
    expect(normalizeAsciiUpper(' annual通期 ')).toBe('ANNUAL通期');
  });

  test('keeps quarter labels stable', () => {
    expect(normalizeAsciiUpper('fy')).toBe('FY');
    expect(normalizeAsciiUpper('3q累計')).toBe('3Q累計');
  });
});

describe('isAnnualPeriodType', () => {
  test('recognizes annual labels across ASCII and Japanese variants', () => {
    expect(isAnnualPeriodType('FY')).toBe(true);
    expect(isAnnualPeriodType('annual')).toBe(true);
    expect(isAnnualPeriodType('通期')).toBe(true);
    expect(isAnnualPeriodType('年度見通し')).toBe(true);
  });

  test('does not misclassify quarterly labels as annual', () => {
    expect(isAnnualPeriodType('3Q累計')).toBe(false);
    expect(isAnnualPeriodType('2q')).toBe(false);
    expect(isAnnualPeriodType(undefined)).toBe(false);
  });
});
