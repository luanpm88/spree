import { Inline, isBullet, plain } from "@/components/blocks/Inline";
import type { FaqBlock } from "@/lib/blocks/types";

/**
 * Questions that open to reveal their answer.
 *
 * Built on the browser's own <details> element rather than React state. It opens
 * and closes with no JavaScript, it is keyboard operable and announced correctly
 * by screen readers without a line of ARIA, and it survives the page being
 * server rendered. A hand-rolled accordion would need all three of those written
 * and then tested.
 *
 * The client's answers are several paragraphs in places, so each one keeps its
 * line breaks rather than being joined into a block.
 */
export function Faq({ heading, sections }: FaqBlock) {
  return (
    <section className="py-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-3xl">
        {heading ? (
          <h1 className="text-4xl font-bold text-black mb-8">{heading}</h1>
        ) : null}

        {sections.map((section) => (
          <div
            key={section.title ?? section.items[0]?.question}
            className="mb-10"
          >
            {section.title ? (
              // Black and larger, which is what he asked for and where he asked
              // for it. His two arrows land on ORDERS, PAYMENTS & REFUNDS and on
              // SHIPPING & DELIVERY, the group headings, not on the page title:
              // "needs to be black and bigger font, it is getting lost". The
              // title was already black and 4xl, so reading the note as pointing
              // there changed nothing he could see, which is why it came back.
              <h2 className="text-lg font-bold tracking-wide text-black mb-4">
                {section.title}
              </h2>
            ) : null}

            <div className="divide-y divide-border border-y border-border">
              {section.items.map((item) => (
                <details key={item.question} className="group py-4">
                  <summary className="flex items-start justify-between gap-4 cursor-pointer list-none font-medium">
                    <span>{item.question}</span>
                    {/* Rotates on open. A plain character rather than an icon
                        font, so nothing extra loads for a page of chevrons. */}
                    <span
                      aria-hidden="true"
                      className="shrink-0 transition-transform group-open:rotate-45 text-xl leading-none"
                    >
                      +
                    </span>
                  </summary>
                  {/* His answers carry bold and links out to his help site, so
                      they go through the same inline formatter as the prose
                      blocks. Rendered as plain text they printed the markers
                      themselves: "through **Stripe** and **PayPal**". */}
                  <div className="mt-3 space-y-3 text-muted-foreground">
                    {item.answer.map((line) =>
                      // A heading inside an answer, the way the prose block
                      // already handles one. Six lines on one shop's FAQ are
                      // written "## Something" and every one of them printed
                      // its hashes to the customer, because this branch did not
                      // exist and the line fell through to a paragraph.
                      line.startsWith("## ") || line.startsWith("### ") ? (
                        <p
                          key={plain(line).slice(0, 40)}
                          className="font-bold text-foreground"
                        >
                          <Inline text={line.replace(/^#{2,3}\s+/, "")} />
                        </p>
                      ) : isBullet(line) ? (
                        <ul
                          key={plain(line).slice(0, 40)}
                          className="ml-5 list-disc leading-relaxed"
                        >
                          <li>
                            <Inline text={line.slice(2)} />
                          </li>
                        </ul>
                      ) : (
                        <p
                          key={plain(line).slice(0, 40)}
                          className="leading-relaxed"
                        >
                          <Inline text={line} />
                        </p>
                      ),
                    )}
                  </div>
                </details>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
