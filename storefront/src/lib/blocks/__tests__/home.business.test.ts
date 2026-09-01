import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The commercial shop's home page is a DIFFERENT SHAPE, and it is his shape.
 *
 * Four lines on task 4430 are the whole front end brief:
 *
 *   "The frontend needs to have a logo and a menu link at the top."
 *   "A full-width top sliding banner about 400-500px high"
 *   "Products showing below under Main categories, then show 4 products per
 *    category as static or scrolling"
 *   "Bottom footer"
 *
 * Those four are the brief he wrote on 11 August. On 24 August he sent a front
 * page design, and it is the fuller specification: thirteen sections, catalogued
 * from the image the same day. The sections built here are the ones whose words
 * are his and whose pieces exist today: his sliding banner, his two hero lines,
 * his trust bar, a product row per category, his feature strip.
 *
 * What is NOT here is as much the point. No About panel, no shipping notice, no
 * newsletter box: his design has none of the three, and this codebase does not
 * write copy he did not send. Nor his logo wall, his browse-by-category photo
 * tiles or his payment marks, each of which is waiting on an answer or an asset
 * rather than on work.
 *
 * The retail shape is covered by home.test.ts and must stay untouched. Both files
 * matter: the change that let this shop declare its own shape also made the hero,
 * the About panel and the three category rows conditional, and a shop losing its
 * hero because a guard was written the wrong way round would render as a page that
 * starts with a product row.
 */

const RETAIL = {
  hero: { heading: "Retail hero", body: ["one"] },
  rows: {
    standouts: "Standouts",
    onSale: "On sale",
    combos: "Combos",
    newProducts: "New",
    viewAll: "Explore category",
  },
  about: { heading: "About", body: ["two"] },
  notice: { heading: "Notice", body: "three" },
  subscribe: { heading: "Subscribe", body: "four", buttonLabel: "Go" },
} as const;

// The real shape, matching content.ts, so this test moves when that does.
const BUSINESS = {
  hero: {
    heading: "Quality you can depend on.\nBuilt for your business.",
    body: [],
    ctaLabel: "Shop All Products",
    showCta: true,
  },
  trust: { columns: 4, items: ["Trusted by Businesses", "Custom Solutions"] },
  featureStrip: { columns: 4, items: ["Premium Materials", "Bulk Pricing"] },
  banner: { slides: [], height: 450, intervalMs: 6000 },
  categoryRows: { perRow: 4, viewAll: "Explore category" },
} as const;

vi.mock("@/lib/blocks/brand", () => ({ shopBrand: () => ({}) }));
vi.mock("@/lib/blocks/content", () => ({
  HOME_BY_SHOP: { nz: RETAIL, business: BUSINESS },
}));

async function blocksFor(shopKeyValue: string, country = "nz") {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_DEFAULT_COUNTRY", country);
  vi.stubEnv("NEXT_PUBLIC_SHOP_KEY", shopKeyValue);
  vi.stubEnv("NEXT_PUBLIC_REQUIRE_ACCOUNT", "");
  // Deliberately SET, to prove the business shop ignores them. Its rows come
  // from its own catalogue, not from these three build args.
  vi.stubEnv("NEXT_PUBLIC_CATEGORY_STANDOUTS", "ctg_standouts");
  vi.stubEnv("NEXT_PUBLIC_CATEGORY_COMBOS", "ctg_combos");
  vi.stubEnv("NEXT_PUBLIC_CATEGORY_NEW", "ctg_new");

  const { homePage } = await import("@/lib/blocks/home");
  return homePage("A Business Shop").blocks;
}

describe("the commercial shop's home page", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("is his design's sections, in his order, and nothing else", async () => {
    const blocks = await blocksFor("business");
    // Banner, his two hero lines, his trust bar, his category rows, his feature
    // strip. No About panel, no shipping notice, no newsletter: his design has
    // none of the three and this codebase does not write copy he did not send.
    expect(blocks.map((b) => b.type)).toEqual([
      "banner_slider",
      "text_image",
      "feature_list",
      "category_rows",
      "feature_list",
    ]);
    expect(blocks.map((b) => b.type)).not.toContain("notice");
    expect(blocks.map((b) => b.type)).not.toContain("subscribe");
  });

  it("shows his hero button on a shop that is not account gated", async () => {
    // The button is keyed on the account gate for the eight shops that came
    // first. This shop is prices_hidden rather than gated, and his design draws
    // the button, so it opts in explicitly instead of the gate check being
    // loosened for the five retail shops that had it removed.
    const blocks = await blocksFor("business");
    const hero = blocks.find((b) => b.type === "text_image");
    expect(hero).toMatchObject({
      cta: { label: "Shop All Products", href: "/products" },
    });
  });

  it("carries his height and asks for 4 products a category", async () => {
    const blocks = await blocksFor("business");
    const banner = blocks.find((b) => b.type === "banner_slider");
    const rows = blocks.find((b) => b.type === "category_rows");
    // His words: "about 400-500px high" and "4 products per category".
    expect(banner).toMatchObject({ height: 450, intervalMs: 6000 });
    expect(rows).toMatchObject({ perRow: 4 });
  });

  it("ignores the three retail category build args", async () => {
    // They are set in blocksFor. A retail shop would render three collection
    // rows off them; this shop must not, because its rows are its own
    // categories and a Standouts row would be a heading he never wrote.
    const blocks = await blocksFor("business");
    expect(blocks.some((b) => b.type === "collection")).toBe(false);
  });

  it("does not take the retail shop's shape when its country is nz", async () => {
    // The fault this whole change exists for. Before the shop key was separated
    // from the country, this shop resolved to `nz` and would have rendered the
    // New Zealand RETAIL home page: its hero, its About story, its newsletter.
    const business = await blocksFor("business", "nz");
    const retail = await blocksFor("", "nz");

    expect(business.map((b) => b.type)).not.toEqual(retail.map((b) => b.type));
    expect(retail.map((b) => b.type)).toContain("subscribe");
    expect(business.map((b) => b.type)).not.toContain("subscribe");
  });

  it("still gives a retail shop its hero, about, notice and subscribe", async () => {
    // The guard added for the business shop made four blocks conditional. If any
    // of those guards is inverted, a live retail shop loses a section, so it is
    // asserted here as well as in home.test.ts.
    const blocks = await blocksFor("", "nz");
    const types = blocks.map((b) => b.type);
    expect(types).toContain("text_image");
    expect(types).toContain("notice");
    expect(types).toContain("subscribe");
    expect(types.filter((t) => t === "text_image").length).toBe(2);
  });
});
