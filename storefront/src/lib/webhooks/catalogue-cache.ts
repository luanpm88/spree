import { revalidateTag } from "next/cache";
import type { WebhookHandler } from "@/lib/spree/webhooks";

/**
 * Drop the catalogue caches when the shop changes something.
 *
 * ── the fault this exists for ───────────────────────────────────────────────
 *
 * Every catalogue read is cached on the server for ten minutes and nothing ever
 * cleared it. Ten minutes was not a policy, it was just how long an entry lived.
 * So an edit in the admin did not appear until the entry aged out.
 *
 * The client found it twice in one day, and the second report is the one that
 * identifies it beyond doubt:
 *
 *   "I was in Brave browser, logged into nz admin, then checked the front end in
 *    3 other browsers and all said out of stock"
 *
 * Three browsers agreeing is the whole diagnosis. A browser cache would differ
 * between them. Only a cache on the server gives three browsers the same stale
 * answer. Measured afterwards: the stock on that product had been changed three
 * minutes before he looked.
 *
 *   "Lilian changed an image and then went to view it, but it never changed;
 *    about 10 min later it changed."
 *
 * Same cause, and the ten minutes in his own sentence is the cache life.
 *
 * ── why four tags clear everything ─────────────────────────────────────────
 *
 * A cached entry is stale as soon as ANY of its tags is revalidated, and the
 * catalogue entries deliberately overlap:
 *
 *   cachedListProducts        products[-wholesale]
 *   cachedGetProduct          products[-wholesale]  AND  product:<slug>[-wholesale]
 *   cachedGetCategoryProducts products                AND  category-products:<id>
 *   cachedGetProductFilters   product-filters[-wholesale]
 *
 * So `products` alone reaches the listing, every category page, and every product
 * detail page, because each of those carries it. Only the filter facets sit on a
 * tag of their own, and they have to go too: a price or stock change moves what
 * the price and availability facets should say.
 *
 * That is the whole list. An earlier draft of this added a new shared tag to
 * every cached function on the theory that the per-category tags would have to be
 * enumerated from the payload. Reading the tags first showed the overlap already
 * does that job, so nothing in lib/data has to change at all.
 *
 * ── the images ─────────────────────────────────────────────────────────────
 *
 * Image urls are carried inside the product payload, so the same tags cover a
 * changed photo. The separate next/image optimiser cache is keyed on the url, and
 * Active Storage gives a replaced file a new key and therefore a new url, so it
 * fetches rather than serving the old bytes.
 *
 * ── what this does NOT do ──────────────────────────────────────────────────
 *
 * It does not clear `categories`, `category` or `category-banner`. Those are
 * taxon content rather than product content, they are handled by their own events
 * if we subscribe to them later, and clearing them on every stock change would
 * throw away a cache with an hours-long life for no reason.
 */
const CATALOGUE_TAGS = [
  "products",
  "products-wholesale",
  "product-filters",
  "product-filters-wholesale",
] as const;

/**
 * Deliberately not idempotency-guarded, unlike the email handlers beside it.
 *
 * A duplicate email is a customer receiving the same message twice. A duplicate
 * cache purge is the same four strings marked stale again, which costs one
 * refetch. The guard would add state to protect against nothing, and worse: a
 * retry of a delivery whose first attempt failed AFTER purging would be skipped,
 * leaving the shop stale for the full ten minutes. Failing towards purging is the
 * safe direction here, and it is the opposite direction from an email.
 */
export const handleCatalogueChange: WebhookHandler = async (event) => {
  for (const tag of CATALOGUE_TAGS) {
    // Two arguments, and the second is not optional in Next 16.
    //
    // revalidateTag(tag, profile) is the route-handler form. updateTag(tag) is
    // the one-argument sibling and it is for Server Actions, where it exists to
    // give read-your-own-writes on the same request. A webhook is neither the
    // user nor the same request, so this is the right half of that pair.
    //
    // The profile names the cache life to apply to what it marks stale, and it
    // has to be one declared in next.config. "tenMinutes" is what every
    // catalogue entry already uses, so purging under the same profile keeps the
    // behaviour identical to an entry ageing out naturally.
    revalidateTag(tag, "tenMinutes");
  }

  // Logged because a purge is silent by nature: revalidateTag accepts any string
  // and reports nothing, so a tag renamed in lib/data would keep answering 200
  // here while the shop stayed stale. This line is what makes that visible in the
  // container log, and script/check_cache_purge asserts the behaviour end to end.
  console.log(
    `[webhooks] ${event.name} purged ${CATALOGUE_TAGS.length} catalogue tags`,
  );
};

/**
 * Which events mean the catalogue changed.
 *
 * Read off the running application rather than guessed: every one of these models
 * has lifecycle events switched on, so each really does publish. Measured on the
 * live New Zealand shop:
 *
 *   Spree::Product      product.created / .updated / .deleted
 *   Spree::Variant      variant.*
 *   Spree::StockItem    stock_item.*
 *   Spree::Image        image.*
 *   Spree::Asset        asset.*
 *   Spree::Price        price.*
 *
 * The image one is the one worth checking rather than assuming. Spree::Publishable
 * defaults lifecycle_events_enabled to FALSE, so a model that never calls
 * publishes_lifecycle_events announces nothing at all, and a fix that caught stock
 * and missed photographs would have looked finished. Spree::Image and
 * Spree::Asset both have it enabled, which is why Lilian's case is covered.
 *
 * Deletions are included. A removed photo or a discontinued product has to leave
 * the shop as promptly as a new one arrives.
 */
export const CATALOGUE_EVENTS = [
  "product.created",
  "product.updated",
  "product.deleted",
  "variant.created",
  "variant.updated",
  "variant.deleted",
  "stock_item.created",
  "stock_item.updated",
  "stock_item.deleted",
  "image.created",
  "image.updated",
  "image.deleted",
  "asset.created",
  "asset.updated",
  "asset.deleted",
  "price.created",
  "price.updated",
  "price.deleted",
] as const;
