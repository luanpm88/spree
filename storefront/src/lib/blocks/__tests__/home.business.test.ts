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
//
// Part 2, 13 Sep: no `hero` key. His words, his four icons and his two buttons
// moved onto the banner slide, so the separate text block went with them.
const ICON = { icon: "/brand/i.png", iconWidth: 70, iconHeight: 63 } as const;
const BUSINESS = {
  trust: {
    icons: [
      { ...ICON, title: "Trusted by Business", body: "Worldwide" },
      { ...ICON, title: "Since 2005", body: "20+ years of experience" },
      { ...ICON, title: "Manufacturing Experience", body: "Product knowledge" },
      { ...ICON, title: "Dedicated Support", body: "We're here to help" },
    ],
  },
  supply: {
    icons: [
      { ...ICON, title: "Sustainable Choice", body: "Better product choices" },
      { ...ICON, title: "Flexible Quantities", body: "Carton to container" },
      { ...ICON, title: "Quality Checked", body: "Consistent standards" },
      { ...ICON, title: "Reliable Supply", body: "Supply you can depend on" },
      { ...ICON, title: "Global Shipping", body: "Pallet & container freight" },
    ],
  },
  banner: {
    slides: [
      {
        src: "/brand/banner-hero-business.png",
        width: 2078,
        height: 757,
        alt: "bottles",
        mobileSrc: "/brand/banner-hero-business-mobile.png",
        mobileWidth: 1122,
        mobileHeight: 1402,
        tone: "light",
        heading: "Quality you can depend on\nBuilt for your business.",
        body: "Premium commercial products for hospitality.",
        features: [
          { ...ICON, title: "Premium Materials", body: "Built to last" },
          { ...ICON, title: "Bulk Pricing", body: "Better value" },
          { ...ICON, title: "Custom Solutions", body: "Made for your needs" },
          { ...ICON, title: "Global Delivery", body: "Door-to-door worldwide" },
        ],
        ctas: [
          { label: "View Product Range", href: "/products" },
          {
            label: "Request a Quote",
            href: "/pages/request-a-quote",
            variant: "outline",
          },
        ],
      },
    ],
    height: 450,
    intervalMs: 6000,
  },
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
    // Part 2, 13 Sep. His hero slider, his trust band, his category rows, his
    // supply band. NO text_image any more: his words are on the photograph now,
    // so a separate hero block under it would print his heading twice.
    //
    // Still no About panel and no shipping notice. His design DOES draw a
    // newsletter, between the products and the supply band, and it is not built
    // because he asked for three things on 13 Sep and that was not one of them.
    // Asserted rather than left implicit so the day it is added, this line is
    // what says it was a decision.
    expect(blocks.map((b) => b.type)).toEqual([
      "banner_slider",
      "icon_banner",
      "category_rows",
      "icon_banner",
    ]);
    expect(blocks.map((b) => b.type)).not.toContain("text_image");
    expect(blocks.map((b) => b.type)).not.toContain("notice");
    expect(blocks.map((b) => b.type)).not.toContain("subscribe");
  });

  it("carries his two hero buttons, his four icons and his phone photograph", async () => {
    const blocks = await blocksFor("business");
    const banner = blocks.find((b) => b.type === "banner_slider");
    const slide = banner?.type === "banner_slider" ? banner.slides[0] : null;

    // Two buttons, his, the second outlined. Until Part 2 this shop opted into
    // ONE button through a showCta flag on the hero; his artwork draws two.
    expect(slide?.ctas).toEqual([
      { label: "View Product Range", href: "/products" },
      {
        label: "Request a Quote",
        href: "/pages/request-a-quote",
        variant: "outline",
      },
    ]);
    // Four icons in the hero, and every one of them carries its own intrinsic
    // width: they are a common-height set, 63px tall at widths from 44 to 86,
    // and a missing width makes next/image reserve a square box for nine of the
    // thirteen.
    expect(slide?.features).toHaveLength(4);
    for (const f of slide?.features ?? []) {
      expect(f.iconHeight).toBe(63);
      expect(f.iconWidth).toBeGreaterThan(0);
    }
    // His separate portrait photograph for phones, not a crop of the landscape
    // one. Dropping it would put a 2.7:1 letterbox on a phone screen.
    expect(slide?.mobileSrc).toBeTruthy();
    // Light tone: his ink on the photograph with no dark wash, which is measured
    // at 6.85:1 median rather than judged by eye.
    expect(slide?.tone).toBe("light");
  });

  it("gives the trust band 4 icons and the supply band 5, in that order", async () => {
    // His own three lines of 13 Sep: "Hero slider ... with 4 icons / Trust
    // banner with 4 icons / Supply banner with 5 icons". The counts are the
    // specification, and the supply band sits BELOW the products where his
    // artwork draws it, not beside the trust band.
    const blocks = await blocksFor("business");
    const bands = blocks.filter((b) => b.type === "icon_banner");
    expect(bands).toHaveLength(2);
    expect(bands[0].type === "icon_banner" && bands[0].items).toHaveLength(4);
    expect(bands[1].type === "icon_banner" && bands[1].items).toHaveLength(5);

    const types = blocks.map((b) => b.type);
    expect(types.indexOf("category_rows")).toBeGreaterThan(
      types.indexOf("icon_banner"),
    );
    expect(types.lastIndexOf("icon_banner")).toBeGreaterThan(
      types.indexOf("category_rows"),
    );
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

  it("leaves the seven retail shops without a band", async () => {
    // icon_banner is new on 13 Sep and only this shop declares trust or supply.
    // A band appearing on a retail home page would be five live shops changing
    // shape to answer a question about the eighth.
    const blocks = await blocksFor("", "nz");
    expect(blocks.map((b) => b.type)).not.toContain("icon_banner");
  });
});
