import Image from "next/image";
import { Inline } from "@/components/blocks/Inline";
import { BAND } from "@/components/layout/footerLivery";
import type { IconFeature } from "@/lib/blocks/types";

/**
 * A row of icons, each over a bold line and a lighter one, divided by rules.
 *
 * Three of these are his Part 2 design and they are the same row three times:
 * four in the hero, four in the trust band, five in the supply band. He drew
 * them identically, so they are built once. See IconFeature in types.ts.
 *
 * ── every number below was measured off his artwork, not chosen ─────────────
 *
 * The annotated file he sent on 13 Sep renders 1:1 with the numbers written on
 * it: its trust band measures 192px against his label of "195 px heigh", its
 * newsletter 424 against "428", its supply band 189 against "195". So his px are
 * CSS px and can be used as written rather than divided by a guess at an export
 * scale. The measurements taken from it:
 *
 *   icon            64px tall           his label: "Icon 63px heigh"
 *   title           ink 19px with a descender, so ~18px, bold
 *   second line     ink 13px, no descender, so ~18px, regular
 *   icon to title   24px
 *   title to line   8px
 *   item pitch      337px, from item centres at 529, 870, 1205 and 1542
 *   widest line     241px, "Product knowledge that matters"
 *
 * ── why the horizontal padding is 16px and not 24 ───────────────────────────
 *
 * That last pair is the reason. His widest second line fills 241 of a 337px
 * item, so it sits on one line with room to spare. On a 1440 screen the same
 * string renders 257px in this shop's own font, in a 304px item, and at 24px of
 * padding a side there are 256px to put it in. One pixel short, and the band
 * came out 211px tall instead of his 195 because that one line wrapped.
 *
 * Measured rather than nudged: 257 against 256. At 16px a side there are 272 and
 * his band is his height again.
 *
 * ── the rule colour is his hex and NOT solid ────────────────────────────────
 *
 * He wrote "Line colour: #4E5639". Rendered solid that is a hard dark rule, and
 * his own artwork does not show one: sampled across the three rules in his trust
 * band they measure #B8BAAA, #B7B9AC and #B7B9AC. Solving that against the band
 * ground (#F7F7F4) gives his #4E5639 at 0.373, 0.379 and 0.396 opacity on the
 * three colour channels, which is one answer three times over.
 *
 * So the hex is his, written once as BAND in footerLivery.ts, and the 40% is
 * measured off his own picture. Painting it solid because the label says a solid
 * hex would be following the annotation past what the annotation describes.
 *
 * ── fixed in a band, fluid in the hero ──────────────────────────────────────
 *
 * `fluid` is the one difference between the three uses, and it exists because
 * his artwork gives the hero a height that moves and the bands a height that
 * does not.
 *
 * A band is 195px at every width, so its icons stay at his 63px and its type at
 * his 18px. The hero is "Full Width 2560 x 933px", so its height is a fraction
 * of the viewport: 525px on a 1440 screen against 756px on the 2076px-wide
 * canvas he drew. Holding his 63px icons and 64.5px heading inside a band that
 * has shrunk by a third is what pushed the buttons out of the bottom of it and
 * broke his heading onto three lines. So in the hero everything is expressed as
 * the same fraction of the viewport that it is of his canvas, capped at the
 * number he wrote, and the row is his drawing at 2076px and a true scale of it
 * below that.
 */
/**
 * Columns per breakpoint, and which items start a row at each one.
 *
 * Written out as literal class strings on purpose. Tailwind finds classes by
 * scanning the source for the text of them, so a template built from a variable
 * produces a class that is never generated and a rule that never appears. The
 * same trap as the category ids in home.ts, one layer down.
 *
 * Every item carries `border-l`; these take it off the first item of each row.
 * `nth-child(2n+1)` is 1, 3, 5 and is the two-column case; `4n+1` and `5n+1` are
 * just item 1 once the row holds all of them.
 *
 * Two columns is the floor everywhere, because four of his labels across a
 * 390px phone is not a row. The hero opens out at `sm` since it is only four
 * items; the bands wait for `lg`, where there is room for his 18px second lines
 * at their full width.
 */
const COLUMNS = {
  hero: {
    // Four across only from xl. Between 1024 and 1279 the hero column is 43vw,
    // so each of four cells is 110-138px, and his longest second line
    // ("Door-to-door worldwide") needs 115px even at the 11px floor. Four across
    // there wraps his labels, which is the one thing he named. Two by two holds
    // them on one line and is the same shape the phone already uses.
    grid: "grid-cols-2 xl:grid-cols-4",
    rules:
      "[&>li:nth-child(2n+1)]:border-l-0 xl:[&>li:nth-child(2n+1)]:border-l xl:[&>li:nth-child(4n+1)]:border-l-0",
  },
  band4: {
    grid: "grid-cols-2 lg:grid-cols-4",
    rules:
      "[&>li:nth-child(2n+1)]:border-l-0 lg:[&>li:nth-child(2n+1)]:border-l lg:[&>li:nth-child(4n+1)]:border-l-0",
  },
  band5: {
    grid: "grid-cols-2 lg:grid-cols-5",
    rules:
      "[&>li:nth-child(2n+1)]:border-l-0 lg:[&>li:nth-child(2n+1)]:border-l lg:[&>li:nth-child(5n+1)]:border-l-0",
  },
} as const;

export function IconFeatureRow({
  items,
  className = "",
  fluid = false,
}: {
  items: IconFeature[];
  className?: string;
  /** Scale with the viewport, for the hero. Bands stay at his fixed numbers. */
  fluid?: boolean;
}) {
  if (items.length === 0) return null;

  // His three rows are four, four and five. A band of any other length falls
  // back to the five-column shape rather than the four, because a leftover item
  // in a wide row reads better than one squeezed out of a narrow one.
  const key = fluid ? "hero" : items.length === 4 ? "band4" : "band5";

  // 63/2076 and 18/2076 of his canvas, capped at his own numbers, with a floor
  // so a phone does not end up with 11px icons.
  const sizes = fluid
    ? {
        icon: "clamp(40px, 3.034vw, 77.7px)",
        title: "clamp(12px, 0.867vw, 22.2px)",
        body: "clamp(11px, 0.867vw, 22.2px)",
      }
    : { icon: "63px", title: "18px", body: "18px" };

  return (
    <ul
      // A GRID with a known column count, not a wrapping flex row, and the
      // reason is a rule that shipped in the wrong place.
      //
      // It was flex-wrap with `border-l` on every item but the first. The note
      // here claimed that avoided "a rule dangling at the end of a line", and it
      // did not: on a 390px phone the four hero icons go two by two, and item
      // three is the first of the second row, so it drew a rule hard against the
      // left edge of the page with nothing to its left. Seen in a screenshot,
      // not in the code, which is the whole argument for taking one.
      //
      // A grid knows its columns, so the first item of every row can be named.
      // Every item gets a left rule and `nth-child` takes it back off whichever
      // ones start a row at that breakpoint. See COLUMNS below.
      className={`grid items-stretch gap-y-8 ${COLUMNS[key].grid} ${COLUMNS[key].rules} ${className}`}
      style={{
        color: BAND.ink,
        ["--icon-h" as string]: sizes.icon,
        ["--icon-title" as string]: sizes.title,
        ["--icon-body" as string]: sizes.body,
      }}
    >
      {items.map((item) => (
        <li
          key={item.title}
          className={`flex min-w-0 flex-col items-center border-l text-center ${
            // The hero row sits in a 43vw column, so its four items are only
            // about 155px wide at 1440. At 12px of padding a side that left 131
            // for a label needing 135, and "Door-to-door worldwide" broke onto a
            // second line where his artwork keeps it on one. The two bands are
            // full width and keep the roomier padding.
            fluid ? "px-1 sm:px-2" : "px-3 sm:px-4"
          }`}
          style={{
            // His hex at the opacity measured off his own artwork. See BAND.
            borderColor: `color-mix(in srgb, ${BAND.rule} ${BAND.ruleOpacity * 100}%, transparent)`,
          }}
        >
          <Image
            src={item.icon}
            alt=""
            // The file's own dimensions, so next/image reserves the right box.
            // They are a common-height set at varying widths, which is why the
            // width is carried per icon rather than assumed square.
            width={item.iconWidth}
            height={item.iconHeight}
            // aria-hidden via the empty alt: the title underneath says the same
            // thing, and a screen reader announcing "globe with tick, Trusted by
            // Business" reads the item twice.
            className="w-auto max-w-full object-contain"
            style={{ height: "var(--icon-h)" }}
          />
          <h3
            className="mt-3 font-bold leading-tight"
            style={{ fontSize: "var(--icon-title)" }}
          >
            <Inline text={item.title} />
          </h3>
          {item.body ? (
            <p
              className="mt-1 leading-tight"
              style={{ fontSize: "var(--icon-body)" }}
            >
              <Inline text={item.body} />
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
