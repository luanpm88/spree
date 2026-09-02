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
    const deletions = CATALOGUE_EVENTS.filter((n) => n.endsWith(".deleted"));
    expect(deletions).toHaveLength(6);
  });

  it("purges again on a repeat delivery rather than skipping it", async () => {
    // Deliberately NOT idempotency guarded, unlike the email handlers beside it.
    // A repeated purge costs one refetch. A skipped purge, after a delivery whose
    // first attempt failed late, leaves the shop stale for the full ten minutes.
    await handleCatalogueChange(event("product.updated"));
    await handleCatalogueChange(event("product.updated"));
    expect(vi.mocked(revalidateTag).mock.calls).toHaveLength(8);
  });
});
