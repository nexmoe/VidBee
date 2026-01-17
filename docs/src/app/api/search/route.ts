import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

// Orama doesn't support Chinese (zh), so we use English for all content
export const { GET } = createFromSource(source, {
  language: 'english',
});
