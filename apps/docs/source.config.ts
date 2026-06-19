import { defineDocs } from 'fumadocs-mdx/config';
import { metaSchema, pageSchema } from 'fumapress/adapters/mdx/schema';

/** Fumadocs MDX collection config for VidBee docs content. */
export const docs = defineDocs({
  dir: 'content',
  docs: {
    async: true,
    schema: pageSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});
