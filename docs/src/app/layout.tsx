import './global.css';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { i18n, isLocale } from '@/lib/i18n';

const inter = Inter({
  subsets: ['latin'],
});

export default async function Layout({
  children,
  params,
}: {
  children: ReactNode;
  params?: Promise<{ lang?: string }>;
}) {
  const resolvedParams = params ? await params : undefined;
  const lang = isLocale(resolvedParams?.lang) ? resolvedParams.lang : i18n.defaultLanguage;
  return (
    <html lang={lang} className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        {children}
      </body>
    </html>
  );
}
