import { IconFeatureRow } from "@/components/blocks/IconFeatureRow";
import { BAND } from "@/components/layout/footerLivery";
import type { IconBannerBlock } from "@/lib/blocks/types";

/**
 * His trust banner and his supply banner: a full-bleed tinted band of icons.
 *
 * Two of the three things he asked for on 13 Sep, and they are one component
 * used twice: "Trust banner with 4 icons", "Supply banner with 5 icons".
 *
 * ── his numbers, measured off the artwork rather than read off the picture ───
 *
 *   ground      #F7F7F4   his label, twice: "Colour: #F7F7F4"
 *   height      195px     his label, twice: "195 px heigh"; measured 192 and 189
 *   rules       3 in the four-item band, so between items and not around them
 *
 * ── why min-height and not height ───────────────────────────────────────────
 *
 * 195px is his desktop figure and it is exact there. It cannot be a fixed height
 * at every width: five items at 18px type reflow to two rows below about 900px
 * and to a column on a phone, and a fixed 195px band would then clip his second
 * line rather than grow. So the band holds his number as a floor and grows past
 * it when his own content needs the room. A band that is taller than the drawing
 * on a phone is right; a band that cuts the words off is not.
 *
 * The full-bleed ground is deliberate too. Both bands in his design run edge to
 * edge while the icons inside them sit in the page's container, which is why the
 * tint is on the section and the container is inside it.
 */
export function IconBanner({ items, minHeight = 195 }: IconBannerBlock) {
  // Nothing renders nothing, the same rule the banner and every other block
  // here follows. A band with no icons is a 195px stripe of tint, which is a
  // hole in the page that says nothing about why it is there.
  if (items.length === 0) return null;

  return (
    <section
      className="w-full"
      style={{
        backgroundColor: BAND.surface,
        minHeight: `${minHeight}px`,
      }}
    >
      <div
        className="container mx-auto flex items-center px-4 py-8 sm:px-6 lg:px-8"
        style={{ minHeight: `${minHeight}px` }}
      >
        <IconFeatureRow items={items} className="w-full" />
      </div>
    </section>
  );
}
