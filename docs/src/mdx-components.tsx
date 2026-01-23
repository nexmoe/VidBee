import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import type React from 'react';
import Image from 'next/image';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const withBasePath = (src?: string) => {
  if (!src || !src.startsWith('/')) return src;
  return `${basePath}${src}`;
};

const resolveImageSrc = (src: React.ComponentProps<typeof Image>['src']) => {
  if (typeof src === 'string') return withBasePath(src) ?? src;
  return src;
};

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    img: (props) => <Image {...props} src={resolveImageSrc(props.src)} />,
    ...components,
  };
}
