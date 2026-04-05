import { describe, expect, test } from 'bun:test';
import { DEFAULT_SYSTEM_PROMPT, buildSystemPrompt, getCurrentDate } from './prompts.js';

describe('agent prompts', () => {
  test('formats the current date in Japanese locale', () => {
    const currentDate = getCurrentDate();

    expect(currentDate).toContain('年');
    expect(currentDate).toContain('月');
  });

  test('buildSystemPrompt includes Ukyo identity and Japan-specific guidance', () => {
    const prompt = buildSystemPrompt('gpt-4o', '私はUkyoです。', 'cli', undefined, [], null, null);

    expect(prompt).toContain('あなたは Ukyo');
    expect(prompt).toContain('1000億円');
    expect(prompt).toContain('PBR');
    expect(prompt).toContain('dcf-valuation');
    expect(prompt).toContain('私はUkyoです。');
  });

  test('buildSystemPrompt localizes the memory file label', () => {
    const prompt = buildSystemPrompt(
      'gpt-4o',
      null,
      'cli',
      undefined,
      ['portfolio.md', 'daily.md'],
      null,
      null,
    );

    expect(prompt).toContain('保存済みメモファイル: portfolio.md, daily.md');
    expect(prompt).not.toContain('Memory files on disk:');
  });

  test('default system prompt uses Japanese market formatting rules', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('7203');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('45.1兆円');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('日本株');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('自己資本比率 5% 未満');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('通期/四半期混在');
  });

  test('buildSystemPrompt warns about anomaly checks before drawing conclusions', () => {
    const prompt = buildSystemPrompt('gpt-4o', null, 'cli', undefined, [], null, null);

    expect(prompt).toContain('異常値らしい数値');
    expect(prompt).toContain('API 欠損');
  });
});
