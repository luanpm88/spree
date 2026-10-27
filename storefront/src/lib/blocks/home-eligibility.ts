/**
 * Which categories reach the business front page, and in what order.
 *
 * His rules, from "Homepage Category Eligibility.docx" (8 Oct), as written:
 *
 *   - the category is active/published
 *   - at least 4 active subcategories, each with at least 4 active products
 *   - only active/published products count
 *   - ranked by a Customer Interest Score: product views across the products
 *     in its qualifying subcategories, over a rolling 90 days
 *   - the top 6 qualifying categories are shown
 *   - per category, Homepage Override On/Off: On makes it eligible even when it
 *     is too small, but NEVER when it is unpublished
 *   - per category, Homepage Position: Automatic or 1 to 6
 *   - the admin says why each category is or is not showing
 *
 * ── what this file is ───────────────────────────────────────────────────────
 *
 * Pure: it takes plain facts about each category and returns a decision. It
 * fetches nothing and knows neither Spree 5.6 taxons nor 6.0 categories, because
 * this shop moves from one to the other and the rules must not be written twice.
 * The data layer for each version turns its own API into `CategoryFacts`.
 *
 * ── where his document is silent, and what this does ────────────────────────
 *
 * 1. No view data yet. Nothing in Spree counts product views, so for the first
 *    90 days there is no score. Until a category has views, it ranks by the
 *    number of active products in its qualifying subcategories (proposed to him
 *    on 27 Oct). A category with views always ranks above one without, so the
 *    fallback fades out as soon as real interest exists.
 * 2. Two categories pinned to the same position. The one with the higher score
 *    keeps it; the other is treated as Automatic and says so in its reason.
 * 3. A position set while the override is Off. The position still applies when
 *    the category qualifies on its own; it does not make a small category show.
 * 4. Ties. Equal scores fall back to the name, so the page never reshuffles
 *    between two renders for no reason.
 */

export const HOME_CATEGORY_SLOTS = 6;
export const MIN_SUBCATEGORIES = 4;
export const MIN_PRODUCTS_PER_SUBCATEGORY = 4;

export type HomePosition = "automatic" | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * His per-category settings: Homepage Override and Homepage Position.
 *
 * Keyed by permalink, so a database reload does not lose them. Today they come
 * from the shop's content file; once the admin carries them as category custom
 * fields, that becomes the source and this shape stays.
 */
export type HomeCategorySettings = Record<
  string,
  { override?: boolean; position?: HomePosition }
>;

export interface SubcategoryFacts {
  /** Published. An unpublished subcategory never counts. */
  active: boolean;
  /** Active (published, available) products in it. */
  activeProducts: number;
  /** Product views on those products over the last 90 days, if counted. */
  views90d?: number;
}

export interface CategoryFacts {
  id: string;
  name: string;
  permalink: string;
  active: boolean;
  override: boolean;
  position: HomePosition;
  subcategories: SubcategoryFacts[];
}

export type HomeCategoryStatus =
  | "shown"
  | "eligible_not_in_top"
  | "not_eligible"
  | "unpublished";

export interface HomeCategoryDecision {
  category: CategoryFacts;
  status: HomeCategoryStatus;
  /** 1 to 6 when shown. */
  slot?: number;
  qualifyingSubcategories: number;
  /** Views over 90 days, or null when nothing has been counted yet. */
  views: number | null;
  /** Active products in qualifying subcategories: the fallback score. */
  products: number;
  /** The line the admin shows, in his own wording where he gave one. */
  reason: string;
}

function qualifies(sub: SubcategoryFacts): boolean {
  return sub.active && sub.activeProducts >= MIN_PRODUCTS_PER_SUBCATEGORY;
}

interface Scored {
  category: CategoryFacts;
  qualifyingSubcategories: number;
  views: number | null;
  products: number;
  meetsRules: boolean;
}

function score(category: CategoryFacts): Scored {
  const good = category.subcategories.filter(qualifies);
  const counted = good.filter((s) => typeof s.views90d === "number");
  return {
    category,
    qualifyingSubcategories: good.length,
    views: counted.length
      ? counted.reduce((sum, s) => sum + (s.views90d ?? 0), 0)
      : null,
    products: good.reduce((sum, s) => sum + s.activeProducts, 0),
    meetsRules: good.length >= MIN_SUBCATEGORIES,
  };
}

/** Higher first: views beat no views, then views, then products, then name. */
function byInterest(a: Scored, b: Scored): number {
  if ((a.views === null) !== (b.views === null))
    return a.views === null ? 1 : -1;
  if (a.views !== null && b.views !== null && a.views !== b.views)
    return b.views - a.views;
  if (a.products !== b.products) return b.products - a.products;
  return a.category.name.localeCompare(b.category.name);
}

function eligibilityLine(s: Scored): string {
  return s.meetsRules
    ? `Normal eligibility: eligible (${s.qualifyingSubcategories} of ${MIN_SUBCATEGORIES} required subcategories)`
    : `Normal eligibility: Not yet eligible (${s.qualifyingSubcategories} of ${MIN_SUBCATEGORIES} required subcategories)`;
}

/**
 * Decide the front page categories. Returns every category with a decision,
 * shown ones first in slot order, so the admin can list them all with a reason.
 */
export function decideHomeCategories(
  categories: CategoryFacts[],
): HomeCategoryDecision[] {
  const scored = categories.map(score);

  const candidates = scored.filter(
    (s) => s.category.active && (s.meetsRules || s.category.override),
  );

  const slots = new Map<number, Scored>();
  const bumped = new Set<string>();

  // Pinned positions first, the higher interest keeping a contested slot.
  const pinned = candidates
    .filter((s) => s.category.position !== "automatic")
    .sort(byInterest);
  for (const s of pinned) {
    const want = s.category.position as number;
    if (!slots.has(want)) slots.set(want, s);
    else bumped.add(s.category.id);
  }

  // Everything else fills the free slots by interest.
  const automatic = candidates
    .filter((s) => ![...slots.values()].includes(s))
    .sort(byInterest);
  let next = 0;
  for (let slot = 1; slot <= HOME_CATEGORY_SLOTS; slot++) {
    if (slots.has(slot)) continue;
    const s = automatic[next++];
    if (!s) break;
    slots.set(slot, s);
  }

  const slotOf = new Map<string, number>();
  for (const [slot, s] of slots) slotOf.set(s.category.id, slot);

  const decisions = scored.map((s): HomeCategoryDecision => {
    const base = {
      category: s.category,
      qualifyingSubcategories: s.qualifyingSubcategories,
      views: s.views,
      products: s.products,
    };
    const rules = eligibilityLine(s);

    if (!s.category.active) {
      return {
        ...base,
        status: "unpublished",
        reason: `Homepage status: Hidden, the category is not published${s.category.override ? " (the override never shows an unpublished category)" : ""}. ${rules}`,
      };
    }

    const slot = slotOf.get(s.category.id);
    const how = s.category.override
      ? "Manual Override"
      : s.category.position !== "automatic"
        ? `Fixed position ${s.category.position}`
        : "Automatic, by customer interest";
    const clash = bumped.has(s.category.id)
      ? ` Position ${s.category.position} is taken by a category with more interest, so it was ranked automatically.`
      : "";

    if (slot !== undefined) {
      return {
        ...base,
        status: "shown",
        slot,
        reason: `Homepage status: Position ${slot}, ${how}. ${rules}.${clash}`,
      };
    }
    if (s.meetsRules || s.category.override) {
      return {
        ...base,
        status: "eligible_not_in_top",
        reason: `Homepage status: Not shown, eligible but not in the top ${HOME_CATEGORY_SLOTS}. ${rules}.${clash}`,
      };
    }
    return {
      ...base,
      status: "not_eligible",
      reason: `Homepage status: Not shown. ${rules}`,
    };
  });

  return decisions.sort((a, b) => {
    if (a.slot !== undefined && b.slot !== undefined) return a.slot - b.slot;
    if (a.slot !== undefined) return -1;
    if (b.slot !== undefined) return 1;
    return a.category.name.localeCompare(b.category.name);
  });
}

/** Just the categories to render, in slot order. */
export function homeCategories(categories: CategoryFacts[]): CategoryFacts[] {
  return decideHomeCategories(categories)
    .filter((d) => d.status === "shown")
    .map((d) => d.category);
}
