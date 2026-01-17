import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

// statically cached for static export
export const revalidate = false;

// Configure language support for both English and Chinese
export const { staticGET: GET } = createFromSource(source, {
  localeMap: {
    en: { language: 'english' },
    // Chinese is not natively supported by Orama, use English tokenizer for zh
    zh: { language: 'english' },
  },
});
