import tailwindcss from '@tailwindcss/vite';
import mdx from 'fumadocs-mdx/vite';
import press from 'fumapress/vite';
import { defineConfig } from 'waku/config';

/** Waku + Fumapress build configuration for the docs app. */
export default defineConfig({
  vite: {
    plugins: [press(), mdx(), tailwindcss()],
  },
});
