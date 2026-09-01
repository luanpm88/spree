"use client";

import { useActionState } from "react";
import { Inline } from "@/components/blocks/Inline";
import { Button } from "@/components/ui/button";
import { SUBSCRIBE_FIELDS_BY_SHOP } from "@/lib/blocks/content";
import type { SubscribeBlock } from "@/lib/blocks/types";
import {
  type SubscribeState,
  subscribeToNewsletter,
} from "@/lib/data/newsletter";

const INITIAL: SubscribeState = { ok: false, message: null };

/**
 * Email capture, rebuilt at the client's request.
 *
 * He asked for a name field so the admin's Customer column would stop showing a
 * dash. It is deliberately not here, and the reason is in
 * lib/data/newsletter.ts: the API takes only an email, and the column is a link
 * to a customer account rather than a typed name. It already fills itself, for
 * signed-out visitors too, whenever the address matches an account.
 *
 * Subscribing is double opt-in. Spree creates the row with verified = false and
 * emails a confirmation link, which is why his admin shows false against a row
 * he created himself. The wording below says a confirmation is coming so nobody
 * thinks it failed.
 */
interface SubscribeProps extends SubscribeBlock {
  termsHref?: string;
  termsLabel?: string;
  privacyHref?: string;
  privacyLabel?: string;
}

export function Subscribe({
  heading,
  body,
  buttonLabel,
  askForName,
  termsHref,
  termsLabel,
  privacyHref,
  privacyLabel,
}: SubscribeProps) {
  const [state, formAction, isPending] = useActionState(
    subscribeToNewsletter,
    INITIAL,
  );

  // His words for this shop where it has any, otherwise the wording below. Same
  // shape as ANNOUNCEMENT_BY_SHOP and SIGN_IN_BY_SHOP: one shop's copy must not
  // be able to reach the other 5, because a shared component is how another
  // shop's wording reached a customer once already.
  const shopFields =
    SUBSCRIBE_FIELDS_BY_SHOP[
      (process.env.NEXT_PUBLIC_DEFAULT_COUNTRY || "").toLowerCase()
    ] ?? {};

  // Both, or neither. A sentence promising terms that answer 404 is worse than
  // no sentence, and policy slugs are the shop owner's to rename.
  const consent = Boolean(termsHref && privacyHref);

  return (
    // White, not the near-white accent. The shipping notice above is now a full
    // width grey band, and #F7F7F7 under #F5F5F5 reads as one grey area with a
    // heading floating in it rather than as a panel followed by a section. On his
    // own page this block sits on white, between the grey notice and the grey
    // footer, which is what gives all three their edges.
    <section className="py-16 bg-background">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-2xl text-center">
        <h2 className="text-3xl font-bold mb-3">{heading}</h2>
        {/* Through the inline formatter, and in the body colour rather than the
            muted grey. His half sets the second half of this sentence in bold
            against black: "one good email at a time" is the promise, and it was
            the part being greyed out. Rendered as a plain string the ** markers
            would have printed themselves on the page. */}
        {body ? (
          <p className="mb-8">
            <Inline text={body} />
          </p>
        ) : null}

        <form
          action={formAction}
          className="flex flex-col sm:flex-row gap-3 justify-center"
        >
          {/* Name, then email, then the button, which is the order he drew it
              in. Deliberately not required: an address with no name is still a
              subscriber, and making it required trades signups for a nicety.

              The field is only useful because there is somewhere for it to go.
              Spree's own endpoint accepts an email and drops everything else
              without an error, so this posts to a route of ours that keeps the
              name as a metafield, which is what puts it in his CSV export. */}
          {askForName ? (
            <>
              <label htmlFor="newsletter-name" className="sr-only">
                Your name
              </label>
              <input
                id="newsletter-name"
                name="name"
                type="text"
                autoComplete="name"
                maxLength={100}
                placeholder={shopFields.namePlaceholder ?? "Your name"}
                className="flex-1 min-w-0 rounded-full border border-border bg-background px-6 py-3 text-base"
              />
            </>
          ) : null}
          <label htmlFor="newsletter-email" className="sr-only">
            Email address
          </label>
          <input
            id="newsletter-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder={shopFields.emailPlaceholder ?? "you@email.com"}
            className="flex-1 min-w-0 rounded-full border border-border bg-background px-6 py-3 text-base"
          />
          {/* Rounded ends and a capitalised label, both asked for by name. The
              label is upper cased here rather than in the content file so the
              words stay readable for whoever edits them next. */}
          {/* Black on the closed shop, his brand olive on the 5 retail ones.
              He struck the olive out twice, on the EXPLORE CATEGORY pills and on
              the hero button, and both were changed. This button was never
              looked at and kept #707757, so the one olive control left on the
              page was sitting on three pages he had already reviewed. His own
              GET UPDATES samples pure black. */}
          <Button
            type="submit"
            disabled={isPending}
            className="rounded-full px-8 py-3 uppercase tracking-wide"
          >
            {isPending ? "Signing you up…" : buttonLabel}
          </Button>
        </form>

        {/* The line under the form in his mock-up. Both links are resolved from
            the shop's own policies rather than written here, because these two
            slugs differ between his shops and a hardcoded pair has already put
            dead links on a page once. */}
        {consent ? (
          <p className="mt-4 text-sm text-muted-foreground">
            By subscribing you agree to our{" "}
            <a href={termsHref} className="underline hover:no-underline">
              {termsLabel || "Terms of Use"}
            </a>{" "}
            and{" "}
            <a href={privacyHref} className="underline hover:no-underline">
              {privacyLabel || "Privacy Policy"}
            </a>
            .
          </p>
        ) : null}

        {/* aria-live so the result is announced rather than only appearing. The
            form does not clear on success: seeing the address you typed next to
            the confirmation is what tells you the right one went in. */}
        <p
          aria-live="polite"
          className={`mt-4 text-sm min-h-5 ${state.ok ? "text-foreground" : "text-destructive"}`}
        >
          {state.message}
          {state.ok ? " Check your inbox to confirm." : null}
        </p>
      </div>
    </section>
  );
}
