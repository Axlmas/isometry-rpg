import { describe, expect, it } from 'vitest';
import { I18n, LOCALES, PSEUDO_LOCALE, type MessageKey, pickLocale } from '../src/i18n';
import en from '../src/i18n/locales/en.json';
import { pseudolocalize } from '../src/i18n/pseudo';

const KEYS = Object.keys(en) as MessageKey[];
const SAMPLE = { count: 3, language: 'English', current: 40, max: 100, min: 1, defense: 2, used: 3, total: 24, value: 2, item: 'Coal', level: 3, needed: 260, cost: 8, seconds: 4, skill: 'Sweep', amount: 60, price: 25, gain: 12, zone: 'Stillford', danger: 'a safe place', npc: 'Blacksmith', key: 'Q', scroll: 'Scroll', chance: 66, crystals: 3 };

describe('I18n', () => {
  it('formats every message in every locale without problems', () => {
    for (const locale of [...Object.keys(LOCALES), PSEUDO_LOCALE]) {
      const problems: string[] = [];
      const i18n = new I18n({ onProblem: (p) => problems.push(p) });
      i18n.setLocale(locale);
      expect(i18n.locale).toBe(locale);
      for (const key of KEYS) expect(i18n.t(key, SAMPLE).length).toBeGreaterThan(0);
      expect(problems).toEqual([]);
    }
  });

  it('applies the plural rules of each language', () => {
    const i18n = new I18n();
    i18n.setLocale('ru');
    expect(i18n.t('hud.monsters', { count: 0 })).toBe('Монстров здесь не осталось');
    expect(i18n.t('hud.monsters', { count: 1 })).toBe('Остался 1 монстр');
    expect(i18n.t('hud.monsters', { count: 3 })).toBe('Осталось 3 монстра');
    expect(i18n.t('hud.monsters', { count: 5 })).toBe('Осталось 5 монстров');
    expect(i18n.t('hud.monsters', { count: 21 })).toBe('Остался 21 монстр');
    i18n.setLocale('en');
    expect(i18n.t('hud.monsters', { count: 1 })).toBe('1 monster left');
    expect(i18n.t('hud.health', { current: 1234, max: 5000 })).toBe('Health: 1,234 of 5,000');
    expect(i18n.t('log.coins', { count: 1 })).toBe('+1 coin');
    i18n.setLocale('ru');
    expect(i18n.t('hud.coins', { count: 22 })).toBe('22 монеты');
    expect(i18n.t('log.coins', { count: 5 })).toBe('+5 монет');
  });

  it('falls back to English when a translation is missing or malformed', () => {
    const problems: string[] = [];
    const i18n = new I18n({
      resources: { en, xx: { 'hud.hint': '{broken' } },
      onProblem: (p) => problems.push(p),
    });
    i18n.setLocale('xx');
    expect(i18n.t('hud.hint')).toBe(en['hud.hint']);
    expect(i18n.t('inventory.close')).toBe(en['inventory.close']);
    expect(problems).toHaveLength(2);
  });

  it('never shows a key or an error to the player', () => {
    const i18n = new I18n({ resources: { en: {} } });
    expect(i18n.t('hud.hint')).toBe('…');
  });

  it('falls back to English for an unknown locale', () => {
    const i18n = new I18n();
    i18n.setLocale('tlh');
    expect(i18n.locale).toBe('en');
  });
});

describe('pickLocale', () => {
  it('prefers the saved choice, then the browser languages, then English', () => {
    expect(pickLocale(['ru', 'en-US'])).toBe('ru');
    expect(pickLocale([null, 'ru-RU', 'en'])).toBe('ru');
    expect(pickLocale([null, 'de-DE', 'ja'])).toBe('en');
    expect(pickLocale([])).toBe('en');
  });
});

describe('pseudolocalize', () => {
  it('keeps ICU syntax intact while changing the visible text', () => {
    expect(pseudolocalize('Language: {language}')).toMatch(/^\[Ļáñĝüáĝé: \{language\} ~+\]$/);
    const plural = pseudolocalize('{count, plural, one {# step} other {# steps}}');
    expect(plural).toContain('{count, plural, one {# šţép} other {# šţépš}}');
  });
  it('makes the visible text noticeably longer', () => {
    for (const key of KEYS) expect(pseudolocalize(en[key]).length).toBeGreaterThan(en[key].length);
    // Plain sentences (no ICU syntax) must grow by at least a third.
    expect(pseudolocalize(en['error.body']).length).toBeGreaterThan(en['error.body'].length * 1.33);
  });
});
