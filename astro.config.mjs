// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// User site (repo p0hsien1i.github.io) → base '/'. Custom domain later → site: 'https://aposworld.com'.
export default defineConfig({
  site: 'https://p0hsien1i.github.io',
  base: '/',
  integrations: [mdx(), sitemap()],
});
