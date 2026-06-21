import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Sveltia CMS writes '' / null / {} for optional fields left blank. Normalise
// those "empty" shapes to undefined so optional() / coerce.date() / image()
// don't reject CMS-authored posts.
const blankToUndefined = (v: unknown) =>
  v === '' ||
  v === null ||
  (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0)
    ? undefined
    : v;

// Single `blog` collection (Astro v6 Content Layer / glob loader).
// category enum keeps taxonomy URLs ascii; Chinese labels live in src/data/categories.ts.
const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: ({ image }) =>
    z
      .object({
        title: z.string(),
        description: z.string().optional(),
        pubDate: z.coerce.date(),
        updatedDate: z.preprocess(blankToUndefined, z.coerce.date().optional()),
        // food=食記 movie=影評 essay=隨筆 investment=投資
        category: z.enum(['food', 'movie', 'essay', 'investment']),
        tags: z.array(z.string()).default([]),
        cover: z.preprocess(blankToUndefined, image().optional()),
        // co-authored example: ['Jessica Huang (米編)', 'Brian Li (飯糰編)']
        authors: z.array(z.string()).default(['Brian Li (飯糰編)']),
        lang: z.enum(['zh', 'en']).default('zh'),
        draft: z.boolean().default(false),
        featured: z.boolean().default(false),
        youtube: z.array(z.string()).default([]),

        // category === 'food'
        foodReview: z.preprocess(
          blankToUndefined,
          z
            .object({
              location: z.string(),
              address: z.preprocess(blankToUndefined, z.string().optional()),
              mapEmbed: z.preprocess(blankToUndefined, z.string().url().optional()),
              ratings: z.object({
                transport: z.number().min(0).max(5), // 交通
                ambience: z.number().min(0).max(5), // 環境
                service: z.number().min(0).max(5), // 服務
                taste: z.number().min(0).max(5), // 美味
                price: z.number().min(0).max(5), // 價格
              }),
            })
            .optional(),
        ),

        // category === 'investment'
        investment: z.preprocess(
          blankToUndefined,
          z
            .object({
              marketDate: z.coerce.date(),
              charts: z.array(image()).default([]),
              archived: z.boolean().default(true),
            })
            .optional(),
        ),
      })
      .superRefine((d, ctx) => {
        if (d.category === 'food' && !d.foodReview)
          ctx.addIssue({ code: 'custom', message: 'food posts require a foodReview block' });
        if (d.category === 'investment' && !d.investment)
          ctx.addIssue({ code: 'custom', message: 'investment posts require an investment block' });
      }),
});

export const collections = { blog };
