import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which blocks the home page has, for a retail shop and for the wholesale one.
 *
 * ── why this exists ──────────────────────────────────────────────────────────
 *
 * homePage() read C.rows.onSale, C.notice and C.subscribe unconditionally. That
 * was true of every shop until a wholesale shop was added, whose home page
 * genuinely does not have those three: its prices are trade prices with no
 * consumer promotion behind them, and a newsletter box for shoppers does not
 * belong on a portal only signed-in trade accounts can reach.
 *
 * Adding that shop's copy turned eleven of those reads into TypeScript errors,
 * so `next build` failed rather than shipping something wrong, which is the good
 * outcome. Making them conditional fixes the build, and the risk moves to the
 * other five shops: a condition written slightly wrong drops a block from a
 * live retail page and nothing says so, because a missing block renders as
 * nothing rather than as an error.
 *
 * So the retail case below asserts the whole block list, in order. It fails if
 * a block is dropped, added or reordered.
 *
 * ── why the copy is mocked ───────────────────────────────────────────────────
 *
 * content.ts is gitignored: it holds the client's own words and this repository
 * is public. A test that read it would pass or fail by checkout. These fixtures
 * carry the SHAPE of each kind of shop, which is the thing under test, and none
 * of the words.
 */

const RETAIL = {
  hero: { heading: "Hero", body: ["one"], ctaLabel: "Shop" },
  rows: {
    standouts: "Standouts",
    onSale: "On Sale",
    combos: "Combos",
    newProducts: "New",
    viewAll: "View all",
    viewAllSale: "View all sale",
    viewAllNew: "View all new",
  },
  about: { heading: "About", body: ["two"] },
  notice: { heading: "Notice", body: "three" },
  subscribe: { heading: "Subscribe", body: "four", buttonLabel: "Join" },
} as const;

const WHOLESALE = {
  hero: { heading: "Portal", body: ["one"], ctaLabel: "Browse" },
  rows: {
    wholesale: "Wholesale Opportunities",
    newProducts: "New arrivals",
    viewAll: "Explore category",
  },
  about: { heading: "About", body: ["two"] },
  enquiry: {
    heading: "Enquiry",
    body: "five",
    button: { label: "Contact", href: "/contact" },
  },
} as const;

vi.mock("@/lib/blocks/brand", () => ({ shopBrand: () => ({}) }));
vi.mock("@/lib/blocks/content", () => ({
  HOME_BY_SHOP: { ca: RETAIL, b2b: WHOLESALE, nz: RETAIL },
}));

/**
 * @param gated whether this shop requires an account. It is a SEPARATE switch
 * from the shop name, and has to be set for anything keyed on the gate: the
 * About panel's colour, the hero button, the row heading case. A test that
 * names the wholesale shop and forgets this one is testing an open shop with a
 * wholesale shop's copy, which is a combination that does not exist.
 */
async function blocksFor(
  shop: string,
  ids: Record<string, string> = {},
  { gated = false }: { gated?: boolean } = {},
) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_DEFAULT_COUNTRY", shop);
  vi.stubEnv("NEXT_PUBLIC_REQUIRE_ACCOUNT", gated ? "1" : "");
  vi.stubEnv("NEXT_PUBLIC_CATEGORY_STANDOUTS", ids.standouts ?? "");
  vi.stubEnv("NEXT_PUBLIC_CATEGORY_COMBOS", ids.combos ?? "");
  vi.stubEnv("NEXT_PUBLIC_CATEGORY_NEW", ids.new ?? "");

  const { homePage } = await import("@/lib/blocks/home");
  return homePage("A Shop").blocks;
}

describe("the home page block list", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("gives a retail shop every block, in order", async () => {
    const blocks = await blocksFor("ca", {
      standouts: "cat_1",
      combos: "cat_2",
      new: "cat_3",
    });

    expect(blocks.map((block) => block.type)).toEqual([
      "text_image",
      "collection",
      "collection",
      "collection",
      "collection",
      "text_image",
      "notice",
      "subscribe",
    ]);
  });

  it("keeps a retail shop's four row headings", async () => {
    const blocks = await blocksFor("ca", {
      standouts: "cat_1",
      combos: "cat_2",
      new: "cat_3",
    });
    const headings = blocks
      .filter((block) => block.type === "collection")
      .map((block) => block.heading);

    expect(headings).toEqual(["Standouts", "On Sale", "Combos", "New"]);
  });

  it("drops a row whose category id this shop does not set, and keeps the rest", async () => {
    const blocks = await blocksFor("ca", { standouts: "cat_1" });

    expect(blocks.map((block) => block.type)).toEqual([
      "text_image",
      "collection",
      "collection",
      "text_image",
      "notice",
      "subscribe",
    ]);
  });

  it("leaves the wholesale shop without the sale row, the notice or the subscribe box", async () => {
    const blocks = await blocksFor(
      "b2b",
      { standouts: "cat_1", new: "cat_3" },
      { gated: true },
    );

    expect(blocks.map((block) => block.type)).toEqual([
      "text_image",
      "collection",
      "collection",
      "text_image",
      "enquiry",
    ]);
    expect(blocks.some((block) => block.type === "notice")).toBe(false);
    expect(blocks.some((block) => block.type === "subscribe")).toBe(false);
  });

  // The enquiry block is the subscribe box's replacement on the closed shop, so
  // the two must never both appear, and neither must appear on the other's shop.
  // He confirmed the placement on 20 Aug against a render of his own design: it
  // is the last thing on the page, immediately above the footer.
  it("gives the wholesale shop his enquiry block last, in place of the subscribe box", async () => {
    const blocks = await blocksFor(
      "b2b",
      { standouts: "cat_1", new: "cat_3" },
      { gated: true },
    );
    const enquiry = blocks.at(-1);

    // Shape, not his words. The heading and the body live in content.ts, which
    // is gitignored because this repository is public, so asserting them here
    // would either leak his copy or pass and fail by checkout.
    expect(enquiry?.type).toBe("enquiry");
    if (enquiry?.type !== "enquiry") return;
    expect(enquiry.heading).toBeTruthy();
    expect(enquiry.body).toBeTruthy();
    expect(enquiry.button.label).toBeTruthy();
    // The one part that is ours rather than his: the button has to point at the
    // contact page, and a button with nowhere to go is the whole block wasted.
    expect(enquiry.button.href).toBe("/contact");
  });

  it("keeps the enquiry block off the retail shops, which still have the subscribe box", async () => {
    const blocks = await blocksFor("ca", {
      standouts: "cat_1",
      new: "cat_3",
      combos: "cat_2",
    });

    expect(blocks.some((block) => block.type === "enquiry")).toBe(false);
    expect(blocks.some((block) => block.type === "subscribe")).toBe(true);
  });

  it("titles the wholesale shop's lead row with its own word", async () => {
    const blocks = await blocksFor(
      "b2b",
      { standouts: "cat_1", new: "cat_3" },
      { gated: true },
    );
    const headings = blocks
      .filter((block) => block.type === "collection")
      .map((block) => block.heading);

    expect(headings).toEqual(["Wholesale Opportunities", "New arrivals"]);
  });

  it("falls back to the shared view-all label where the wholesale copy has no separate one", async () => {
    const blocks = await blocksFor(
      "b2b",
      { standouts: "cat_1", new: "cat_3" },
      { gated: true },
    );
    const labels = blocks
      .filter((block) => block.type === "collection")
      .map((block) => block.viewAll?.label);

    expect(labels).toEqual(["Explore category", "Explore category"]);
  });
  // His wholesale hero carries a BROWSE PRODUCTS button and his retail heroes do
  // not, because he drew an arrow at the retail one and wrote "remove". The
  // href matters more than the button: TextImage did not prepend basePath, so a
  // button here pointed at /products rather than /b2b/en/products, which on a
  // gated shop is straight back out to the sign-in page. That is invisible in a
  // screenshot and only shows on the click.
  it("gives the wholesale hero a button and the retail hero none", async () => {
    const wholesale = await blocksFor(
      "b2b",
      { standouts: "cat_1", new: "cat_3" },
      { gated: true },
    );
    const hero = wholesale[0];
    expect(hero?.type).toBe("text_image");
    if (hero?.type !== "text_image") return;
    expect(hero.cta?.href).toBe("/products");
    expect(hero.cta?.label).toBeTruthy();

    const retail = await blocksFor("ca", {
      standouts: "cat_1",
      new: "cat_3",
      combos: "cat_2",
    });
    const retailHero = retail[0];
    if (retailHero?.type !== "text_image") return;
    expect(retailHero.cta).toBeUndefined();
  });

  // Both panels are his: olive on the retail shops, black on the wholesale one.
  // A condition written slightly wrong turns 5 live retail pages white and
  // nothing says so.
  //
  // This test used to assert the wholesale panel had NO background, which is
  // what the code did and was not what he asked for. He sent that section as a
  // pair, a strike-through on our green and a tick on his black, and only the
  // strike was read. So the assertion was holding the mistake in place: the
  // panel has to be a colour, and it has to be a different colour from retail.
  it("keeps the green About panel on retail and makes it black on the closed shop", async () => {
    const wholesale = await blocksFor(
      "b2b",
      { standouts: "cat_1", new: "cat_3" },
      { gated: true },
    );
    const retail = await blocksFor("ca", {
      standouts: "cat_1",
      new: "cat_3",
      combos: "cat_2",
    });

    const about = (blocks: typeof wholesale) =>
      blocks.filter((b) => b.type === "text_image").at(-1);

    const w = about(wholesale);
    const r = about(retail);
    if (w?.type !== "text_image" || r?.type !== "text_image") return;
    expect(w.background).toBe("dark");
    expect(r.background).toBe("brand");
    // Different from each other, which is the part that matters: one shop's
    // livery reaching the other 5 is the failure this file exists to catch.
    expect(w.background).not.toBe(r.background);
  });
});
