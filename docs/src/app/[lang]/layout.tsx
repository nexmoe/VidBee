import type { ReactNode } from 'react';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { defineI18nUI } from 'fumadocs-ui/i18n';
import { i18n, isLocale } from '@/lib/i18n';

const { provider } = defineI18nUI(i18n, {
  translations: {
    en: {
      displayName: 'English',
    },
    zh: {
      displayName: '中文',
    },
  },
});

export default async function Layout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  const locale = isLocale(lang) ? lang : i18n.defaultLanguage;

  return <RootProvider i18n={provider(locale)}>{children}</RootProvider>;
}
