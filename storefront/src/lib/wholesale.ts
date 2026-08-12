import type { Customer } from "@spree/sdk";
import { INTERNAL_ORIGIN, resolveLocalPath } from "@/lib/utils/path";

/**
 * The seeded demo group name, kept only for the sample data. Approval is NOT
 * matched against it. See `isWholesaleApproved`.
 */
export const WHOLESALE_GROUP_NAME = "Wholesale";

/**
 * Minimum quantity of a single item required to unlock wholesale (trade) pricing.
 * Mirrors the VolumeRule min_quantity on the seeded "Wholesale" price list
 * (spree/core/db/sample_data/wholesale.rb). This is a demo constant — the
 * production version would read the applicable volume rule's min_quantity from
 * the API per variant. Keep in sync with the seed if the seed changes.
 */
export const WHOLESALE_MIN_QUANTITY = 10;

/**
 * Whether a customer is an approved wholesale buyer.
 *
 * Approval is membership of ANY customer group, not of one group matched by
 * name. This deliberately mirrors the server, which decides the same question in
 * `Spree::Api::V3::StorefrontGatingDecorator#approved_for_pricing?`, and the two
 * must agree: the server decides whether prices are in the response at all, this
 * decides what the page says instead. Disagreement produces the worst outcome of
 * the two, a page that says "awaiting approval" over prices it was given, or an
 * ordering surface opened to someone the API will refuse.
 *
 * Matching on a name is what this used to do, against a hardcoded "Wholesale".
 * The client's group is "Bulk Orders", so that test was already wrong here, and
 * it fails silently: a rename in the admin, or a second group for distributors,
 * locks out approved buyers with no error anywhere.
 */
export function isWholesaleApproved(customer: Customer | null): boolean {
  return Boolean(customer?.customer_groups?.length);
}

/**
 * The portal's sign-in destination, optionally carrying `returnTo` as the
 * `?redirect=` target. On a `prices_hidden` channel the catalog root renders for
 * guests, so sign-in affordances need this dedicated page — pointing them at the
 * catalog would land the buyer back where they started. A `redirect` already on
 * `returnTo` is dropped: it is a stale return target from an earlier round trip,
 * and keeping it would nest redirects inside redirects.
 */
export function wholesaleSignInHref(
  basePath: string,
  returnTo?: string | null,
): string {
  const signInPath = `${basePath}/wholesale/sign-in`;
  const target = resolveLocalPath(returnTo);
  if (!target) return signInPath;

  const url = new URL(target, INTERNAL_ORIGIN);
  url.searchParams.delete("redirect");
  const returnPath = `${url.pathname}${url.search}${url.hash}`;
  if (returnPath === signInPath) return signInPath;

  return `${signInPath}?redirect=${encodeURIComponent(returnPath)}`;
}
