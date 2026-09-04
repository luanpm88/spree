import { shopTheme } from "@/lib/blocks/theme";
import { isAccountRequired } from "@/lib/store";

/**
 * The footer's three liveries.
 *
 * The retail one is grey with black text, and every value in it was read off his
 * live shop after he marked an earlier dark green version "gray with black
 * text". None of that changes.
 *
 * The wholesale one is dark, because his own wholesale footer is, and he sent a
 * render of it on 20 Aug. Keying it on the gate rather than on the shop name is
 * deliberate: the closed shop is the one with the different livery, and if a
 * second closed shop is ever built it should look like the first without anyone
 * remembering to add its name here.
 *
 * ── why this is its own module ───────────────────────────────────────────────
 *
 * It started inside Footer.tsx. The footer is not one component: it is Footer
 * plus FooterCategoryLinks plus FooterInfoLinks, and only the first two were
 * converted. FooterInfoLinks kept its three hardcoded `text-black` classes and
 * rendered a column of black links on a black ground, which is how the client
 * came to report "The wholesale column is all black text needs to be white"
 * after every unit test passed and the deploy check found nothing.
 *
 * A colour that lives in one file and is spelled out in another is a colour that
 * will be missed again. Anything drawing inside the footer imports from here.
 */
export const LIVERY = {
  retail: {
    surface: { backgroundColor: "#EDEDED", color: "#000000" },
    heading: "text-sm font-medium text-black",
    link: "text-sm text-black hover:text-neutral-600 transition-colors",
    wordmark: "text-xl font-bold text-black",
    // Deliberately darker than the surface above it. His words for the strip
    // under the line were "black or dark gray with white text below the line",
    // and against a grey footer that contrast is the whole point of it.
    bar: { backgroundColor: "#1A1A1A", color: "#FFFFFF" },
    // On a retail shop the first thing in the Shop column is his sale
    // collection.
    showOnSale: true,
    // Off on the retail shops too, as of his Final List: "Remove the Subscribe
    // link in the footer of the NZ, AU, US, CA, and nolocal shop. I will
    // rebuild this page again later."
    //
    // The flag stays rather than the conditional being deleted, because of that
    // last sentence. The page is not going; the link to it is, until he has
    // rebuilt it. One word here brings it back on all five at once.
    //
    // Both liveries now read false, which is the wholesale decision of 20 Aug
    // ("remove this page, we don't have it") arriving at the other five for a
    // different reason. Same value, two unrelated causes, so they are recorded
    // separately.
    showSubscribe: false,
  },
  wholesale: {
    // Pure black, measured off his own screenshots rather than picked: his
    // announcement bar samples (0,0,0) and so does his About panel, 1464 and
    // 5079 pixels of it respectively. This footer was #111111, the panel above
    // it was #1C1D19 and the bar at the top of the page was #111111, so one
    // page carried 3 near-blacks and none of them was his. The seam this file
    // already warns about was between our own colours.
    surface: { backgroundColor: "#000000", color: "#FFFFFF" },
    // Uppercase, small, and spaced, which is how his render sets both the
    // column headings and the links under them.
    heading: "text-xs font-semibold uppercase tracking-wider text-white/60",
    link: "text-sm uppercase tracking-wide text-white hover:text-white/70 transition-colors",
    wordmark: "text-xl font-bold text-white",
    // The same ground as the footer above it, so the copyright sits on one dark
    // panel rather than on a second, slightly different one. Two near-blacks
    // meeting read as a seam, and his render has no seam.
    bar: { backgroundColor: "#000000", color: "#FFFFFF" },
    // The wholesale shop has no sale collection: its prices are trade prices
    // with no consumer promotion behind them, which is why the home page has no
    // sale row either. Linking to it anyway sends a customer to an empty page.
    showOnSale: false,
    // No subscribe page on the closed shop, so the footer must not link to one.
    // His words on 20 Aug: "remove this page, we don't have it". The front page
    // makes the same point: his enquiry block stands where the subscribe box
    // stands on the retail shops.
    showSubscribe: false,
  },
  // His sixth shop, whose footer is neither of the two above: the wholesale
  // one's white-on-dark, in the retail one's sentence case, over his own green.
  //
  // Every value here was sampled out of the mock he sent on 23 August rather
  // than matched by eye, and the sampling changed the answer. The surface reads
  // #055145 across the whole panel, which is his #065146 after JPEG, so that is
  // confirmed. The copyright strip reads #569180, and that is not compression:
  // 0x57 against 0x05 is a different colour, drawn a deliberate shade lighter.
  //
  // His written note on that strip says #065146. So the note and the artwork
  // disagree, and rather than pick one silently the artwork is built and the
  // disagreement goes to him in one line. The wholesale footer settled the same
  // question the other way, flat black with no seam, so there is no house rule
  // to fall back on.
  greenBlue: {
    surface: { backgroundColor: "#065146", color: "#FFFFFF" },
    // White on green, the wholesale treatment, because that is what his mock
    // shows. Not uppercase though: his column links read "On sale", "Product
    // Type", "Collection/Design" in sentence case, where his wholesale render
    // sets them in capitals.
    heading: "text-sm font-semibold text-white",
    link: "text-sm text-white hover:text-white/70 transition-colors",
    wordmark: "text-xl font-bold text-white",
    // #569180 from his colour sheet, not #579280 from the mock.
    //
    // The mock samples #579280 and the two are one unit apart in two channels,
    // which is JPEG and not a decision. His own colour sheet lists the
    // palette as text: #065146, #0B6B5F, #0D8E7B, #569180, #EAEEED. A number he
    // wrote beats a number sampled off a compressed picture of it.
    bar: { backgroundColor: "#569180", color: "#FFFFFF" },
    // This shop has no sale collection wired up, and its rows are Tumblers and
    // Signature. Linking to /c/collections/on-sale would land on an empty page.
    showOnSale: false,
    showSubscribe: false,
  },
  // His seventh, and the first whose colours arrived as numbers rather than as
  // a picture to sample.
  //
  // The design he sent on 4 Sep labels the panel #4D5538 and the strip under it
  // #313F22, written on the artwork itself. Nothing here was eyedropped, which
  // is worth saying because every other livery in this file was, and two of them
  // record a disagreement between what he wrote and what the JPEG contained.
  // There is no disagreement to record this time.
  //
  // Sentence case, like the retail and green-blue liveries and unlike the
  // wholesale one: his column headings are SHOP, ACCOUNT, COMPANY, SUPPORT,
  // POLICIES in capitals, but the links beneath them are in sentence case.
  business: {
    surface: { backgroundColor: "#4D5538", color: "#FFFFFF" },
    // Bold 14pt with a rule under it at 35% opacity, both from his annotations.
    // The rule is drawn by the heading's own border so it cannot drift away
    // from the text it belongs to.
    heading:
      "text-sm font-bold uppercase tracking-wide text-white border-b border-white/35 pb-2",
    link: "text-sm text-white hover:text-white/70 transition-colors",
    wordmark: "text-xl font-bold text-white",
    bar: { backgroundColor: "#313F22", color: "#FFFFFF" },
    // No sale collection on this shop, the same as the wholesale and green-blue
    // ones. His SHOP column opens with "All Products", not with a sale.
    showOnSale: false,
    showSubscribe: false,
  },
} as const;

export type Livery = (typeof LIVERY)[keyof typeof LIVERY];

/**
 * Which of the three the shop this build serves wears.
 *
 * The green blue one is chosen by theme and the dark one by the gate, which
 * looks inconsistent and is not. The gate is the right question for the dark
 * footer: a shop that is closed to visitors without an account is the one with
 * that livery, and a second closed shop should inherit it without anyone
 * remembering to add its name. His green blue footer has nothing to do with
 * whether the shop is closed, so asking that question about it would answer the
 * wrong one, which is how five shops once got a sixth shop's wording.
 *
 * Order matters: the closed shop carries a theme too, so the theme is checked
 * first and only the palette it names is matched, never "has any theme at all".
 */
export function livery(): Livery {
  if (shopTheme() === "green-blue") return LIVERY.greenBlue;
  // Matched on its own theme name, not on the shop key, for the same reason the
  // green blue one is: the map from shop to theme lives in the gitignored
  // content file because its keys are his shop names, and this file is public.
  if (shopTheme() === "business-green") return LIVERY.business;
  return isAccountRequired() ? LIVERY.wholesale : LIVERY.retail;
}
