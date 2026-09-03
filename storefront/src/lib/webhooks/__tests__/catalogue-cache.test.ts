import { revalidateTag } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CATALOGUE_EVENTS,
  handleCatalogueChange,
} from "@/lib/webhooks/catalogue-cache";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

const event = (name: string) =>
  ({
    id: "evt_1",
    name,
    created_at: "2026-09-02T00:00:00Z",
    data: {},
    metadata: { spree_version: "5.6.1" },
  }) as never;

beforeEach(() => {
  vi.mocked(revalidateTag).mockClear();
});

/**
 * The shop owner reported this twice in one day and both reports were the same
 * cache: a stock change that did not show, and an image change that showed ten
 * minutes later. These tests pin the two things that would make the fix look
 * finished while being useless.
 */
describe("handleCatalogueChange", () => {
  it("purges the four tags that reach every catalogue surface", async () => {
    await handleCatalogueChange(event("stock_item.updated"));

    const purged = vi.mocked(revalidateTag).mock.calls.map(([tag]) => tag);
    expect(purged).toEqual([
      "products",
      "products-wholesale",
      "product-filters",
      "product-filters-wholesale",
    ]);
  });

  it("passes a cache life profile, because the one argument form is a different function", () => {
    // revalidateTag(tag) alone does not type check in Next 16, and updateTag is
    // the Server Action sibling rather than a drop-in. A call with a missing
    // profile is the shape that would fail at runtime rather than in the editor.
    return handleCatalogueChange(event("product.updated")).then(() => {
      for (const call of vi.mocked(revalidateTag).mock.calls) {
        expect(call).toHaveLength(2);
        expect(call[1]).toBe("tenMinutes");
      }
    });
  });

  it("covers images and assets, not only stock", () => {
    // The fix that catches stock and misses photographs is the one that looks
    // done. Spree::Publishable defaults lifecycle events to OFF, so this was
    // worth checking on the running shop rather than assuming, and both models
    // do publish.
    for (const name of ["image.created", "image.updated", "image.deleted"]) {
      expect(CATALOGUE_EVENTS).toContain(name);
    }
    for (const name of ["asset.created", "asset.updated", "asset.deleted"]) {
      expect(CATALOGUE_EVENTS).toContain(name);
    }
  });

  it("covers deletions as well as changes", () => {
    // A removed photo or a discontinued product has to leave the shop as
    // promptly as a new one arrives.
    // Asserted as a pair per subject rather than a bare count, so adding a
    // subject does not fail this for the wrong reason. It failed once on exactly
    // that: the number moved from 6 to 9 when taxons were added, and the count
    // told me nothing about whether the new ones were complete.
    const subjects = [...new Set(CATALOGUE_EVENTS.map((n) => n.split(".")[0]))];
    for (const subject of subjects) {
      for (const verb of ["created", "updated", "deleted"]) {
        expect(CATALOGUE_EVENTS).toContain(`${subject}.${verb}`);
      }
    }
  });

  it("purges again on a repeat delivery rather than skipping it", async () => {
    // Deliberately NOT idempotency guarded, unlike the email handlers beside it.
    // A repeated purge costs one refetch. A skipped purge, after a delivery whose
    // first attempt failed late, leaves the shop stale for the full ten minutes.
    await handleCatalogueChange(event("product.updated"));
    await handleCatalogueChange(event("product.updated"));
    expect(vi.mocked(revalidateTag).mock.calls).toHaveLength(8);
  });

  it("clears the category tree on a taxon change, and not on a stock change", async () => {
    // The category tree sits on Next's `hours` profile: an hour to revalidate, a
    // day to expire. It is the slowest thing on the shop and it was left out of
    // the first version of this file. The client restructured a tree, 37 of 42
    // taxons in an hour, and reported "category pages become 404 error pages".
    // The pages were fine; the cached menu was a day old and linked at permalinks
    // he had just replaced.
    await handleCatalogueChange(event("taxon.updated"));
    const onTaxon = vi.mocked(revalidateTag).mock.calls.map(([t]) => t);
    expect(onTaxon).toContain("categories");
    expect(onTaxon).toContain("category");
    expect(onTaxon).toContain("category-banner");

    vi.mocked(revalidateTag).mockClear();

    // And not the other way round. A stock change has no business throwing away
    // a cache with an hours-long life.
    await handleCatalogueChange(event("stock_item.updated"));
    const onStock = vi.mocked(revalidateTag).mock.calls.map(([t]) => t);
    expect(onStock).not.toContain("categories");
  });

  it("subscribes to taxon events, which publish nothing until Rails enables them", () => {
    // Spree ships Taxon with publish_events true and lifecycle_events_enabled
    // FALSE, so these names arrive only because config/initializers/spree.rb
    // switches them on. Listed here so the two halves cannot drift apart quietly.
    for (const name of [
      "taxon.updated",
      "taxonomy.updated",
      "classification.created",
    ]) {
      expect(CATALOGUE_EVENTS).toContain(name);
    }
  });
});
