import Link from "next/link";
import { Inline } from "@/components/blocks/Inline";
import type { FeatureListBlock } from "@/lib/blocks/types";

/**
 * A heading over a list of labelled items.
 *
 * Fifteen groups across the four business pages he sent on 25 August are this
 * one shape: seven branding methods, five numbered steps, eight categories,
 * twelve materials, three freight cards. See FeatureListBlock in types.ts for
 * the count and why it earned a block type of its own.
 *
 * ── the design, and how much of it to build ──────────────────────────────────
 *
 * His mockups draw an icon over every item, a connecting line between the
 * numbered steps, and a card with a shadow around each freight option. His own
 * message about them: "The design of these is a bit detailed so you can make
 * them more basic, this is just a mockup AI did for me."
 *
 * So this builds the STRUCTURE he drew and not the ornament: the grid, the
 * numbering, the card border, the button in the card. No icons, because there
 * are 40-odd distinct ones across four pages and every one of them would be a
 * guess at a picture he has not sent. A missing icon is a smaller wrong than
 * forty invented ones.
 *
 * ── the column count ─────────────────────────────────────────────────────────
 *
 * Chosen from the item count unless he asked for a specific one, which he did
 * once, on the tracking checklist: "use a 2-column checklist rather than one
 * long bullet list". Nine short lines in one column is the wall of text he was
 * objecting to.
 */

// Three across for a grid of descriptions, four for a list of bare labels, and
// two when the items are long. Derived from the item count so the fifteen
// groups do not each need a hand-set number, which is fifteen chances to differ.
function columnsFor(
  items: FeatureListBlock["items"],
  asked?: 2 | 3 | 4 | 5,
): 2 | 3 | 4 | 5 {
  if (asked) return asked;
  const anyProse = items.some(
    (i) => (i.body?.length ?? 0) > 0 || (i.bullets?.length ?? 0) > 0,
  );
  if (!anyProse) return 4;
  if (items.length <= 2) return 2;
  return fewestOrphans(items.length, [3, 4]);
}

const GRID = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
  // Five is asked for explicitly and never chosen automatically: five equal
  // columns is a strip of short labels, and it is the wrong grid for anything
  // carrying prose.
  5: "sm:grid-cols-2 lg:grid-cols-5",
} as const;

/**
 * The column count that leaves the fewest empty cells on the last row.
 *
 * Seven items in three columns puts one alone on row three with 74% of that row
 * empty, and five in three columns leaves 35% of row two blank. Both shipped
 * that way and both are the kind of gap he draws a box around. Four columns
 * takes seven to 4+3 and five to 4+1, so the choice is made per group rather
 * than fixed.
 *
 * Ties go to the wider grid, because his comps run these bands wide.
 */
function fewestOrphans(count: number, options: (2 | 3 | 4)[]): 2 | 3 | 4 {
  let best = options[0];
  let bestGap = count;
  for (const cols of options) {
    const gap = (cols - (count % cols)) % cols;
    if (gap < bestGap || (gap === bestGap && cols > best)) {
      best = cols;
      bestGap = gap;
    }
  }
  return best;
}

export function FeatureList({
  heading,
  intro,
  numbered,
  columns,
  accent = false,
  ticks = false,
  footnote,
  aside,
  items,
  basePath,
}: FeatureListBlock & { basePath: string }) {
  // Nothing at all renders nothing. A block with a heading and an intro and no
  // items renders those, because that is a real shape on these pages: four of
  // the groups he wrote are a heading over two or three paragraphs with no list
  // under them.
  //
  // Written as rich_text those four sat in a narrower centred column with an h1
  // in it, which put the page's first h1 half way down and made the alignment
  // jump twice per page. Same block, same container, same heading level as
  // everything around them is the whole reason this branch exists.
  if (items.length === 0 && !heading && !intro?.length) return null;

  const cols = columnsFor(items, columns);
  // A card is what he draws around an item that has its own button. Without one
  // the item is a plain entry in a grid, which is every other group on these
  // pages.
  const carded = items.some((i) => i.cta);
  // A grid of bare labels does not need the gap a grid of paragraphs does. His
  // tracking checklist is nine short lines, and at the paragraph gap they ran
  // down most of a screen with nothing between them, which is the opposite of
  // the tight two column list he drew.
  const gap = items.some(
    (i) => (i.body?.length ?? 0) > 0 || (i.bullets?.length ?? 0) > 0,
  )
    ? "gap-8"
    : "gap-x-8 gap-y-3";

  // LEFT text, RIGHT action panel, which is how he wrote it. Two thirds and one
  // third from lg upwards, stacked below it: at 768px a third of the panel is
  // 256px and a button in it wraps.
  const body = (
    <>
        {heading ? (
          // whitespace-pre-line, like every other heading here. His headings
          // arrive broken across two lines in the documents and a single string
          // wraps wherever the column happens to end.
          <h2
            className="mb-4 text-2xl font-bold whitespace-pre-line"
            // The token, and only where the shop defines one. A shop without
            // --brand-accent falls back to its own foreground rather than
            // inheriting a colour from the shop next door.
            style={accent ? { color: "var(--brand-accent, inherit)" } : undefined}
          >
            <Inline text={heading} />
          </h2>
        ) : null}

        {intro?.length
          ? intro.map((p) => (
              <p
                key={p.slice(0, 40)}
                className="mb-3 max-w-3xl leading-relaxed whitespace-pre-line"
              >
                <Inline text={p} />
              </p>
            ))
          : null}

        {/* ol when the items are numbered, ul when they are not. The list type
            is the ordering, so a screen reader announces "step 3 of 5" rather
            than reading a number that happens to be printed in the text. */}
        {items.length === 0 ? null : numbered ? (
          <ol className={`mt-8 grid ${gap} ${GRID[cols]}`}>
            {items.map((item, index) => (
              <li key={item.title} className="min-w-0">
                <div className="mb-2 flex items-baseline gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
                  >
                    {index + 1}
                  </span>
                  <h3 className="font-semibold">
                    <Inline text={item.title} />
                  </h3>
                </div>
                <ItemBody item={item} basePath={basePath} />
              </li>
            ))}
          </ol>
        ) : (
          <ul className={`mt-8 grid ${gap} ${GRID[cols]}`}>
            {items.map((item) => (
              <li
                key={item.title}
                className={
                  carded
                    ? "flex min-w-0 flex-col rounded-lg border p-6"
                    : "min-w-0"
                }
              >
                <h3 className="mb-2 flex gap-2 font-semibold">
                  {ticks ? (
                    <span aria-hidden="true" style={{ color: "var(--brand-accent, currentColor)" }}>
                      ✓
                    </span>
                  ) : null}
                  <span>
                    <Inline text={item.title} />
                  </span>
                </h3>
                <ItemBody item={item} basePath={basePath} carded={carded} />
              </li>
            ))}
          </ul>
        )}

        {footnote ? (
          <p className="mt-8 max-w-3xl text-sm text-muted-foreground">
            <Inline text={footnote} />
          </p>
        ) : null}
    </>
  );

  return (
    <section className="py-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        {aside ? (
          <div className="lg:grid lg:grid-cols-3 lg:gap-10">
            <div className="min-w-0 lg:col-span-2">{body}</div>
            <aside className="mt-10 rounded-lg border p-6 lg:mt-0">
              <h3 className="mb-3 text-xl font-bold">
                <Inline text={aside.heading} />
              </h3>
              {aside.body?.map((p) => (
                <p key={p.slice(0, 40)} className="mb-3 text-sm leading-relaxed">
                  <Inline text={p} />
                </p>
              ))}
              {aside.cta ? (
                aside.cta.href ? (
                  <Link
                    href={
                      aside.cta.href.startsWith("http")
                        ? aside.cta.href
                        : `${basePath}${aside.cta.href}`
                    }
                    className="mt-2 inline-flex w-full items-center justify-center rounded-sm bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    {aside.cta.label}
                  </Link>
                ) : (
                  // Drawn and not yet addressed. Same treatment as everywhere
                  // else: present, visibly off, nothing to click.
                  <span
                    aria-disabled="true"
                    title="The link for this button has not been supplied yet"
                    className="mt-2 inline-flex w-full cursor-not-allowed items-center justify-center rounded-sm bg-primary/40 px-5 py-3 text-sm font-semibold text-primary-foreground"
                  >
                    {aside.cta.label}
                  </span>
                )
              ) : null}
              {/* "Under the button panel in smaller muted text", his words. It
                  had ended up above the panel it is meant to sit beneath. */}
              {aside.note ? (
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  <Inline text={aside.note} />
                </p>
              ) : null}
            </aside>
          </div>
        ) : (
          body
        )}
      </div>
    </section>
  );
}

function ItemBody({
  item,
  basePath,
  carded,
}: {
  item: FeatureListBlock["items"][number];
  basePath: string;
  carded?: boolean;
}) {
  return (
    <>
      {item.body?.map((p) => (
        <p
          key={p.slice(0, 40)}
          className="mb-2 text-sm leading-relaxed whitespace-pre-line"
        >
          <Inline text={p} />
        </p>
      ))}
      {item.bullets?.length ? (
        <ul className="mb-2 ml-5 list-disc text-sm leading-relaxed">
          {item.bullets.map((b) => (
            <li key={b.slice(0, 40)}>
              <Inline text={b} />
            </li>
          ))}
        </ul>
      ) : null}
      {item.note ? (
        <p className="mb-3 text-sm leading-relaxed">
          <Inline text={item.note} />
        </p>
      ) : null}
      {item.cta ? (
        item.cta.href ? (
          // mt-auto so every button in a row of cards sits on the same line even
          // when the cards hold different amounts of text. His three freight
          // cards have 6, 5 and 5 bullets and the buttons were drawn level.
          <Link
            href={
              // basePath in front of an internal link, always. Without it a link
              // on the wholesale shop points at /custom-branding rather than
              // /b2b/en/custom-branding, which on a closed shop is a bounce
              // straight back out to the sign-in. It looks right in a screenshot
              // and is wrong on the click.
              item.cta.href.startsWith("http")
                ? item.cta.href
                : `${basePath}${item.cta.href}`
            }
            className={`${carded ? "mt-auto " : "mt-2 "}inline-flex items-center justify-center whitespace-nowrap rounded-sm bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90`}
          >
            {item.cta.label}
          </Link>
        ) : (
          // An empty href means he has drawn the button and not yet said where
          // it goes. Four of them are in that state on the tracking page: the
          // MyProjects sign-in and the three freight carriers.
          //
          // Same treatment as the Download PDF rows, and for the same reason. It
          // was tried the other way once, dropping the button until the link
          // arrived, and he replied asking where the buttons were: the row
          // without one is not his row. So the button is there, in its place, in
          // its box, and visibly off. A span rather than an anchor, so there is
          // nothing to click and nothing for a keyboard or a screen reader to
          // land on, plus aria-disabled and a title saying why.
          <span
            aria-disabled="true"
            title="The link for this button has not been supplied yet"
            className={`${carded ? "mt-auto " : "mt-2 "}inline-flex cursor-not-allowed items-center justify-center whitespace-nowrap rounded-sm bg-primary/40 px-5 py-2.5 text-sm font-semibold text-primary-foreground`}
          >
            {item.cta.label}
          </span>
        )
      ) : null}
    </>
  );
}
