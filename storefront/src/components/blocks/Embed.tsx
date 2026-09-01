import type { EmbedBlock } from "@/lib/blocks/types";

/**
 * Somebody else's page, inside one of his.
 *
 * His Book a Meeting page is a paragraph or two of his own words followed by a
 * booking calendar served by his scheduling provider. On his current shop that
 * is an iframe he pasted into the page editor, so it is an iframe here.
 *
 * The shape for this was declared in types.ts at the start and no component was
 * ever written, which is the second time that pattern has cost a page: the
 * downloads block had the same gap and the client photographed the result. A
 * declared type with nothing behind it renders as nothing and says nothing.
 *
 * ── the sandbox ──────────────────────────────────────────────────────────────
 *
 * A booking widget needs scripts, its own origin, and the ability to send the
 * customer somewhere on submit. It does not need access to this page, so it is
 * not given allow-same-origin against OUR origin: the sandbox list below lets it
 * run as its own site and nothing more. Dropping the sandbox entirely would hand
 * a third party the same footing as the shop.
 */
export function Embed({ heading, src, height = 900, title, maxWidth }: EmbedBlock) {
  return (
    <section className="py-8">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        {heading ? (
          <h2 className="text-lg font-semibold mb-4">{heading}</h2>
        ) : null}
        <iframe
          src={src}
          title={title}
          height={height}
          // Capped where the framed page lays itself out narrower than the
          // frame. See EmbedBlock in types.ts: his quotation form used 38% of
          // the width it was given.
          style={maxWidth ? { maxWidth: `${maxWidth}px` } : undefined}
          className="w-full rounded-lg border border-border"
          loading="lazy"
          // allow-same-origin here means "same origin as the framed site", which
          // is what a booking app needs to read its own cookies. It does not
          // grant anything against this shop.
          sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    </section>
  );
}
