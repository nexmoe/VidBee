import type { MetadataRoute } from 'next';
import { i18n } from '@/lib/i18n';
import { source } from '@/lib/source';

export const dynamic = 'force-static';

const baseUrl = 'https://docs.vidbee.org';

function buildPath(segments: string[]): string {
  if (segments.length === 0) {
    return '/';
  }
  return `/${segments.join('/')}/`;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const params = source.generateParams();

  return params.map(({ lang, slug }) => {
    const segments: string[] = [];

    if (lang && lang !== i18n.defaultLanguage) {
      segments.push(lang);
    }

    if (slug && slug.length > 0) {
      segments.push(...slug);
    }

    return {
      url: `${baseUrl}${buildPath(segments)}`,
    };
  });
}
