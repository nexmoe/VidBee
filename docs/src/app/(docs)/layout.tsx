import type { ReactNode } from 'react';
import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';
import { i18n } from '@/lib/i18n';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { defineI18nUI } from 'fumadocs-ui/i18n';

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
}: {
  children: ReactNode;
}) {
  const locale = i18n.defaultLanguage;
  return (
    <RootProvider
      i18n={provider(locale)}
      search={{
        options: {
          type: 'static',
        },
      }}
    >
      <DocsLayout tree={source.getPageTree(locale)} {...baseOptions(locale)}>
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
