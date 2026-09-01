/**
 * Which shop's WORDS this build carries.
 *
 * ── why this is not the country ─────────────────────────────────────────────
 *
 * Every per-shop lookup in this codebase used NEXT_PUBLIC_DEFAULT_COUNTRY as its
 * key: the home page copy, the six content pages, the brand images, the footer
 * links, the announcement bar, the theme. That worked while shop and country were
 * the same word. On the seven retail shops they are: the New Zealand shop is
 * `nz` and its country is `nz`.
 *
 * The commercial shop broke that assumption. It is a New Zealand business, so it
 * builds with NEXT_PUBLIC_DEFAULT_COUNTRY=nz, which is correct for currency,
 * market and URLs. But it is NOT the New Zealand retail shop, and using the
 * country as the content key made it read the retail shop's wording.
 *
 * Measured on 1 Sep, before this existed:
 *
 *   /pages/about              404   his own About page was in the repo, keyed
 *   /pages/faq                404   `business`, and nothing ever looked there
 *   /pages/product-sourcing   404
 *
 * and HOME_BY_SHOP has no `nz`-shaped entry for it either, so the home page fell
 * through to the retail shop's entry. A rebuild would have put that shop's
 * welcome copy, its About story and its newsletter box on a business to business
 * site. That is the exact fault content.ts opens by warning about, and it was
 * armed rather than triggered only because the shop had not been rebuilt since
 * 13 August.
 *
 * content.ts already carried the other half of this fix and said so:
 *
 *   "A key of its own exists because the commercial shop had none ... That is the
 *    reason these pages had nowhere correct to go and is why moving them is only
 *    half the fix."
 *
 * This is the other half.
 *
 * ── why a fallback rather than a new required variable ──────────────────────
 *
 * Falling back to the country means the seven retail shops need no change at all
 * and cannot be broken by this. They do not set NEXT_PUBLIC_SHOP_KEY, so they
 * keep resolving exactly as before. Only a shop whose words differ from its
 * country sets it.
 *
 * It is a NEXT_PUBLIC_ variable, so it is baked in at BUILD time and a running
 * container will never show it in printenv. Setting it at runtime does nothing.
 * It has to be a build arg, declared in the Dockerfile, or Docker drops it in
 * silence: see script/check_storefront_args.sh, which exists because that
 * happened.
 */
export function shopKey(): string {
  return (
    process.env.NEXT_PUBLIC_SHOP_KEY ||
    process.env.NEXT_PUBLIC_DEFAULT_COUNTRY ||
    ""
  ).toLowerCase();
}
