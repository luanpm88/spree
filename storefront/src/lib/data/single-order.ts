import type { Order, OrderGroup } from "@spree/sdk";
import { isOrderGroup } from "@spree/sdk";

// Not in orders.ts: that module is "use server", where every export must be an
// async server action, and `next build` refuses a plain function there (tsc and
// the unit tests do not; found by the first production build on 6.0, 29 Oct).

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
