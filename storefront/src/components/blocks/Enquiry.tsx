import Link from "next/link";
import { Inline } from "@/components/blocks/Inline";
import type { EnquiryBlock } from "@/lib/blocks/types";

/**
 * Heading, one line, one button.
 *
 * The foot of the wholesale front page, in the slot the subscribe box holds on
 * the five retail shops. He sent the wording on 20 Aug and confirmed the
 * placement the same afternoon against a rendered image of his own design:
 * heading, body, and a black pill button centred underneath.
 *
 * Both strings go through the inline formatter rather than being printed raw.
 * His copy is pulled off his live site and carries ** and link markers in it,
 * and a block that renders a plain string prints those markers to a customer.
 * That has happened here before, on the notice block, which is why every block
 * that takes his words goes through Inline now whether the current wording
 * needs it or not.
 */
export function Enquiry({
  heading,
  body,
  button,
  wide = false,
  basePath,
}: EnquiryBlock & { basePath: string }) {
  return (
    <section className="py-16">
      {/* The same container as everything else on the page when wide, and the
          narrow centred one it was built for otherwise. See EnquiryBlock in
          types.ts for the measurement: at the foot of the business pages this
          sat 256px right of every other block on the page. */}
      <div
        className={`container mx-auto px-4 sm:px-6 lg:px-8${wide ? "" : " max-w-3xl"}`}
      >
        <h2 className="text-2xl font-bold mb-3">
          <Inline text={heading} />
        </h2>
        <p className={`text-base mb-8${wide ? " max-w-3xl" : " text-muted-foreground"}`}>
          <Inline text={body} />
        </p>
        {/* An empty href means he has drawn the button and not yet said where it
            goes. On the tracking page that is Open MyProjects: MyProjects is a
            system outside this shop and only he knows its address.

            Rendered as a Link regardless, this emitted <a href=""> on that page,
            which is a live link to the page you are already on: a customer
            looking for their order clicks it and the page reloads. Found by
            walking every button on the four new pages and reading the href off
            each one, not by looking at the render, where it is a perfectly
            normal button.

            Same treatment as the Download PDF rows and the freight cards: same
            box, visibly off, a span so there is nothing to click and nothing for
            a keyboard or a screen reader to land on, and a title saying why. */}
        {button.href ? (
          <Link
            href={`${basePath}${button.href}`}
            className="inline-flex items-center justify-center rounded-full bg-foreground px-8 py-3 text-sm font-semibold uppercase tracking-wide text-background transition-opacity hover:opacity-90"
          >
            {button.label}
          </Link>
        ) : (
          <span
            aria-disabled="true"
            title="The link for this button has not been supplied yet"
            className="inline-flex cursor-not-allowed items-center justify-center rounded-full bg-foreground/40 px-8 py-3 text-sm font-semibold uppercase tracking-wide text-background"
          >
            {button.label}
          </span>
        )}
      </div>
    </section>
  );
}
