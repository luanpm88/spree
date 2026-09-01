import { FOOTER_BY_SHOP } from "@/lib/blocks/content";
import { shopKey } from "@/lib/shop-key";

/**
 * The footer's legal name and outside links, for this shop.
 *
 * Separate from the brand images and from the page copy because it is neither:
 * one is a legal string and the others are third party profiles. Both are per
 * shop, and both are absent for a shop that has not supplied them, in which case
 * the footer signs with the header name and shows no social row rather than
 * showing another country's accounts.
 */
export interface ShopFooter {
  legalName?: string;
  social?: { label: string; href: string }[];
}

const EMPTY: ShopFooter = {};

export function shopFooter(): ShopFooter {
  const shop = shopKey() as keyof typeof FOOTER_BY_SHOP;
  return FOOTER_BY_SHOP[shop] ?? EMPTY;
}
