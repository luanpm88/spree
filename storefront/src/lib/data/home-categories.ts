import { cache } from "react";
import {
  type CategoryFacts,
  decideHomeCategories,
  type HomeCategoryDecision,
  type HomeCategorySettings,
} from "@/lib/blocks/home-eligibility";
import { getCategories, getCategoryProducts } from "@/lib/data/categories";

interface ApiCategory {
  id: string;
  name: string;
  permalink: string;
  parent_id?: string | null;
  depth?: number;
}

/**
 * Spree 5.6 Store API → the facts the rules need.
 *
 * - Main categories are the roots. On this shop each main category is a root of
 *   its own (13, measured 27 Oct), and subcategories are their children.
 * - The Store API serves only published categories, and its product list only
 *   products a shopper can buy, so everything counted here is "active" in his
 *   sense without a second check.
 * - Products per subcategory come from the list's own count (`meta.count`),
 *   asking for one product, so this costs one small request per subcategory.
 * - Views are not counted anywhere yet, so `views90d` is left out and the rules
 *   fall back to product counts (lib/blocks/home-eligibility.ts).
 *
 * For 6.0 the same function is written against the 6.0 SDK and returns the same
 * shape; the rules do not change.
 */
export async function loadCategoryFacts(
  settings: HomeCategorySettings = {},
): Promise<CategoryFacts[]> {
  const response = await getCategories({ limit: 100 });
  const all = (response.data ?? []) as ApiCategory[];
  const roots = all.filter((c) => !c.parent_id);

  return Promise.all(
    roots.map(async (root): Promise<CategoryFacts> => {
      const children = all.filter((c) => c.parent_id === root.id);
      const subcategories = await Promise.all(
        children.map(async (child) => {
          try {
            const products = await getCategoryProducts(child.id, { limit: 1 });
            const count =
              (products.meta as { count?: number } | undefined)?.count ??
              products.data?.length ??
              0;
            return { active: true, activeProducts: count };
          } catch {
            return { active: true, activeProducts: 0 };
          }
        }),
      );
      const own = settings[root.permalink] ?? {};
      return {
        id: root.id,
        name: root.name,
        permalink: root.permalink,
        active: true,
        override: own.override ?? false,
        position: own.position ?? "automatic",
        subcategories,
      };
    }),
  );
}

/**
 * The decision, once per request. Three blocks on the page read it, and React's
 * cache makes them share one set of API calls.
 */
export const homeCategoryDecisions = cache(
  async (settingsKey: string): Promise<HomeCategoryDecision[]> => {
    const settings = JSON.parse(settingsKey) as HomeCategorySettings;
    try {
      return decideHomeCategories(await loadCategoryFacts(settings));
    } catch {
      return [];
    }
  },
);
