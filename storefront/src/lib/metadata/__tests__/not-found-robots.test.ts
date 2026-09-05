import { describe, expect, it } from "vitest";

/**
 * A missing record must tell crawlers not to index it.
 *
 * ── the fault this exists for ───────────────────────────────────────────────
 *
 * The storefront runs with cacheComponents, so the static shell goes out with a
 * 200 before `notFound()` runs. That is written up in the pages route and was
 * accepted deliberately: a real 404 costs turning cacheComponents off for the
 * whole site, which is a trade nobody asked for.
 *
 * What had never been measured is what those 200s SAID. Checked on the live
 * shops on 5 Sep, on a slug that cannot exist:
 *
 *   /pages/<slug>      200, no robots directive, and the SHOP'S OWN title
 *   /products/<slug>   200, no robots directive, "Product Not Found | <shop>"
 *   /c/<slug>          200, no robots directive, "Category Not Found | <shop>"
 *   /policies/<slug>   200, no robots directive, "Policy Not Found | <shop>"
 *
 * Next's own 404 page does carry noindex, so the shops were inconsistent with
 * their own framework. A search engine could index an unlimited number of empty
 * addresses on six shops, and on /pages they arrived under a title that reads
 * like a real page.
 *
 * These assertions do not make the status correct. They pin the thing that
 * removes the harm the wrong status was doing, and they exist because a
 * `robots` line is exactly the sort of thing a later tidy-up deletes as noise.
 */
describe("metadata for a record that does not exist", () => {
  it("tells crawlers not to index a missing product", async () => {
    const { productNotFoundMetadata } = await import("@/lib/metadata/product");
    expect(productNotFoundMetadata().robots).toEqual({
      index: false,
      follow: false,
    });
  });

  it("tells crawlers not to index a missing category", async () => {
    const { categoryNotFoundMetadata } = await import(
      "@/lib/metadata/category"
    );
    expect(categoryNotFoundMetadata().robots).toEqual({
      index: false,
      follow: false,
    });
  });

  it("keeps a title on both, so a person still sees what happened", () => {
    // The directive is for the crawler. The title is for whoever followed the
    // broken link, and dropping it while adding robots would trade one problem
    // for another.
    return Promise.all([
      import("@/lib/metadata/product"),
      import("@/lib/metadata/category"),
    ]).then(([p, c]) => {
      expect(p.productNotFoundMetadata().title).toBeTruthy();
      expect(c.categoryNotFoundMetadata().title).toBeTruthy();
    });
  });
});
