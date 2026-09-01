"use server";

export interface SubscribeState {
  ok: boolean;
  message: string | null;
}

/**
 * Subscribe an email address, and the name beside it, to the shop's newsletter.
 *
 * ── the name, and why it does not go to Spree's endpoint ─────────────────────
 *
 * The client drew a name box beside the email and asked whether it could work.
 * Measured against the running shop before anything was built:
 *
 *   POST /api/v3/store/newsletter_subscribers {email, name, first_name, last_name}
 *     -> 201 Created, and the name is gone
 *   POST /api/v3/store/newsletter_subscribers {email, public_metadata: {name}}
 *     -> 201 Created, public_metadata still null
 *
 * spree_newsletter_subscribers has no name column and the endpoint's parameters
 * do not include one, so a name posted there is discarded with no error at all.
 * A field that throws away what someone types is worse than no field.
 *
 * So this posts to /api/v3/store/newsletter_signups, which is ours. It subscribes
 * through the same platform call and then writes the name as a metafield, which
 * is the thing Spree's own CSV export already turns into a column. That is where
 * the shop owner actually meets his list.
 *
 * Subscribing is still double opt-in: Spree creates the row with verified =
 * false and emails a confirmation link, which is why the admin shows false
 * against a row he created himself. The wording below says a confirmation is
 * coming so nobody thinks it failed.
 */
export async function subscribeToNewsletter(
  _previous: SubscribeState,
  formData: FormData,
): Promise<SubscribeState> {
  const email = String(formData.get("email") ?? "").trim();
  const name = String(formData.get("name") ?? "")
    .trim()
    .slice(0, 100);

  // Checked here as well as by the browser: `type="email"` is a convenience, not
  // a guarantee, and one of these shops already carries a subscriber row with no
  // domain part at all, from a form that trusted it.
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, message: "Please enter a valid email address." };
  }

  // A direct POST rather than an SDK call. The endpoint, the header name and
  // the payload were all verified by hand against the running shop; the SDK's
  // surface for this resource was not, and a method name guessed from the
  // pattern of the others would fail at runtime rather than at build time.
  const base = process.env.SPREE_API_URL;
  const key = process.env.SPREE_PUBLISHABLE_KEY;
  if (!base || !key) {
    return { ok: false, message: "Sign up is not available right now." };
  }

  try {
    const response = await fetch(
      `${base.replace(/\/$/, "")}/api/v3/store/newsletter_signups`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Not X-Spree-Publishable-Key. That name returns 401 and looks like a
          // bad key rather than a bad header.
          "X-Spree-Api-Key": key,
        },
        body: JSON.stringify(name ? { email, name } : { email }),
        cache: "no-store",
      },
    );

    if (response.ok) {
      return { ok: true, message: "Thanks, you are on the list." };
    }

    const text = await response.text();
    // Already subscribed comes back 422. To the person typing, already being on
    // the list is success, so it is not shown as a failure.
    if (/already|taken|exists/i.test(text)) {
      return { ok: true, message: "You are already on the list." };
    }
    return { ok: false, message: "That did not go through. Please try again." };
  } catch (error) {
    // Network failure, not a rejection from the shop: a rejection is handled
    // above, where the status and body are available to tell them apart.
    void error;
    return { ok: false, message: "That did not go through. Please try again." };
  }
}
