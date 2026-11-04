import type { Cart } from "@spree/sdk";
import { describe, expect, it } from "vitest";
import {
  checkPayPalCapture,
  checkPayPalStart,
  hasTakenPayment,
  toCents,
} from "@/lib/utils/paypal-guard";

type Order = Pick<Cart, "total" | "amount_due" | "requirements">;

const ready: Order = { total: "51.18", amount_due: "51.18", requirements: [] };

describe("toCents", () => {
  it("reads one amount however it is written", () => {
    expect(toCents("84.4")).toBe(8440);
    expect(toCents("84.40")).toBe(8440);
    expect(toCents("100.13")).toBe(10013);
  });

  it("does not drift on amounts that are not exact in binary", () => {
    // 0.29 * 100 is 28.999999999999996 in floating point.
    expect(toCents("0.29")).toBe(29);
    expect(toCents("39.83")).toBe(3983);
  });

  it("treats a missing or unreadable amount as unknown, never as zero", () => {
    expect(toCents(null)).toBeNull();
    expect(toCents(undefined)).toBeNull();
    expect(toCents("")).toBeNull();
    expect(toCents("abc")).toBeNull();
  });
});

describe("hasTakenPayment", () => {
  const pay = (status: string) => ({ status }) as Cart["payments"][number];

  it("sees money that has moved or is moving", () => {
    expect(hasTakenPayment({ payments: [pay("completed")] })).toBe(true);
    expect(hasTakenPayment({ payments: [pay("pending")] })).toBe(true);
    expect(hasTakenPayment({ payments: [pay("processing")] })).toBe(true);
  });

  it("ignores payments that took nothing", () => {
    // Store credit and gift cards sit in checkout until the order completes.
    expect(
      hasTakenPayment({
        payments: [pay("checkout"), pay("failed"), pay("void"), pay("invalid")],
      }),
    ).toBe(false);
    expect(hasTakenPayment({ payments: [] })).toBe(false);
    expect(hasTakenPayment({})).toBe(false);
  });
});

describe("checkPayPalStart", () => {
  it("refuses a cart that already holds a captured payment", () => {
    // A capture went through and completing the order failed. A second
    // PayPal order would charge the customer twice.
    expect(
      checkPayPalStart({
        ...ready,
        payments: [{ status: "completed" } as Cart["payments"][number]],
      }),
    ).toEqual({ ok: false, reason: "already_paid" });
  });

  it("lets PayPal open when only payment is left", () => {
    expect(checkPayPalStart(ready)).toEqual({ ok: true });
    expect(
      checkPayPalStart({
        ...ready,
        requirements: [
          { step: "payment", field: "payment", message: "Add a payment" },
        ],
      }),
    ).toEqual({ ok: true });
  });

  it("keeps PayPal shut with no address: the 6 Sep order", () => {
    // Pressed before anything above the payment box was filled in. PayPal
    // took the item price and the order could never complete.
    expect(
      checkPayPalStart({
        total: "5.25",
        amount_due: "5.25",
        requirements: [
          { step: "address", field: "ship_address", message: "Add an address" },
          { step: "delivery", field: "shipments", message: "Choose delivery" },
        ],
      }),
    ).toEqual({ ok: false, reason: "steps_missing" });
  });

  it("keeps PayPal shut with an address but no delivery chosen", () => {
    expect(
      checkPayPalStart({
        ...ready,
        requirements: [
          { step: "delivery", field: "shipments", message: "Choose delivery" },
        ],
      }),
    ).toEqual({ ok: false, reason: "steps_missing" });
  });

  it("refuses when a gift card or store credit lowers what is owed", () => {
    // PayPal's order is built from the full total, so it would charge the
    // customer again for what the credit already covers.
    expect(checkPayPalStart({ ...ready, amount_due: "31.18" })).toEqual({
      ok: false,
      reason: "credit_applied",
    });
  });

  it("refuses an order with no payable total", () => {
    expect(checkPayPalStart({ ...ready, total: null })).toEqual({
      ok: false,
      reason: "no_total",
    });
    expect(
      checkPayPalStart({ ...ready, total: "0.00", amount_due: "0.00" }),
    ).toEqual({ ok: false, reason: "no_total" });
  });

  it("falls back to the total when amount_due is not given", () => {
    expect(checkPayPalStart({ ...ready, amount_due: null })).toEqual({
      ok: true,
    });
  });
});

describe("checkPayPalCapture", () => {
  it("captures when the order still totals what PayPal was created for", () => {
    expect(checkPayPalCapture(ready, "51.18")).toEqual({ ok: true });
    expect(
      checkPayPalCapture(
        { ...ready, total: "84.4", amount_due: "84.4" },
        "84.40",
      ),
    ).toEqual({ ok: true });
  });

  it("refuses when delivery was added after PayPal opened: the 11 Oct order", () => {
    // PayPal was created for the items alone (39.83); the order then gained
    // its postage and totalled 51.18. The old flow captured 39.83.
    expect(checkPayPalCapture(ready, "39.83")).toEqual({
      ok: false,
      reason: "total_changed",
    });
  });

  it("refuses when a discount came off after PayPal opened: the 9 Sep order", () => {
    // PayPal was created for 100.13; a 20% code brought the order to 84.40.
    // The old flow captured 100.13.
    expect(
      checkPayPalCapture(
        { total: "84.40", amount_due: "84.40", requirements: [] },
        "100.13",
      ),
    ).toEqual({ ok: false, reason: "total_changed" });
  });

  it("refuses when a step went missing while the popup was open", () => {
    expect(
      checkPayPalCapture(
        {
          ...ready,
          requirements: [
            {
              step: "address",
              field: "ship_address",
              message: "Add an address",
            },
          ],
        },
        "51.18",
      ),
    ).toEqual({ ok: false, reason: "steps_missing" });
  });

  it("refuses when a gift card was applied while the popup was open", () => {
    expect(
      checkPayPalCapture({ ...ready, amount_due: "41.18" }, "51.18"),
    ).toEqual({ ok: false, reason: "credit_applied" });
  });
});
