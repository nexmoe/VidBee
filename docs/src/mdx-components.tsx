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

const resolveImageSize = (
  props: React.ComponentProps<typeof Image>,
  src: React.ComponentProps<typeof Image>['src'],
) => {
  if (props.fill) return { fill: true as const };
  if (typeof src === 'string') {
    return {
      width: props.width ?? 1200,
      height: props.height ?? 675,
    };
  }
  return {
    width: props.width,
    height: props.height,
  };
};

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    img: (props) => {
      const src = resolveImageSrc(props.src);
      const sizeProps = resolveImageSize(props, src);
      return <Image {...props} {...sizeProps} src={src} />;
    },
    ...components,
  };
}
