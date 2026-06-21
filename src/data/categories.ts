export type CategoryKey = "food" | "movie" | "essay" | "investment";

export interface CategoryMeta {
  label: string; // 中文顯示
  // chip color tokens (light bg / light text); dark handled in CSS
  bg: string;
  fg: string;
}

export const categories: Record<CategoryKey, CategoryMeta> = {
  food: { label: "食記", bg: "var(--rice-100)", fg: "var(--rice-800)" },
  movie: { label: "影評", bg: "#e7f0fb", fg: "#1862b5" },
  essay: { label: "隨筆", bg: "var(--nori-50)", fg: "var(--nori-800)" },
  investment: { label: "投資", bg: "#ffe7e1", fg: "var(--ume-700)" },
};

export const categoryOrder: CategoryKey[] = [
  "food",
  "movie",
  "essay",
  "investment",
];
