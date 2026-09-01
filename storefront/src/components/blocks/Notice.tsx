import { Inline } from "@/components/blocks/Inline";
import type { NoticeBlock } from "@/lib/blocks/types";

/**
 * One line across the page.
 *
 * His is the shipping and customs notice under the About panel: the answer to the
 * question that stops an international order, so it earns its own block rather
 * than being buried in a paragraph.
 *
 * ── the four notes he drew on this one, and what each one changed ─────────────
 *
 *   "No space"                    the band starts where the green panel ends.
 *                                 There is no white gap between them on his
 *                                 shop, so there is none here: no outer padding
 *                                 above, and the section is full bleed rather
 *                                 than a rounded card sitting inside the page
 *                                 container with margin on every side.
 *   "needs to be the same in a
 *    gray box"                    a grey strip the full width of the page, which
 *                                 is what "the same" points at on his half.
 *   "bigger font"                 against the heading, which was 14px and read
 *                                 as a caption.
 *   "bold"                        against the last sentence of the body. It was
 *                                 never going to work: this block rendered
 *                                 `body` as a plain string, so the ** markers in
 *                                 the copy would have printed themselves. It
 *                                 goes through the same inline formatter as
 *                                 every other block now.
 *
 * The space below is kept. His page has the band, then white, then Subscribe.
 */
export function Notice({ heading, body, tone = "info" }: NoticeBlock) {
  const tones = {
    // A token rather than bg-neutral-100, because this band is one of the four
    // surfaces his sixth shop names a colour for: #EAEEED, the same value as its
    // announcement strip and its header. It rendered #F5F5F5 there, which is a
    // neutral grey and 4/255 away from the value he wrote, so it looked right in
    // a screenshot and was the wrong colour.
    info: "bg-[var(--notice)] text-foreground",
    warning: "bg-destructive/10 text-foreground",
  } as const;

  return (
    <section className={`${tones[tone]} py-8`}>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 text-center">
        {heading ? (
          <p className="text-lg font-bold mb-2">
            <Inline text={heading} />
          </p>
        ) : null}
        <p className="text-base">
          <Inline text={body} />
        </p>
      </div>
    </section>
  );
}
