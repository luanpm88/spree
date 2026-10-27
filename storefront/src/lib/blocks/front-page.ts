import { HOME_BY_SHOP } from "@/lib/blocks/content";
import { homePage } from "@/lib/blocks/home";
import type { HomeCategorySettings } from "@/lib/blocks/home-eligibility";
import type { Block, PageDefinition } from "@/lib/blocks/types";
import { shopKey } from "@/lib/shop-key";

/**
 * The business front page in his preferred order (8 Oct, "My preferred homepage
 * order"):
 *
 *   Hero Slider, Trust Strip,
 *   1 Featured Products, 2 Top Category, 3 Full-width Banner Advertisement,
 *   4 Second Category, 5 Browse by Category, 6 Newsletter, 7 Special Offers,
 *   8 Third Category, 9 Fourth, 10 Fifth, 11 Sixth,
 *   Supply Benefits, Footer.
 *
 * His Word doc places the six categories differently (1 to 3 before Featured
 * Products, 4 to 6 after the advertisement). The table is built, being the one
 * he called his preferred order; the question went to him on 27 Oct, and the
 * other order is a change of the slot ranges below, nothing more.
 *
 * The blocks already on the live page (slider, trust strip, newsletter, supply
 * strip) are taken from homePage() as they are, so the preview and the live page
 * cannot drift apart in the parts they share.
 */

interface FrontPageCopy {
  featured?: { heading: string; permalink: string };
  specialOffers?: string;
  browse?: string;
  viewAll?: string;
  bannerAd?: {
    image?: string;
    width?: number;
    height?: number;
    alt?: string;
    href?: string;
  };
  categories?: HomeCategorySettings;
}

function frontPageCopy(): FrontPageCopy {
  const shop = shopKey() as keyof typeof HOME_BY_SHOP;
  const entry = HOME_BY_SHOP[shop] as { frontPage?: FrontPageCopy } | undefined;
  return entry?.frontPage ?? {};
}

export function businessFrontPage(
  storeName: string,
  { preview = false }: { preview?: boolean } = {},
): PageDefinition {
  const live = homePage(storeName).blocks;
  const slider = live.filter((b) => b.type === "banner_slider");
  const bands = live.filter((b) => b.type === "icon_banner");
  const trust = bands.slice(0, 1);
  const supply = bands.slice(1, 2);
  const newsletter = live.filter((b) => b.type === "subscribe");

  const C = frontPageCopy();
  const viewAllLabel = C.viewAll ?? "Explore category";
  const settings = C.categories ?? {};
  const slots = (from: number, to: number): Block => ({
    type: "home_categories",
    from,
    to,
    perRow: 4,
    viewAllLabel,
    settings,
  });

  const blocks: Block[] = [
    ...slider,
    ...trust,
    ...(C.featured
      ? [
          {
            type: "collection" as const,
            heading: C.featured.heading,
            source: {
              kind: "category_permalink" as const,
              permalink: C.featured.permalink,
            },
            viewAll: {
              label: viewAllLabel,
              href: `/c/${C.featured.permalink}`,
            },
            limit: 4,
          },
        ]
      : []),
    slots(1, 1),
    { type: "banner_ad", ...(C.bannerAd ?? {}), preview },
    slots(2, 2),
    { type: "browse_categories", heading: C.browse ?? "Browse by Category" },
    ...newsletter,
    {
      type: "collection",
      heading: C.specialOffers ?? "Special Offers",
      source: { kind: "on_sale" },
      limit: 4,
    },
    slots(3, 6),
    ...supply,
  ];

  return { name: storeName, blocks };
}
