import { shopBrand } from "@/lib/blocks/brand";
import { HOME_BY_SHOP } from "@/lib/blocks/content";
import type { Block, PageDefinition } from "@/lib/blocks/types";
import { isAccountRequired } from "@/lib/store";
import { shopKey } from "@/lib/shop-key";

/**
 * The home page, as a list of blocks.
 *
 * ── what this is and what it is not ──────────────────────────────────────────
 *
 * This is the CMS's job, written as a TypeScript file until the CMS exists. The
 * shape is the shape the CMS will hand over, so when it arrives this file is
 * deleted and nothing else changes. Keeping it here first proves the blocks
 * carry a real page before anyone pays for an editor to drive them.
 *
 * ── structure here, words in content.ts ──────────────────────────────────────
 *
 * This file decides which blocks the page has and in what order. What they SAY
 * lives in content.ts, which is gitignored because this repository is public and
 * the copy names the client, his brand and his founder.
 *
 * The same split the CMS makes, so when the CMS arrives it replaces content.ts
 * and this file is untouched. The words were read off his own live home page
 * rather than invented: he asked for it copied as it is, with the subscribe
 * section as the one exception.
 *
 * ── the collection ids ───────────────────────────────────────────────────────
 *
 * Category ids are per shop, so they come from the environment rather than
 * being written in here. Three of his four rows are ordinary categories. The
 * fourth, On Sale, is a RULE BASED category, and the 5.6 Store API does not
 * serve those at all, so it uses the `on_sale` source instead, which filters on
 * price. He chose that over converting the collection by hand.
 */

/**
 * Written out one by one, never `process.env[`NEXT_PUBLIC_${name}`]`.
 *
 * Next.js replaces these at build time by looking for the literal text
 * `process.env.NEXT_PUBLIC_SOMETHING` in the source. A computed key is not
 * matched, so it survives into the bundle as a real lookup against an object
 * that is empty in the browser, and every id comes back undefined with nothing
 * to show for it. The first version of this file had exactly that.
 */
const CATEGORY_IDS = {
  standouts: process.env.NEXT_PUBLIC_CATEGORY_STANDOUTS,
  combos: process.env.NEXT_PUBLIC_CATEGORY_COMBOS,
  new: process.env.NEXT_PUBLIC_CATEGORY_NEW,
} as const;

function categoryId(key: keyof typeof CATEGORY_IDS): string | undefined {
  const value = CATEGORY_IDS[key];
  return value && value.length > 0 ? value : undefined;
}

/**
 * Copy is per shop, keyed by the same country code the categories use.
 *
 * The client caught this one: the first build served New Zealand's home page
 * words on the Canada shop, because the copy was read off one site and reused
 * everywhere. Each shop writes its own, down to the year in the About story.
 */
/**
 * The shape a shop gets when it has said nothing about itself.
 *
 * His requirement, on 1 Sep: "This theme will become the default theme for all
 * other business catalog shops we build for others. Take this in mind for making
 * it easy to setup and implement on your side."
 *
 * So a new business catalogue shop needs NO content entry to have a working home
 * page. It gets a banner it can fill in later and a product row per category, and
 * every word on it comes from that shop's own catalogue rather than from here.
 * There is nothing to write, nothing to copy from another shop, and nothing that
 * can therefore be another shop's.
 *
 * ── this replaces a fallback that was a landmine ───────────────────────────
 *
 * It used to fall through to the New Zealand RETAIL shop. Any shop without an
 * entry rendered that shop's welcome copy, its About story about a founder, and
 * its consumer newsletter box. The commercial shop was one rebuild away from
 * doing exactly that, and the fault it describes is the one the client caught
 * himself on Canada.
 *
 * A default that is empty is honest. A default that is another shop is a bug
 * waiting for its first user.
 */
const DEFAULT_BUSINESS = {
  banner: { slides: [] as never[], height: 450, intervalMs: 6000 },
  categoryRows: { perRow: 4, viewAll: "Explore category" },
} as const;

function copy() {
  const shop = shopKey() as keyof typeof HOME_BY_SHOP;
  return HOME_BY_SHOP[shop] ?? DEFAULT_BUSINESS;
}

export function homePage(storeName: string): PageDefinition {
  const C = copy();
  // His photographs, per shop. Absent, the two text blocks render full width
  // rather than leaving a hole where a picture should be.
  const B = shopBrand();
  const standouts = categoryId("standouts");
  const combos = categoryId("combos");
  const newProducts = categoryId("new");

  return {
    name: storeName,
    blocks: [
      // The commercial shop opens with a sliding banner instead of a hero. His
      // words, first of the four lines that are the whole front end brief for
      // that shop: "A full-width top sliding banner about 400-500px high".
      //
      // Declared by the shop rather than switched on by name, like every other
      // block here. The seven retail shops do not declare it and are unchanged.
      ...("banner" in C
        ? ([
            {
              type: "banner_slider",
              slides: [...C.banner.slides],
              ...(C.banner.height ? { height: C.banner.height } : {}),
              ...(C.banner.intervalMs
                ? { intervalMs: C.banner.intervalMs }
                : {}),
            },
          ] as Block[])
        : []),

      // Conditional now, where it used to be unconditional.
      //
      // Every shop that existed when this was written had a hero, so reading
      // C.hero straight off was safe. The commercial shop does not: his brief
      // puts a banner at the top and the products directly under it, with no
      // welcome copy between them. Making it conditional is what lets a shop say
      // that, and it changes nothing for the seven that do declare one.
      ...("hero" in C
        ? ([
            {
              type: "text_image",
              heading: C.hero.heading,
              body: [...C.hero.body],
              ...(B.hero
                ? { image: B.hero, imageSide: "right" as const }
                : {}),
        // No button on the five retail shops. He drew an arrow at it and wrote
        // "remove": his own retail home page ends the welcome copy on the last
        // sentence and sends people on with the product rows underneath, so a
        // call to action there is a second, competing one.
        //
        // His WHOLESALE home page does carry one, reading BROWSE PRODUCTS, which
        // is why the label was kept in content.ts rather than deleted with the
        // button. Read off his live page rather than off the screenshot.
        // `"ctaLabel" in C.hero` rather than reading it straight off: not every
        // shop's hero carries one, and the sixth shop's does not, so reading the
        // property directly stopped the whole file type checking the moment that
        // shop was added. Same shape as the `in` checks on the rows below.
              // The gate, OR an explicit opt in.
              //
              // Keyed on the gate alone until 1 Sep, which was right for the eight
              // shops that existed: five retail shops had the button removed at his
              // request and the closed shop keeps it. The commercial shop is neither
              // gated nor retail and his own design draws two buttons in the hero,
              // so it says so rather than the condition being loosened for everyone.
              ...((isAccountRequired() ||
                ("showCta" in C.hero && C.hero.showCta)) &&
              "ctaLabel" in C.hero &&
              C.hero.ctaLabel
                ? { cta: { label: C.hero.ctaLabel, href: "/products" } }
                : {}),
              background: "default",
            },
          ] as Block[])
        : []),

      // Section 4 of his front page design, the TRUST BAR. Four of his phrases
      // across, no icons: his mockup draws one over each and none has been sent,
      // and FeatureList already refuses to invent a picture for that reason.
      ...("trust" in C
        ? ([
            {
              type: "feature_list",
              columns: C.trust.columns,
              items: C.trust.items.map((title) => ({ title })),
            },
          ] as Block[])
        : []),

      // Three ordinary categories. Each renders nothing at all if its id is not
      // set for this shop, rather than showing an empty row under a heading.
      // The shop's lead collection. The retail shops call it Sustainable
      // Standouts; the wholesale shop calls the same slot Wholesale
      // Opportunities, because its catalogue is a different one. The build arg
      // that carries the id is the same either way, so the only per-shop part is
      // which word sits above the row.
      ...("rows" in C &&
      standouts &&
      ("standouts" in C.rows || "wholesale" in C.rows)
        ? ([
            {
              type: "collection" as const,
              heading:
                "standouts" in C.rows ? C.rows.standouts : C.rows.wholesale,
              source: { kind: "category" as const, id: standouts },
              viewAll: { label: C.rows.viewAll, href: "/products" },
            },
          ] as const)
        : []),

      // A wholesale shop has no sale row: its prices are the trade prices and
      // there is no consumer promotion behind them. Absent from its copy, so
      // absent from its page, by the same rule as the three rows around it.
      ...("rows" in C && "onSale" in C.rows
        ? ([
            {
              type: "collection" as const,
              heading: C.rows.onSale,
              source: { kind: "on_sale" as const },
              // His sale row is labelled differently from the other three, and it is
              // the one row whose link cannot be resolved from a category: it has no
              // category to resolve from. On Sale is a rule based collection and the
              // 5.6 API does not serve those, so the row filters on price instead.
              //
              // The link points at the collection anyway. He is converting it to an
              // ordinary one, and on the day he does, this starts working with no
              // deploy. Until then it is the same address his current shop uses.
              viewAll: {
                label:
                  ("viewAllSale" in C.rows ? C.rows.viewAllSale : undefined) ??
                  C.rows.viewAll,
                href: "/c/collections/on-sale",
              },
            },
          ] as const)
        : []),

      ...("rows" in C && combos && "combos" in C.rows
        ? ([
            {
              type: "collection" as const,
              heading: C.rows.combos,
              source: { kind: "category" as const, id: combos },
              viewAll: { label: C.rows.viewAll, href: "/products" },
            },
          ] as const)
        : []),

      ...("rows" in C && newProducts
        ? ([
            {
              type: "collection" as const,
              heading: C.rows.newProducts,
              source: { kind: "category" as const, id: newProducts },
              viewAll: {
                label:
                  "viewAllNew" in C.rows ? C.rows.viewAllNew : C.rows.viewAll,
                href: "/products",
              },
            },
          ] as const)
        : []),

      // His third line for the commercial shop: "Products showing below under
      // Main categories, then show 4 products per category". One row per category
      // he has, read from his own catalogue rather than from build args, so a
      // category he creates in the admin appears here without a rebuild.
      ...("categoryRows" in C
        ? ([
            {
              type: "category_rows",
              perRow: C.categoryRows.perRow,
              viewAllLabel: C.categoryRows.viewAll,
            },
          ] as Block[])
        : []),

      // Section 11 of his front page design, the FEATURE STRIP. Five of his
      // phrases, below the products, same treatment as the trust bar above them.
      ...("featureStrip" in C
        ? ([
            {
              type: "feature_list",
              columns: C.featureStrip.columns,
              items: C.featureStrip.items.map((title) => ({ title })),
            },
          ] as Block[])
        : []),

      // Conditional, for the same reason the hero is. The commercial shop's brief
      // has no About panel and this file does not write one for him.
      ...("about" in C
        ? ([
            {
              type: "text_image",
              heading: C.about.heading,
              body: [...C.about.body],
              ...(B.about ? { image: B.about } : {}),
        // Image right. It was left, and he marked it "wrong side, need to flip".
        imageSide: "right",
        // Green on the retail shops, BLACK on the wholesale one. Both are his.
        //
        // The comment this replaces said the wholesale About section "sits on
        // the page with no colour behind it", and that was simply untrue: his
        // own screenshot of it measures rgb(0,0,0) solid. The mistake came from
        // reading one half of a pair. He drew a red circle-slash on our green
        // band and a green tick on his black one; the strike was honoured and
        // the tick was dropped, so the section went green to white and matched
        // neither picture.
        //
        // Keyed on the gate rather than on the shop name, the same way the
        // footer chooses its livery, so a second closed shop inherits it
        // without anyone remembering to add its name.
              background: isAccountRequired() ? "dark" : "brand",
            },
          ] as Block[])
        : []),

      // Both of the blocks below are retail furniture. The notice is the consumer
      // shipping and tax line, and the subscribe box is a newsletter for
      // shoppers. Neither belongs on a portal that only signed-in trade accounts
      // can reach, and neither is in that shop's copy, so neither renders.
      ...("notice" in C
        ? ([
            {
              type: "notice" as const,
              heading: C.notice.heading,
              body: C.notice.body,
            },
          ] as const)
        : []),

      // What stands in the subscribe box's place on the closed shop. He sent the
      // wording on 20 Aug and confirmed the placement that afternoon against a
      // render of his own design: it is the last thing above the footer.
      ...("enquiry" in C
        ? ([
            {
              type: "enquiry" as const,
              heading: C.enquiry.heading,
              body: C.enquiry.body,
              button: C.enquiry.button,
            },
          ] as const)
        : []),

      // The one section he asked to be changed rather than copied.
      ...("subscribe" in C
        ? ([
            {
              type: "subscribe" as const,
              heading: C.subscribe.heading,
              body: C.subscribe.body,
              buttonLabel: C.subscribe.buttonLabel,
              // He drew a name box beside the email and asked whether it could work.
              // It can, but not through Spree's own endpoint, which takes an email and
              // silently discards anything else. See the newsletter_signups controller
              // for the measurement and for where the name ends up.
              askForName: true,
            },
          ] as const)
        : []),
    ],
  };
}
