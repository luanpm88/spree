import { Inline } from "@/components/blocks/Inline";
import type { DownloadsBlock } from "@/lib/blocks/types";

/**
 * A list of files to fetch, one row each.
 *
 * His wholesale Resources page. He photographed ours beside his on 20 Aug: his
 * lays each document out as a row, the name and a line about it on the left and
 * a black Download PDF button on the right, with a rule between each. Ours had
 * every one of those strings as an ordinary paragraph, so the page read as a
 * wall of text and the words "Download PDF" printed three times as text rather
 * than as anything you could press.
 *
 * The shape for this existed in types.ts from the beginning and no component was
 * ever written for it, so nothing could construct one and the copy had nowhere
 * to go but the rich text block. That is why it looked like a formatting fault
 * and was a missing component.
 *
 * The button is a real link rather than a script: the file lives at a URL, the
 * browser knows what to do with a PDF, and a middle click or a right click still
 * works the way somebody expects.
 *
 * Its URL comes from his own page. That took a day and a half to notice, because
 * the copy for this page was taken from the plain-text dump beside his HTML and
 * that dump strips anchors, so his three rows arrived as the bare words
 * "Download PDF" and a comment in pages.ts concluded the files were still with
 * him. They were on his own CDN the whole time, public, 200 as application/pdf.
 * A message asking him to send them was drafted twice.
 */
export function Downloads({ heading, items }: DownloadsBlock) {
  if (items.length === 0) return null;

  return (
    <section className="py-12">
      {/* max-w-3xl, the same as RichText above it. This was max-w-4xl, so on his
          Resources page the heading and the intro paragraph started at x=368 and
          the Available Downloads heading and every row started at x=304: the
          block sat 64px to the left of the copy it belongs under, and the rules
          ran 64px wider on each side. Measured, not noticed, and it was in the
          picture being sent to him as proof that page was finished. Boxes and
          spacing are what he annotates. */}
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-3xl">
        {heading ? (
          <h2 className="text-lg font-semibold mb-6">
            <Inline text={heading} />
          </h2>
        ) : null}

        <ul className="divide-y divide-border border-t border-b">
          {items.map((item) => (
            <li
              key={item.title}
              className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8"
            >
              <div className="min-w-0">
                <p className="font-semibold">
                  <Inline text={item.title} />
                </p>
                {item.description ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    <Inline text={item.description} />
                  </p>
                ) : null}
              </div>
              {/* The button is always in the row, because the row without it is
                  not his row.

                  It used to render only when a file was behind it, on the
                  reasoning that a button going nowhere is worse than no button.
                  That is true of a button that LOOKS live, and it read the
                  layout as if it were optional: his page has a black Download
                  PDF on every row, so a row without one is a different design,
                  and the picture of it went to him as proof the page was
                  finished. He replied asking where the buttons were.

                  So: same button, and until the file arrives it is visibly off.
                  A span rather than an anchor, so there is nothing to click and
                  nothing for a keyboard or a screen reader to land on, plus
                  aria-disabled and a title saying why. Honest and the right
                  shape at the same time. */}
              {item.href ? (
                <a
                  href={item.href}
                  // His own inline CSS, value for value: background #000000,
                  // colour #ffffff, padding 12px 24px, border-radius 6px,
                  // font-size 14px, font-weight 600, white-space nowrap.
                  // rounded-sm is 6px in this theme; rounded-md is 8px, which is
                  // what this had and is 2px off the one element he ticked.
                  className="shrink-0 inline-flex items-center justify-center whitespace-nowrap rounded-sm bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                  // His anchor carries it, so a customer keeps the page they
                  // were reading. Ours argued the other way and his own markup
                  // settles it.
                  target="_blank"
                  rel="noopener"
                >
                  Download PDF
                </a>
              ) : (
                <span
                  aria-disabled="true"
                  title="The file for this row has not been supplied yet"
                  // Same box as the live one so the row does not change shape
                  // when a file arrives, just dimmed. Not reached on the
                  // wholesale shop any more: all 3 of his rows carry his URL.
                  className="shrink-0 inline-flex cursor-not-allowed items-center justify-center whitespace-nowrap rounded-sm bg-primary/40 px-6 py-3 text-sm font-semibold text-primary-foreground"
                >
                  Download PDF
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
