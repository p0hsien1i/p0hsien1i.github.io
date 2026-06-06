import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

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
        updatedDate: z.coerce.date().optional(),
        // food=食記 movie=影評 essay=心得 journal=隨筆 stock=投資
        category: z.enum(['food', 'movie', 'essay', 'journal', 'stock']),
        tags: z.array(z.string()).default([]),
        cover: image().optional(),
        // co-authored example: ['Jessica Huang (米編)', 'Brian Li (飯糰編)']
        authors: z.array(z.string()).default(['Brian Li (飯糰編)']),
        lang: z.enum(['zh', 'en']).default('zh'),
        draft: z.boolean().default(false),
        featured: z.boolean().default(false),
        youtube: z.array(z.string()).default([]),

        // category === 'food'
        foodReview: z
          .object({
            location: z.string(),
            address: z.string().optional(),
            mapEmbed: z.string().url().optional(),
            ratings: z.object({
              transport: z.number().min(0).max(5), // 交通
              ambience: z.number().min(0).max(5), // 環境
              service: z.number().min(0).max(5), // 服務
              taste: z.number().min(0).max(5), // 美味
              price: z.number().min(0).max(5), // 價格
            }),
          })
          .optional(),

        // category === 'stock'
        stock: z
          .object({
            marketDate: z.coerce.date(),
            charts: z.array(image()).default([]),
            archived: z.boolean().default(true),
          })
          .optional(),
      })
      .superRefine((d, ctx) => {
        if (d.category === 'food' && !d.foodReview)
          ctx.addIssue({ code: 'custom', message: 'food posts require a foodReview block' });
        if (d.category === 'stock' && !d.stock)
          ctx.addIssue({ code: 'custom', message: 'stock posts require a stock block' });
      }),
});

export const collections = { blog };
