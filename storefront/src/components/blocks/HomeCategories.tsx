import { Collection } from "@/components/blocks/Collection";
import type { HomeCategoriesBlock } from "@/lib/blocks/types";
import { homeCategoryDecisions } from "@/lib/data/home-categories";

interface HomeCategoriesProps extends HomeCategoriesBlock {
  basePath: string;
  currency?: string;
}

/**
 * The category rows for a run of slots, as his rules choose them.
 *
 * A slot with no category renders nothing, and a chosen category with no
 * products renders nothing (Collection's own rule), so a young shop shows fewer
 * rows rather than headings over gaps.
 */
export async function HomeCategories({
  from,
  to,
  perRow = 4,
  viewAllLabel,
  basePath,
  currency,
  settings = {},
}: HomeCategoriesProps) {
  const decisions = await homeCategoryDecisions(JSON.stringify(settings));
  const chosen = decisions.filter(
    (d) =>
      d.status === "shown" &&
      d.slot !== undefined &&
      d.slot >= from &&
      d.slot <= to,
  );
  if (chosen.length === 0) return null;

  return (
    <>
      {chosen.map(({ category }) => (
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
