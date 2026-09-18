import type { Cart } from "@spree/sdk";
import { describe, expect, it } from "vitest";
import {
  expressCheckoutAmount,
  hasPayableTotal,
} from "@/lib/utils/express-checkout";

// Only the money fields these two read; the cast keeps the fixture minimal.
const cart = (fields: Partial<Record<string, string | null>>): Cart =>
  ({ currency: "AUD", ...fields }) as unknown as Cart;

/**
 * The client reported twice that a free product could not be bought. The cause
 * was two numbers where there should have been one: the button mounted on
 * `total`, which includes postage, and Stripe was handed the sum of the line
 * items, which does not. A free seal with postage charged made them disagree,
 * Stripe threw `amount must be greater than 0` during render, and the checkout
 * showed "Something went wrong".
 */
describe("hasPayableTotal", () => {
  it("is true for a paid item", () => {
    expect(hasPayableTotal(cart({ item_total: "19.99", total: "31.99" }))).toBe(
      true,
    );
  });

  it("is FALSE for a free item with postage charged, which is what broke", () => {
    const freeItemPaidPostage = cart({
      item_total: "0.0",
      ship_total: "12.00",
      total: "12.00",
    });
    expect(hasPayableTotal(freeItemPaidPostage)).toBe(false);
    expect(expressCheckoutAmount(freeItemPaidPostage)).toBe(0);
  });

  it("is false when the subtotal is unknown, even with a positive total", () => {
    // Prices hidden for a guest. The line items come back empty, so the amount
    // Stripe would get is 0 whatever the total says.
    expect(hasPayableTotal(cart({ item_total: null, total: "31.99" }))).toBe(
      false,
    );
  });

  it("is false when everything is null", () => {
    expect(hasPayableTotal(cart({ item_total: null, total: null }))).toBe(
      false,
    );
  });

  it("is false for a zero total", () => {
    expect(hasPayableTotal(cart({ item_total: "0.0", total: "0.0" }))).toBe(
      false,
    );
  });
});

describe("expressCheckoutAmount", () => {
  it("is the number Elements is given: subtotal, discount and tax, in cents", () => {
    expect(
      expressCheckoutAmount(
        cart({
          item_total: "20.00",
          discount_total: "-5.00",
          additional_tax_total: "1.50",
          ship_total: "12.00",
          total: "28.50",
        }),
      ),
    ).toBe(2000 - 500 + 150);
  });

  it("leaves postage out, because the Express Checkout Element quotes it itself", () => {
    expect(
      expressCheckoutAmount(
        cart({ item_total: "10.00", ship_total: "12.00", total: "22.00" }),
      ),
    ).toBe(1000);
  });
});
