import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/shop-key", () => ({ shopKey: () => "business" }));

import { businessFrontPage } from "@/lib/blocks/front-page";

describe("the business front page, in his 8 Oct order", () => {
  it("places every section where his table puts it", () => {
    const blocks = businessFrontPage("Shop", { preview: true }).blocks;
    const shape = blocks.map((b) =>
      b.type === "home_categories"
        ? `categories ${b.from}-${b.to}`
        : b.type === "collection"
          ? `collection ${b.heading}`
          : b.type,
    );
    const at = (label: string) => shape.indexOf(label);

    expect(at("collection Featured Products")).toBeGreaterThan(-1);
    expect(at("categories 1-1")).toBe(at("collection Featured Products") + 1);
    expect(at("banner_ad")).toBe(at("categories 1-1") + 1);
    expect(at("categories 2-2")).toBe(at("banner_ad") + 1);
    expect(at("browse_categories")).toBe(at("categories 2-2") + 1);
    expect(at("subscribe")).toBe(at("browse_categories") + 1);
    expect(at("collection Special Offers")).toBe(at("subscribe") + 1);
    expect(at("categories 3-6")).toBe(at("collection Special Offers") + 1);
  });

  it("shows the advertisement frame only on the preview", () => {
    const ad = (preview: boolean) =>
      businessFrontPage("Shop", { preview }).blocks.find(
        (b) => b.type === "banner_ad",
      );
    expect(ad(true)).toMatchObject({ preview: true });
    expect(ad(false)).toMatchObject({ preview: false });
  });
});
