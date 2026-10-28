"use server";

import type { Order, OrderGroup, OrderListParams } from "@spree/sdk";
import { isOrderGroup } from "@spree/sdk";
import {
  DEFAULT_SURFACE,
  getCartOptions,
  getClient,
  getClientForSurface,
  type Surface,
  withAuthRefresh,
} from "@/lib/spree";
import { withFallback } from "./utils";

export async function getOrders(params?: OrderListParams) {
  return withFallback(
    async () => {
      return withAuthRefresh(async (options) => {
        return getClient().customer.orders.list(params, options);
      });
    },
    {
      data: [],
      meta: {
        page: 1,
        limit: 25,
        count: 0,
        pages: 0,
        from: 0,
        to: 0,
        in: 0,
        previous: null,
        next: null,
      },
    },
  );
}

/**
 * Get a single order by ID or number.
 * Works for both authenticated users (JWT) and guests (spreeToken).
 * The surface selects the cart token cookie + client so wholesale orders
 * resolve through the wholesale channel.
 */
/**
 * One order, never a group.
 *
 * Since SDK 6.0 an order lookup and a cart completion may answer with an
 * OrderGroup: a purchase split across several sellers. None of these shops has
 * more than one seller, so a group here is a fault, and the order pages have no
 * way to show one. Thrown rather than coerced, so it is seen.
 */
export function singleOrder(result: Order | OrderGroup): Order {
  if (isOrderGroup(result)) {
    throw new Error(
      `Expected one order, got an order group ${result.id} split across sellers`,
    );
  }
  return result;
}

export async function getOrder(
  id: string,
  params?: Record<string, unknown>,
  surface: Surface = DEFAULT_SURFACE,
) {
  return withFallback(async () => {
    const options = await getCartOptions(surface);
    return singleOrder(
      await getClientForSurface(surface).orders.get(id, params, options),
    );
  }, null);
}
