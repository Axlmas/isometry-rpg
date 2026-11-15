import { IntlMessageFormat } from 'intl-messageformat';
import en from './locales/en.json';
import ru from './locales/ru.json';
import { pseudolocalizeAll } from './pseudo';

/** English is the source of truth: every key must exist here. */
export const SOURCE_LOCALE = 'en';
/** Test-only locale generated from English. Never offered to players. */
export const PSEUDO_LOCALE = 'en-XA';

export type MessageKey = keyof typeof en;
export type MessageValues = Record<string, string | number>;
type Messages = Partial<Record<MessageKey, string>>;

export interface LocaleInfo {
  /** The language's own name, shown in the language switcher. Not translated. */
  name: string;
  dir: 'ltr' | 'rtl';
}

/** To add a language: add its JSON file, import it, and register it here. */
export const LOCALES: Record<string, LocaleInfo> = {
  en: { name: 'English', dir: 'ltr' },
  ru: { name: 'Русский', dir: 'ltr' },
};

const RESOURCES: Record<string, Messages> = {
  en,
  ru,
  [PSEUDO_LOCALE]: pseudolocalizeAll(en) as Messages,
};

/** Shown instead of a message that is missing even in the source locale. */
const MISSING_TEXT = '…';

export interface I18nOptions {
  resources?: Record<string, Messages>;
  /** Called for diagnostics only; the text is never shown to the player. */
  onProblem?: (problem: string) => void;
}

export class I18n {
  private current = SOURCE_LOCALE;
  private readonly resources: Record<string, Messages>;
  private readonly onProblem: (problem: string) => void;
  private readonly cache = new Map<string, IntlMessageFormat>();

  constructor(options: I18nOptions = {}) {
    this.resources = options.resources ?? RESOURCES;
    this.onProblem = options.onProblem ?? (() => {});
  }

  get locale(): string {
    return this.current;
  }

  setLocale(locale: string): void {
    this.current = this.resources[locale] ? locale : SOURCE_LOCALE;
  }

  /**
   * Returns the message for the current locale. Falls back to the source
   * locale when the key is missing or the translation is malformed, so the
   * player always sees readable text and never a key or an error.
   */
  t(key: MessageKey, values?: MessageValues): string {
    for (const locale of new Set([this.current, SOURCE_LOCALE])) {
      const message = this.resources[locale]?.[key];
      if (message === undefined) {
        this.onProblem(`Missing message "${key}" in locale "${locale}"`);
        continue;
      }
      try {
        return String(this.format(locale, key, message).format(values));
      } catch (error) {
        this.onProblem(`Cannot format message "${key}" in locale "${locale}": ${String(error)}`);
      }
    }
    return MISSING_TEXT;
  }

  private format(locale: string, key: string, message: string): IntlMessageFormat {
    const cacheKey = `${locale}\u0000${key}`;
    let formatter = this.cache.get(cacheKey);
    if (!formatter) {
      // The pseudo-locale uses English plural rules and number formatting.
      formatter = new IntlMessageFormat(message, locale === PSEUDO_LOCALE ? SOURCE_LOCALE : locale);
      this.cache.set(cacheKey, formatter);
    }
    return formatter;
  }
}

/**
 * Picks the first supported locale from the player's preferences
 * ("ru-RU" matches "ru"). Falls back to the source locale.
 */
export function pickLocale(preferred: readonly (string | null | undefined)[], supported = Object.keys(LOCALES)): string {
  for (const candidate of preferred) {
    if (!candidate) continue;
    if (supported.includes(candidate)) return candidate;
    const base = candidate.split('-')[0] as string;
    if (supported.includes(base)) return base;
  }
  return SOURCE_LOCALE;
}
