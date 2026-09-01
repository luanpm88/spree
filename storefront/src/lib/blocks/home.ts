import { shopBrand } from "@/lib/blocks/brand";
import { HOME_BY_SHOP } from "@/lib/blocks/content";
import type { PageDefinition } from "@/lib/blocks/types";
import { isAccountRequired } from "@/lib/store";

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
function copy() {
  const shop = (
    process.env.NEXT_PUBLIC_DEFAULT_COUNTRY || ""
  ).toLowerCase() as keyof typeof HOME_BY_SHOP;
  return HOME_BY_SHOP[shop] ?? HOME_BY_SHOP.nz;
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
      {
        type: "text_image",
        heading: C.hero.heading,
        body: [...C.hero.body],
        ...(B.hero ? { image: B.hero, imageSide: "right" as const } : {}),
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
        ...(isAccountRequired() && "ctaLabel" in C.hero && C.hero.ctaLabel
          ? { cta: { label: C.hero.ctaLabel, href: "/products" } }
          : {}),
        background: "default",
      },

      // Three ordinary categories. Each renders nothing at all if its id is not
      // set for this shop, rather than showing an empty row under a heading.
      // The shop's lead collection. The retail shops call it Sustainable
      // Standouts; the wholesale shop calls the same slot Wholesale
      // Opportunities, because its catalogue is a different one. The build arg
      // that carries the id is the same either way, so the only per-shop part is
      // which word sits above the row.
      ...(standouts && ("standouts" in C.rows || "wholesale" in C.rows)
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
      ...("onSale" in C.rows
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

      ...(combos && "combos" in C.rows
        ? ([
            {
              type: "collection" as const,
              heading: C.rows.combos,
              source: { kind: "category" as const, id: combos },
              viewAll: { label: C.rows.viewAll, href: "/products" },
            },
          ] as const)
        : []),

      ...(newProducts
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
        background: isAccountRequired()
          ? ("dark" as const)
          : ("brand" as const),
      },

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
