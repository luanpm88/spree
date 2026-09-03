"use client";

import { type RefObject, useEffect, useState } from "react";

/**
 * Has the customer actually arrived at the payment step?
 *
 * ── the fault this exists for ───────────────────────────────────────────────
 *
 * The checkout is one long page: contact, delivery, a note, then payment, then
 * the pay button. `PaymentSection` therefore mounts the moment the page opens,
 * and its init effect created a Spree payment session straight away. For Stripe
 * that means a PaymentIntent per checkout page load, before the customer has
 * typed a character.
 *
 * The shop owner found it himself and described it exactly:
 *
 *   "Something is not right with Strip, every cart is making a connection with
 *    Stripe."
 *
 * His dashboard was 549 rows, nearly all Incomplete with no payment method. The
 * shops carry 315 payment sessions between them, and New Zealand alone made 102
 * in the four days after it went live, 36 of those inside one hour, on a shop
 * taking about one order a day. An hour like that is a machine, not a queue of
 * customers: our own checkout gate walks to /checkout on all seven shops every
 * time it runs. Both halves are the same bug, and the customer half is the one
 * that matters, because an abandoned checkout is the normal case and every one
 * of them was leaving a row behind.
 *
 * Nothing was ever charged. What it cost was the dashboard: the intents that
 * belong to real buyers were buried among the ones that belong to nobody.
 *
 * ── what counts as arriving ────────────────────────────────────────────────
 *
 * Scrolling the payment box into view, or touching it. Either one, whichever
 * happens first, and it never un-happens.
 *
 * The observer does nearly all the work, because scrolling is how everyone
 * reaches it. `rootMargin` starts the session while the box is still 200px
 * below the fold, so by the time it is on screen the spinner is already there
 * and the card field appears exactly as promptly as it did before. The customer
 * cannot tell this changed; only Stripe can.
 *
 * The two listeners cover arrivals the observer would see late or not at all:
 * tabbing in from the keyboard, a screen reader moving focus, and the jump this
 * page performs itself when validation fails and scrolls to the payment
 * section. They are on the container, so the billing address fields and the
 * method radios count as arriving too. They should: nobody touches those
 * without being at the payment step.
 *
 * ── why this cannot stop anyone paying ─────────────────────────────────────
 *
 * The card field is drawn inside this container and the pay button sits below
 * it, so every path that ends in a payment goes through the viewport that this
 * watches. The session cannot be created later than the moment it is needed.
 * When the box is already on screen at load, on a short cart or a tall
 * monitor, the observer's first callback fires immediately and the behaviour is
 * exactly what it was before.
 *
 * And where the browser has no IntersectionObserver at all, this reports true
 * at once rather than waiting. A shop that keeps a stale row in a dashboard is
 * a nuisance; a shop that cannot draw a card field is a shop that cannot sell.
 * The failure direction is chosen deliberately, and it is the opposite of the
 * one the cache purge chose.
 *
 * ── why an intersection is confirmed instead of believed ───────────────────
 *
 * Because the first version of this shipped and still leaked, and the probe
 * caught it on the live Canada shop: 31 sessions before opening the checkout,
 * 32 after, with the payment box measured at 1133px down a 900px window. Well
 * outside the 200px margin, and a session was created anyway.
 *
 * The checkout page STREAMS. When this section mounts, the contact and delivery
 * forms above it have not rendered yet, so the payment box is briefly near the
 * top of a nearly empty page and genuinely on screen. The observer's first
 * callback fires, correctly, on a layout that lasts a moment. Then the rest of
 * the page arrives and pushes the box down to where it really sits.
 *
 * So an intersection schedules a re-measurement rather than deciding. If the
 * box is still within reach when the layout has stopped moving, the customer is
 * really looking at it. If it has been pushed away, that callback described a
 * page that no longer exists.
 *
 * This is the same class of error as the mailer probe that set the locale it was
 * about to measure: a true observation of a state nobody was ever in. It was
 * only found by counting rows on a real shop, which is why the probe counts rows
 * rather than watching the browser.
 */

/**
 * How far outside the viewport still counts as reach, and how long to wait
 * before believing it.
 *
 * The margin matches InfiniteProductList so the work is done before the thing
 * is looked at. The settle delay is the streaming window: long enough that the
 * forms above have landed, short enough that a customer scrolling down does not
 * notice it, since they are still 200px away when it starts.
 */
const REACH_MARGIN = 200;
const SETTLE_MS = 600;
export function useReachedPaymentStep(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
): boolean {
  const [reached, setReached] = useState(false);

  useEffect(() => {
    if (!enabled || reached) return;

    const node = ref.current;
    if (!node) return;

    // Fail towards selling. See the note above: no observer means eager, not
    // never.
    if (typeof IntersectionObserver === "undefined") {
      setReached(true);
      return;
    }

    // Touching it is not in doubt and is never deferred. Only what the observer
    // reports needs confirming, because only the observer can describe a layout
    // that is still moving.
    const arrive = () => setReached(true);

    let settle: ReturnType<typeof setTimeout> | undefined;
    const withinReach = () => {
      const r = node.getBoundingClientRect();
      return (
        r.top < window.innerHeight + REACH_MARGIN && r.bottom > -REACH_MARGIN
      );
    };
    const arriveIfStillHere = () => {
      if (settle !== undefined) clearTimeout(settle);
      settle = setTimeout(() => {
        if (withinReach()) arrive();
      }, SETTLE_MS);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) arriveIfStillHere();
      },
      { threshold: 0.01, rootMargin: `${REACH_MARGIN}px` },
    );
    observer.observe(node);

    node.addEventListener("pointerdown", arrive);
    node.addEventListener("focusin", arrive);

    return () => {
      if (settle !== undefined) clearTimeout(settle);
      observer.disconnect();
      node.removeEventListener("pointerdown", arrive);
      node.removeEventListener("focusin", arrive);
    };
  }, [ref, enabled, reached]);

  return reached;
}
