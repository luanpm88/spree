import { Collection } from "@/components/blocks/Collection";
import type { CategoryRowsBlock } from "@/lib/blocks/types";
import { getCategories } from "@/lib/data/categories";

interface CategoryRowsProps extends CategoryRowsBlock {
  basePath: string;
  currency?: string;
}

/**
 * One product row per main category.
 *
 * His words on task 4430: "Products showing below under Main categories, then
 * show 4 products per category as static or scrolling".
 *
 * ── it renders Collection rather than reimplementing it ─────────────────────
 *
 * Collection already fetches a category's products, lays out four across,
 * carousels on narrow screens, hides prices on a shop that requires an account,
 * and renders NOTHING when the category comes back empty. Every one of those is
 * needed here, and a second implementation of any of them is a second thing to
 * get wrong. This block's only job is deciding WHICH categories.
 *
 * ── the categories come from his catalogue, not from build args ─────────────
 *
 * The retail shops pass three category ids in as build args. This shop has
 * thirteen main categories today and he adds them himself in the admin. Reading
 * them here means a category he creates appears on the home page on the next
 * revalidate, with nobody asked for an id and nothing to rebuild.
 *
 * ── the failure this must not have ──────────────────────────────────────────
 *
 * If the category list cannot be fetched, this renders nothing and the rest of
 * the page stands. A home page that throws because a row would not load is worse
 * than a home page with no rows, and on this project a page that answers 200 with
 * an empty body has already been mistaken for a working shop once.
 */
export async function CategoryRows({
  under,
  perRow = 4,
  maxRows = 12,
  viewAllLabel,
  exclude = [],
  basePath,
  currency,
}: CategoryRowsProps) {
  let roots: Awaited<ReturnType<typeof getCategories>>["data"] = [];
  try {
    const response = await getCategories();
    roots = response.data ?? [];
  } catch {
    return null;
  }

  // `under` names a root whose CHILDREN are the shopping categories, which is the
  // shape the retail shops have. Absent, the roots themselves are the categories,
  // which is the shape this shop has: thirteen taxonomies, one per main category.
  const source = under
    ? (roots.find((c) => c.permalink === under)?.children ?? [])
    : roots;

  const skip = new Set(exclude);
  const categories = source
    .filter((c) => !skip.has(c.permalink))
    .slice(0, maxRows);

  if (categories.length === 0) return null;

  return (
    <>
      {categories.map((category) => (
        <Collection
          key={category.id}
          type="collection"
          heading={category.name}
          source={{ kind: "category", id: category.id }}
          limit={perRow}
          {...(viewAllLabel
            ? {
                viewAll: {
                  label: viewAllLabel,
                  href: `/c/${category.permalink}`,
                },
              }
            : {})}
          basePath={basePath}
          currency={currency}
        />
      ))}
    </>
  );
}
