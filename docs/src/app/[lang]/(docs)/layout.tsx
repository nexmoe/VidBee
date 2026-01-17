import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';

export default async function Layout({
  children,
  params,
}: LayoutProps<'/[lang]/[[...slug]]'>) {
  const resolvedParams = await params;
  const locale = resolvedParams.lang;
  return (
    <DocsLayout tree={source.getPageTree(locale)} {...baseOptions(locale)}>
      {children}
    </DocsLayout>
  );
}
