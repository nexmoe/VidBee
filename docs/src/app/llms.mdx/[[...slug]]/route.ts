import { i18n, resolveLocaleFromSlug, stripLocaleFromSlug } from '@/lib/i18n';
import { getLLMText, source } from '@/lib/source';
import { notFound } from 'next/navigation';

export const revalidate = false;

export async function GET(_req: Request, { params }: RouteContext<'/llms.mdx/[[...slug]]'>) {
  const { slug } = await params;
  const locale = resolveLocaleFromSlug(slug);
  const slugs = stripLocaleFromSlug(slug);
  const page = source.getPage(slugs, locale);
  if (!page) notFound();

  return new Response(await getLLMText(page), {
    headers: {
      'Content-Type': 'text/markdown',
    },
  });
}

export function generateStaticParams() {
  return source.getLanguages().flatMap(({ language, pages }) =>
    pages.map((page) => ({
      slug: language === i18n.defaultLanguage ? page.slugs : [language, ...page.slugs],
    })),
  );
}
