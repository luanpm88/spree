import Link from "next/link";
import type { BrowseCategoriesBlock } from "@/lib/blocks/types";
import { getCategories } from "@/lib/data/categories";

interface BrowseCategoriesProps extends BrowseCategoriesBlock {
  basePath: string;
}

interface ApiCategory {
  id: string;
  name: string;
  permalink: string;
  parent_id?: string | null;
  image_url?: string | null;
}

/**
 * "Browse by Category": every main category as a tile that links to it.
 *
 * Read from his catalogue, so a category he adds in the admin appears here on
 * the next revalidate. A category image is used when he has set one; most have
 * none today (measured 27 Oct: image_url null on all 15), so the tile is the
 * name on a tinted ground rather than a picture that is not there.
 *
 * Styling is deliberately plain until his design arrives: this block is the
 * structure and the data, and the look is his.
 */
export async function BrowseCategories({
  heading,
  exclude = [],
  basePath,
}: BrowseCategoriesProps) {
  let roots: ApiCategory[] = [];
  try {
    const response = await getCategories({ limit: 100 });
    roots = ((response.data ?? []) as ApiCategory[]).filter(
      (c) => !c.parent_id && !exclude.includes(c.permalink),
    );
  } catch {
    return null;
  }
  if (roots.length === 0) return null;

  return (
    <section className="container mx-auto px-4 py-12 sm:px-6 lg:px-8">
      <h2 className="mb-8 text-2xl font-bold tracking-wide">{heading}</h2>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {roots.map((c) => (
          <li key={c.id}>
            <Link
              href={`${basePath}/c/${c.permalink}`}
              className="flex aspect-[4/3] items-end overflow-hidden rounded-lg bg-[#F7F7F4] bg-cover bg-center p-4 font-semibold transition hover:shadow-md"
              style={
                c.image_url ? { backgroundImage: `url(${c.image_url})` } : {}
              }
            >
              <span className="rounded bg-white/90 px-2 py-1">{c.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
