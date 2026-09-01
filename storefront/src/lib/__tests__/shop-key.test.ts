import { afterEach, describe, expect, it, vi } from "vitest";

import { shopKey } from "@/lib/shop-key";

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * The seven retail shops must be untouched by this, and the commercial shop must
 * stop reading the New Zealand retail shop's words.
 *
 * Before shopKey existed, every per-shop lookup keyed off the COUNTRY. That is
 * the same word as the shop on all seven retail shops and a different word on the
 * commercial one, which is a New Zealand business but not the New Zealand shop.
 * The result was measured on 1 Sep: its own About, FAQ and product-sourcing pages
 * answered 404 while sitting in the repo under a key nothing looked at, and the
 * home page would have fallen through to the retail shop's copy on the next
 * rebuild.
 */
describe("shopKey", () => {
  it("is the country when a shop does not set its own key", () => {
    vi.stubEnv("NEXT_PUBLIC_DEFAULT_COUNTRY", "nz");
    vi.stubEnv("NEXT_PUBLIC_SHOP_KEY", "");
    expect(shopKey()).toBe("nz");
  });

  it("is the shop key when the two differ", () => {
    // The commercial shop: a New Zealand business, not the New Zealand shop.
    vi.stubEnv("NEXT_PUBLIC_DEFAULT_COUNTRY", "nz");
    vi.stubEnv("NEXT_PUBLIC_SHOP_KEY", "business");
    expect(shopKey()).toBe("business");
  });

  it("lower cases whatever it is given", () => {
    vi.stubEnv("NEXT_PUBLIC_DEFAULT_COUNTRY", "NZ");
    vi.stubEnv("NEXT_PUBLIC_SHOP_KEY", "Business");
    expect(shopKey()).toBe("business");
  });

  it("is empty rather than guessing when neither is set", () => {
    vi.stubEnv("NEXT_PUBLIC_DEFAULT_COUNTRY", "");
    vi.stubEnv("NEXT_PUBLIC_SHOP_KEY", "");
    // Empty means every lookup misses and the shop renders its fallback, which is
    // visible. Guessing a shop here would serve one shop's words on another, and
    // that is the failure this whole file exists to stop.
    expect(shopKey()).toBe("");
  });
});
