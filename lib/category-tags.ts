export const MAX_CATEGORY_TAGS = 8;
export const MAX_CATEGORY_TAG_LENGTH = 80;
const aliases: Record<string,string> = {
  "children's books": "Children's Books", "children’s books": "Children's Books",
  "sci-fi": "Science Fiction", "sci fi": "Science Fiction", "science-fiction": "Science Fiction",
  "non-fiction": "Nonfiction", "non fiction": "Nonfiction",
  "rpg": "Tabletop Roleplaying", "rpgs": "Tabletop Roleplaying", "role-playing games": "Tabletop Roleplaying",
  "comics": "Comics & Graphic Novels", "graphic novel": "Comics & Graphic Novels", "graphic novels": "Comics & Graphic Novels",
  "αταξινόμητα": "Uncategorized", "uncategorised": "Uncategorized",
};
export function normalizeCategoryTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length>MAX_CATEGORY_TAGS || value.some(tag => typeof tag !== "string" || !tag.trim() || [...tag.trim()].length>MAX_CATEGORY_TAG_LENGTH)) {
    throw new Error("categories must be an array of at most 8 non-empty tags, each at most 80 characters.");
  }
  return [...new Set(value.map(tag => {
    const normalized = tag.trim().replace(/\s+/g," ").toLocaleLowerCase("en");
    return aliases[normalized] ?? normalized.replace(/(^|[^\p{L}\p{N}])\p{L}/gu,(char: string) => char.toLocaleUpperCase("en"));
  }))];
}
// The singular field remains a compatibility alias for older consumers.
export function categoryTags(categories: string[] | undefined, category?: string | null): string[] {
  if (categories) return categories.length ? categories : ["Uncategorized"];
  return category && !["αταξινόμητα","uncategorized","uncategorised"].includes(category.toLocaleLowerCase()) ? [category] : ["Uncategorized"];
}
