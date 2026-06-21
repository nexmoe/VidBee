import type { ReactNode } from 'react';
import { defineI18n } from 'fumadocs-core/i18n';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { uiTranslations } from 'fumadocs-ui/i18n';
import { defineConfig } from 'fumapress';
import { fumadocsMdx } from 'fumapress/adapters/mdx';
import { fumapressTranslations } from 'fumapress/i18n';
import { flexsearchPlugin } from 'fumapress/plugins/flexsearch';
import { llmsPlugin } from 'fumapress/plugins/llms.txt';
import { sitemapPlugin } from 'fumapress/plugins/sitemap';
import { takumiPlugin } from 'fumapress/plugins/takumi';
import { unstable_notFound } from 'waku/router/server';
import { docs } from './.source/server';

const i18n = defineI18n({
  languages: ['en', 'zh', 'fr', 'ru'],
  defaultLanguage: 'en',
  hideLocale: 'default-locale',
  parser: 'dir',
});

const translations = i18n
  .translations()
  .extend(uiTranslations())
  .extend(fumapressTranslations())
  .add({
    en: { displayName: 'English' },
    zh: { displayName: '中文' },
    fr: { displayName: 'Français' },
    ru: { displayName: 'Русский' },
  });

const googleAnalyticsId = 'G-2F11GJP6G9';
const docsBaseUrl = 'https://docs.vidbee.org';

/** Convert internal default-locale URLs to public root URLs. */
function toPublicPath(pathname: string): string {
  const defaultPrefix = `/${i18n.defaultLanguage}`;
  if (pathname === defaultPrefix) return '/';
  if (pathname.startsWith(`${defaultPrefix}/`)) return pathname.slice(defaultPrefix.length);
  return pathname;
}

/** Build localized public URL path for a given locale. */
function toLocalizedPublicPath(pathname: string, locale: string): string {
  const publicPath = toPublicPath(pathname);
  if (locale === i18n.defaultLanguage) return publicPath;
  if (publicPath === '/') return `/${locale}`;
  return `/${locale}${publicPath}`;
}

/** Serve default-locale docs at unprefixed root routes (e.g. /cookies instead of /en/cookies). */
function englishRootRoutesPlugin() {
  return {
    name: 'vidbee-english-root-routes',
    enforce: 'pre' as const,
    async createPages({
      createLayout,
      createPage,
    }: {
      createLayout: (config: Record<string, unknown>) => void;
      createPage: (config: Record<string, unknown>) => void;
    }) {
      const ctx = this as unknown as {
        i18nConfig?: { defaultLanguage: string; hideLocale?: string };
        layouts: {
          root: (props: { lang?: string; children: ReactNode }) => Promise<ReactNode>;
          page: (props: { lang?: string; slugs: string[]; page: unknown }) => Promise<ReactNode>;
        };
        mode: string;
        plugins: Array<{
          resolvePage?: (page: unknown) => Promise<unknown | false | undefined>;
          renderPage?: (env: {
            fallback: ReactNode;
            page: unknown;
            slugs: string[];
            lang?: string;
          }) => Promise<ReactNode | undefined>;
        }>;
        getLoader: () => Promise<{
          getPages: () => Array<{ locale?: string; slugs: string[] }>;
          getPage: (slugs: string[], lang?: string) => unknown;
        }>;
      };

      if (!ctx.i18nConfig || ctx.i18nConfig.hideLocale !== 'default-locale') return;

      const defaultLang = ctx.i18nConfig.defaultLanguage;
      const renderMode = ctx.mode === 'default' ? 'static' : ctx.mode;
      const staticPaths: string[][] = [];

      for (const page of (await ctx.getLoader()).getPages()) {
        if (page.locale !== defaultLang) continue;
        let excluded = false;
        for (const plugin of ctx.plugins) {
          const resolved = await plugin.resolvePage?.call(this, page);
          if (resolved === false) {
            excluded = true;
            break;
          }
        }
        if (!excluded) staticPaths.push(page.slugs);
      }

      const resolvePage = async (slugs: string[]) => {
        let page = (await ctx.getLoader()).getPage(slugs, defaultLang);
        if (!page) unstable_notFound();
        for (const plugin of ctx.plugins) {
          const resolved = await plugin.resolvePage?.call(this, page);
          if (typeof resolved === 'object') page = resolved as typeof page;
          else if (resolved === false) unstable_notFound();
        }
        return page;
      };

      createLayout({
        render: renderMode,
        path: '/',
        component: ({ children }: { children: ReactNode }) =>
          ctx.layouts.root({ lang: defaultLang, children }),
      });

      createPage({
        render: renderMode,
        path: '/[...slugs]',
        staticPaths,
        component: async ({ slugs }: { slugs: string[] }) => {
          const page = await resolvePage(slugs);
          let fallback = await ctx.layouts.page({ lang: defaultLang, slugs, page });
          for (const plugin of ctx.plugins) {
            const rendered = await plugin.renderPage?.call(this, {
              fallback,
              page,
              slugs,
              lang: defaultLang,
            });
            if (rendered !== undefined) fallback = rendered;
          }
          return fallback;
        },
      });
    },
  };
}

/** VidBee docs site configuration powered by Fumapress. */
export default defineConfig({
  mode: 'static',
  content: {
    docs: docs.toFumadocsSource(),
  },
  i18n,
  translations,
  loaderOptions: {
    plugins: [lucideIconsPlugin()],
  },
  site: {
    baseUrl: docsBaseUrl,
    name: 'VidBee',
    git: {
      user: 'nexmoe',
      repo: 'VidBee',
      branch: 'main',
      rootDir: 'apps/docs',
    },
  },
  meta: {
    root() {
      return (
        <>
          <script async src={`https://www.googletagmanager.com/gtag/js?id=${googleAnalyticsId}`} />
          <script
            dangerouslySetInnerHTML={{
              __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${googleAnalyticsId}');`,
            }}
          />
        </>
      );
    },
    page(page) {
      const canonicalPath = toPublicPath(page.url);
      const canonicalUrl = `${docsBaseUrl}${canonicalPath}`;
      const alternateLinks = i18n.languages.map((locale) => {
        const localizedPath = toLocalizedPublicPath(page.url, locale);
        return {
          locale,
          href: `${docsBaseUrl}${localizedPath}`,
        };
      });

      return (
        <>
          <meta name="description" content={page.data.description} />
          <link rel="canonical" href={canonicalUrl} />
          <meta property="og:url" content={canonicalUrl} />
          {alternateLinks.map((link) => (
            <link key={link.locale} rel="alternate" hrefLang={link.locale} href={link.href} />
          ))}
          <link rel="alternate" hrefLang="x-default" href={canonicalUrl} />
        </>
      );
    },
  },
})
  .layouts({
    defaultProps() {
      return {
        nav: {
          title: 'VidBee',
        },
      };
    },
  })
  .plugins(
    englishRootRoutesPlugin() as never,
    flexsearchPlugin(),
    llmsPlugin(),
    sitemapPlugin({
      getEntry(page) {
        const canonicalPath = toPublicPath(page.url);
        const canonicalUrl = `${docsBaseUrl}${canonicalPath}`;
        const alternates = i18n.languages.map((locale) => {
          const localizedPath = toLocalizedPublicPath(page.url, locale);
          return {
            rel: 'alternate' as const,
            hreflang: locale,
            href: `${docsBaseUrl}${localizedPath}`,
          };
        });

        return {
          loc: canonicalUrl,
          priority: 0.8,
          alternates: [
            ...alternates,
            {
              rel: 'alternate' as const,
              hreflang: 'x-default',
              href: canonicalUrl,
            },
          ],
        };
      },
    }),
    takumiPlugin(),
  )
  .adapters(fumadocsMdx());
