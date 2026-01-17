import { defineI18n } from 'fumadocs-core/i18n';

export const i18n = defineI18n({
  languages: ['en', 'zh'],
  defaultLanguage: 'en',
  // Use 'never' for static export compatibility (middleware doesn't work in static export)
  hideLocale: 'never',
  parser: 'dir'
});

export type Locale = (typeof i18n.languages)[number];

const localeSet = new Set(i18n.languages);

export function isLocale(value?: string): value is Locale {
  return Boolean(value && localeSet.has(value as Locale));
}

export function resolveLocaleFromSlug(slug?: string[]): Locale {
  if (slug && slug.length > 0 && isLocale(slug[0])) {
    return slug[0];
  }
  return i18n.defaultLanguage;
}

export function stripLocaleFromSlug(slug?: string[]): string[] {
  if (!slug || slug.length === 0) {
    return [];
  }
  if (isLocale(slug[0])) {
    return slug.slice(1);
  }
  return slug;
}
