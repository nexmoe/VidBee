import { resolveLocaleFromSlug, stripLocaleFromSlug } from '@/lib/i18n';
import { getPageImage, source } from '@/lib/source';
import { notFound } from 'next/navigation';
import { ImageResponse } from 'next/og';
import { generate as DefaultImage } from 'fumadocs-ui/og';

export const revalidate = false;

export async function GET(_req: Request, { params }: RouteContext<'/og/docs/[...slug]'>) {
  const { slug } = await params;
  const pageSlug = slug.slice(0, -1);
  const locale = resolveLocaleFromSlug(pageSlug);
  const slugs = stripLocaleFromSlug(pageSlug);
  const page = source.getPage(slugs, locale);
  if (!page) notFound();

  return new ImageResponse(
    <DefaultImage title={page.data.title} description={page.data.description} site="VidBee" />,
    {
      width: 1200,
      height: 630,
    },
  );
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({
    slug: getPageImage(page).segments,
  }));
}
