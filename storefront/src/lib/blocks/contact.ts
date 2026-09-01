import { CONTACT_BY_SHOP } from "@/lib/blocks/content";
import { shopKey } from "@/lib/shop-key";

/**
 * This shop's contact page: its own form, its own words.
 *
 * Same shape as home.ts and pages.ts. The shop is chosen by the country baked
 * into the build, so a shop with no entry gets nothing rather than borrowing
 * another shop's form. That matters more here than anywhere else on the site: a
 * wrong home page heading is embarrassing, a wrong form id sends a customer's
 * enquiry to another country's inbox and nobody finds out.
 */
export interface ShopContact {
  formUrl: string;
  title: string;
  intro: string;
}

export function shopContact(): ShopContact | undefined {
  const shop = shopKey();
  return CONTACT_BY_SHOP[shop];
}
