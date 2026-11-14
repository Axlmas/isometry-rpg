import { describe, expect, it } from 'vitest';
import { I18n, LOCALES, PSEUDO_LOCALE, type MessageKey, pickLocale } from '../src/i18n';
import en from '../src/i18n/locales/en.json';
import { pseudolocalize } from '../src/i18n/pseudo';

const KEYS = Object.keys(en) as MessageKey[];
const SAMPLE = { count: 3, language: 'English' };

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
    expect(i18n.t('hud.steps', { count: 0 })).toBe('Вы ещё не сделали ни шага');
    expect(i18n.t('hud.steps', { count: 1 })).toBe('Пройден 1 шаг');
    expect(i18n.t('hud.steps', { count: 3 })).toBe('Пройдено 3 шага');
    expect(i18n.t('hud.steps', { count: 5 })).toBe('Пройдено 5 шагов');
    expect(i18n.t('hud.steps', { count: 21 })).toBe('Пройден 21 шаг');
    i18n.setLocale('en');
    expect(i18n.t('hud.steps', { count: 1 })).toBe('1 step taken');
    expect(i18n.t('hud.steps', { count: 1234 })).toBe('1,234 steps taken');
  });

  it('falls back to English when a translation is missing or malformed', () => {
    const problems: string[] = [];
    const i18n = new I18n({
      resources: { en, xx: { 'hud.hint': '{broken' } },
      onProblem: (p) => problems.push(p),
    });
    i18n.setLocale('xx');
    expect(i18n.t('hud.hint')).toBe(en['hud.hint']);
    expect(i18n.t('hud.newDungeon')).toBe(en['hud.newDungeon']);
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
