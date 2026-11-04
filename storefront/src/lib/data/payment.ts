"use server";

import type { Order } from "@spree/sdk";
import { updateTag } from "next/cache";
import {
  cacheTagSuffix,
  getCartOptions,
  getClientForSurface,
  requireCartId,
  type Surface,
} from "@/lib/spree";
import { getCart } from "./cart";
import {
  resolveSurfaceForCart,
  resolveSurfaceForCartVerified,
} from "./checkout";
import { getOrder } from "./orders";
import { actionResult } from "./utils";

function checkoutTag(surface: Surface): string {
  return `checkout${cacheTagSuffix(surface)}`;
}

function cartTag(surface: Surface): string {
  return `cart${cacheTagSuffix(surface)}`;
}

export async function createCheckoutPaymentSession(
  cartId: string,
  paymentMethodId: string,
  externalData?: Record<string, unknown>,
) {
  return actionResult(async () => {
    const surface = await resolveSurfaceForCart(cartId);
    const options = await getCartOptions(surface);
    const id = await requireCartId(surface);
    const session = await getClientForSurface(
      surface,
    ).carts.paymentSessions.create(
      id,
      {
        payment_method_id: paymentMethodId,
        ...(externalData && { external_data: externalData }),
      },
      options,
    );
    updateTag(checkoutTag(surface));
    return { session };
  }, "Failed to create payment session");
}

/**
 * Syncs an existing payment session with the provider (e.g. after the cart
 * total changed). Keeps the provider-side session — and therefore the
 * mounted gateway form — alive, unlike creating a fresh session.
 */
export async function updateCheckoutPaymentSession(
  cartId: string,
  sessionId: string,
  params: { amount?: string; external_data?: Record<string, unknown> } = {},
) {
  return actionResult(async () => {
    const surface = await resolveSurfaceForCart(cartId);
    const options = await getCartOptions(surface);
    const id = await requireCartId(surface);
    const session = await getClientForSurface(
      surface,
    ).carts.paymentSessions.update(id, sessionId, params, options);
    updateTag(checkoutTag(surface));
    return { session };
  }, "Failed to update payment session");
}

/**
 * Creates a direct payment for non-session payment methods
 * (e.g. Check, Cash on Delivery, Bank Transfer).
 */
export async function createDirectPayment(
  cartId: string,
  paymentMethodId: string,
) {
  return actionResult(async () => {
    const surface = await resolveSurfaceForCart(cartId);
    const options = await getCartOptions(surface);
    const id = await requireCartId(surface);
    const payment = await getClientForSurface(surface).carts.payments.create(
      id,
      { payment_method_id: paymentMethodId },
      options,
    );
    updateTag(checkoutTag(surface));
    return { payment };
  }, "Failed to create payment");
}

export async function completeCheckoutPaymentSession(
  cartId: string,
  sessionId: string,
  params?: { session_result?: string; external_data?: Record<string, unknown> },
) {
  return actionResult(async () => {
    const surface = await resolveSurfaceForCart(cartId);
    const options = await getCartOptions(surface);
    const id = await requireCartId(surface);
    const session = await getClientForSurface(
      surface,
    ).carts.paymentSessions.complete(id, sessionId, params, options);
    updateTag(checkoutTag(surface));
    return { session };
  }, "Failed to complete payment session");
}

/**
 * How long a 422 is given to turn out to be a concurrent completion (the
 * webhook finishing the same order) before it is believed. Not exported: a
 * "use server" module may export async functions only.
 */
const INCOMPLETE_RECHECK_MS = 1500;

/**
 * After a 422 from complete: is the cart still sitting there unfinished?
 *
 * A 422 has two meanings and only one of them is success. A concurrent request
 * that completed the order first answers 422 (state_lock_version), and so does
 * an order that cannot complete at all: Spree's carts#complete renders
 * "Could not complete checkout" as 422 when the order has no address or no
 * delivery. Reading every 422 as success sent that second customer on to the
 * thank-you page with their money taken and no order behind it
 * (docs/DISCOVERIES.md §84). So look: a completed order no longer reads as a
 * cart, an unfinished one does. One recheck covers the race with the webhook.
 */
async function cartStillUnfinished(
  cartId: string,
  surface: Surface,
): Promise<boolean> {
  const unfinished = async () => {
    const cart = await getCart(cartId, surface).catch(() => null);
    return Boolean(cart && cart.current_step !== "complete");
  };
  if (!(await unfinished())) return false;
  await new Promise((resolve) => setTimeout(resolve, INCOMPLETE_RECHECK_MS));
  return unfinished();
}

/**
 * Completes the order. Treats as success:
 * - 403 = cart already completed (e.g. webhook handler completed it)
 * - 422 = state_lock_version conflict (concurrent request), but only once the
 *   cart is confirmed gone; a cart still unfinished after a 422 is a failure
 *
 * When the order was already completed (403/422), fetch it from the API
 * so the caller always gets the order data for caching on the thank-you page.
 */
export async function completeCheckoutOrder(
  cartId: string,
  knownSurface?: Surface,
) {
  const surface = knownSurface ?? (await resolveSurfaceForCart(cartId));
  try {
    const options = await getCartOptions(surface);
    const order: Order = await getClientForSurface(surface).carts.complete(
      cartId,
      options,
    );
    updateTag(checkoutTag(surface));
    updateTag(cartTag(surface));
    return { success: true as const, order };
  } catch (error: unknown) {
    if (error && typeof error === "object" && "status" in error) {
      const status = (error as { status: number }).status;
      if (status === 422 && (await cartStillUnfinished(cartId, surface))) {
        return {
          success: false as const,
          error:
            error instanceof Error && error.message
              ? error.message
              : "Failed to complete order",
        };
      }
      if (status === 403 || status === 422) {
        // Order already completed — try to fetch it so the thank-you page
        // can cache and display it without a second round-trip.
        const completedOrder = await getOrder(cartId, undefined, surface).catch(
          () => null,
        );
        updateTag(checkoutTag(surface));
        updateTag(cartTag(surface));
        return { success: true as const, order: completedOrder };
      }
    }
    return {
      success: false as const,
      error:
        error instanceof Error ? error.message : "Failed to complete order",
    };
  }
}

/**
 * Confirms payment and completes the order after returning from an offsite
 * payment gateway (e.g. CashApp, 3D Secure).
 */
export async function confirmPaymentAndCompleteCart(
  cartId: string,
  sessionId?: string,
  sessionResult?: string,
  redirectResult?: string,
  adyenSessionId?: string,
): Promise<
  { success: true; order: unknown } | { success: false; error: string }
> {
  // Cookies may have been cleared during the offsite redirect, so verify the
  // surface against the cart's own channel rather than trusting the cookie.
  const verifiedSurface = await resolveSurfaceForCartVerified(cartId);
  if (verifiedSurface === "unverified") {
    // The wholesale check couldn't run to completion (transient fetch/channel
    // failure). Fail closed rather than defaulting to DTC: completing a
    // possibly-wholesale checkout through the DTC client, or reporting success
    // for a cart we couldn't fetch, would be worse than asking the caller to
    // retry once the backend recovers.
    return {
      success: false,
      error: "Couldn't confirm your order yet. Please try again in a moment.",
    };
  }
  const surface = verifiedSurface;
  try {
    const cart = await getCart(cartId, surface);
    if (!cart) {
      // Cart not found — the order may already be completed (e.g. by webhook).
      // Try fetching it as a completed order before giving up.
      const completedOrder = await getOrder(cartId, undefined, surface).catch(
        () => null,
      );
      return { success: true, order: completedOrder };
    }

    if (cart.current_step === "complete") {
      return { success: true, order: cart };
    }

    if (sessionId) {
      const options = await getCartOptions(surface);
      const id = await requireCartId(surface);
      const completeResult = await getClientForSurface(
        surface,
      ).carts.paymentSessions.complete(
        id,
        sessionId,
        sessionResult ? { session_result: sessionResult } : undefined,
        options,
      );
      if (completeResult.status === "failed") {
        return {
          success: false,
          error: "Payment was not successful. Please try again.",
        };
      }
    } else if (redirectResult) {
      // Adyen redirect flow: redirectResult is appended by Adyen to the return URL.
      // Pass it to the backend which resolves the session and processes the redirect.
      const options = await getCartOptions(surface);
      const id = await requireCartId(surface);
      const completeResult = await getClientForSurface(
        surface,
      ).carts.paymentSessions.complete(
        id,
        adyenSessionId ?? "",
        {
          external_data: {
            redirect_result: redirectResult,
          },
        },
        options,
      );
      if (completeResult.status === "failed") {
        return {
          success: false,
          error: "Payment was not successful. Please try again.",
        };
      }
    }

    // Pass the verified surface so completion doesn't re-resolve from the
    // (possibly cleared) cookie.
    const result = await completeCheckoutOrder(cartId, surface);
    if (result.success) {
      return { success: true, order: result.order };
    }
    return { success: false, error: result.error };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to confirm payment. Please try again.",
    };
  }
}
