import { afterEach, describe, expect, test } from 'bun:test';
import { clearSkillCache, discoverSkills, getSkill } from './index.js';

describe('skill registry', () => {
  afterEach(() => {
    clearSkillCache();
  });

  test('discovers the Japan-focused DCF skill metadata', () => {
    const skills = discoverSkills();
    const dcfSkill = skills.find((skill) => skill.name === 'dcf-valuation');

    expect(dcfSkill).toBeDefined();
    expect(dcfSkill?.description).toContain('日本株');
    expect(dcfSkill?.description).toContain('DCF');
  });

  test('loads the DCF skill instructions with Japan-specific guidance', () => {
    const dcfSkill = getSkill('dcf-valuation');

    expect(dcfSkill).toBeDefined();
    expect(dcfSkill?.instructions).toContain('J-GAAP');
    expect(dcfSkill?.instructions).toContain('東証33業種');
    expect(dcfSkill?.instructions).toContain('10年国債利回り');
  });
});
