import type { Cart } from "@spree/sdk";

/**
 * When PayPal may open, and when an approved PayPal order may be captured.
 *
 * ── the fault this exists for ───────────────────────────────────────────────
 *
 * The "Pay now" button refuses to pay until the address and delivery steps are
 * done. PayPal's own button never asked. It was drawn the moment the payment
 * box scrolled into view, its PayPal order was created then, and approving it
 * in the popup captured the money straight away. Three things followed, all
 * measured on the live shops (docs/DISCOVERIES.md §84):
 *
 * - A customer pressed PayPal before typing an address. PayPal took the item
 *   price, the order could never complete, and the shop had a payment with no
 *   order behind it.
 * - A customer added a delivery method after the PayPal order existed. Spree
 *   recorded 51.18 paid; PayPal had captured 39.83. The postage was never taken.
 * - A customer applied a 20% code after the PayPal order existed. Spree
 *   recorded 84.40; PayPal captured 100.13. The owner found it and refunded the
 *   difference by hand.
 *
 * The last two are the gateway's doing: spree_paypal_checkout 0.7.1 answers a
 * session update by changing the number in Spree's own table and never tells
 * PayPal, so "the session follows the cart total" was true for Stripe and false
 * for PayPal.
 *
 * ── the rule ────────────────────────────────────────────────────────────────
 *
 * PayPal's order is built from `order.total` (the gem's OrderPresenter). So a
 * capture is only right when, at the moment of capture, the order still totals
 * exactly what that PayPal order was created for, nothing but payment is left
 * to do, and no gift card or store credit is reducing what is owed (PayPal
 * would charge the full total regardless).
 */

type GuardOrder = Pick<Cart, "total" | "amount_due" | "requirements"> &
  Partial<Pick<Cart, "payments">>;

export type PayPalGuardResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "already_paid"
        | "steps_missing"
        | "credit_applied"
        | "no_total"
        | "total_changed";
    };

/**
 * Payment states that mean money has moved, or is about to. A cart carrying one
 * is not waiting for payment: a capture went through and completing the order
 * failed afterwards. Taking a second payment there charges the customer twice,
 * so nothing may (store credit and gift card payments sit in "checkout" until
 * the order completes, and do not count).
 */
const MONEY_TAKEN = new Set(["completed", "pending", "processing"]);

/** Has this cart already taken money it never turned into an order? */
export function hasTakenPayment(
  order: Partial<Pick<Cart, "payments">>,
): boolean {
  return (order.payments ?? []).some((p) => MONEY_TAKEN.has(p.status));
}

/** Money strings compared as whole cents: "84.4" and "84.40" are one amount. */
export function toCents(value: string | null | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function prePaymentStepsMissing(order: GuardOrder): boolean {
  return (order.requirements ?? []).some((req) => req.step !== "payment");
}

/** May a PayPal order be created for this order right now? */
export function checkPayPalStart(order: GuardOrder): PayPalGuardResult {
  if (hasTakenPayment(order)) return { ok: false, reason: "already_paid" };
  if (prePaymentStepsMissing(order)) {
    return { ok: false, reason: "steps_missing" };
  }
  const total = toCents(order.total);
  if (total == null || total <= 0) return { ok: false, reason: "no_total" };
  const due = toCents(order.amount_due ?? order.total);
  if (due !== total) return { ok: false, reason: "credit_applied" };
  return { ok: true };
}

/**
 * May the approved PayPal order, created for `paypalAmount`, be captured
 * against the order as it stands now?
 */
export function checkPayPalCapture(
  order: GuardOrder,
  paypalAmount: string,
): PayPalGuardResult {
  const start = checkPayPalStart(order);
  if (!start.ok) return start;
  if (toCents(order.total) !== toCents(paypalAmount)) {
    return { ok: false, reason: "total_changed" };
  }
  return { ok: true };
}
