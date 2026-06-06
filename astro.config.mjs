// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// NOTE: `site` uses a placeholder until the GitHub username is confirmed.
// User site (repo <username>.github.io) → base '/'. Custom domain later → site: 'https://aposworld.com'.
export default defineConfig({
  site: 'https://USERNAME.github.io',
  base: '/',
  integrations: [mdx(), sitemap()],
});
