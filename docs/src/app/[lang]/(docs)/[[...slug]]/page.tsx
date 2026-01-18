import { getPageImage, source } from '@/lib/source';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/mdx-components';
import type { Metadata } from 'next';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { GitHubEditButton, LLMCopyButton, ViewOptions } from '@/components/ai/page-actions';

export default async function Page(props: PageProps<'/[lang]/[[...slug]]'>) {
  const params = await props.params;
  const page = source.getPage(params.slug, params.lang);
  if (!page) notFound();

  const MDX = page.data.body;
  const gitConfig = {
    user: 'nexmoe',
    repo: 'VidBee',
    branch: 'main',
  };

  const githubFilePath = `docs/content/${page.path}`;
  const githubBlobUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/${githubFilePath}`;
  const githubEditUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}/edit/${gitConfig.branch}/${githubFilePath}`;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
      <div className="flex flex-row gap-2 items-center border-b pb-6">
        <GitHubEditButton href={githubEditUrl} />
        <LLMCopyButton markdownUrl={`${page.url}.mdx`} />
        <ViewOptions
          markdownUrl={`${page.url}.mdx`}
          githubUrl={githubBlobUrl}
        />
      </div>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            // this allows you to link to other pages with relative file paths
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(
  props: PageProps<'/[lang]/[[...slug]]'>,
): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug, params.lang);
  if (!page) notFound();

  const baseUrl = 'https://docs.vidbee.dev';
  const canonicalUrl = `${baseUrl}${page.url}`;

  return {
    title: `${page.data.title} | VidBee Docs`,
    description: page.data.description,
    openGraph: {
      images: getPageImage(page).url,
    },
    alternates: {
      canonical: canonicalUrl,
    },
  };
}
