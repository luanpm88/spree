import type { AddressParams, Cart } from "@spree/sdk";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { PaymentCompleteResult } from "@/components/checkout/PaymentSection";

/**
 * The PayPal button pays from its own popup and never passes through "Pay now",
 * so it skipped every check "Pay now" makes. Three live orders went wrong
 * (docs/DISCOVERIES.md §84): one paid with no address and could never complete,
 * one captured 39.83 on an order of 51.18 (postage added after PayPal opened),
 * one captured 100.13 on an order of 84.40 (a 20% code applied after).
 *
 * These tests drive the props PaymentSection hands the PayPal form, the same
 * three callbacks PayPal's own buttons call: onClick, createOrder, onApproved.
 */

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const mocks = vi.hoisted(() => ({
  createCheckoutPaymentSession: vi.fn(),
  updateCheckoutPaymentSession: vi.fn(),
  createDirectPayment: vi.fn(),
  getCreditCards: vi.fn(),
  getCheckoutOrder: vi.fn(),
  paypalProps: null as null | {
    paypalOrderId: string;
    onClick: () => Promise<boolean>;
    createOrder: () => Promise<string>;
    onApproved: (paypalOrderId: string) => void | Promise<void>;
  },
  paypalMounts: 0,
}));

vi.mock("@/lib/data/payment", () => ({
  createCheckoutPaymentSession: mocks.createCheckoutPaymentSession,
  updateCheckoutPaymentSession: mocks.updateCheckoutPaymentSession,
  createDirectPayment: mocks.createDirectPayment,
}));
vi.mock("@/lib/data/checkout", () => ({
  getCheckoutOrder: mocks.getCheckoutOrder,
}));
vi.mock("@/lib/data/credit-cards", () => ({
  getCreditCards: mocks.getCreditCards,
}));
vi.mock("@/components/checkout/StripePaymentForm", () => ({
  StripePaymentForm: () => null,
  confirmWithSavedCard: vi.fn(),
}));
vi.mock("@/components/checkout/AdyenPaymentForm", () => ({
  AdyenPaymentForm: () => null,
}));
vi.mock("@/components/checkout/PayPalPaymentForm", async () => {
  const { useEffect } = await import("react");
  return {
    PayPalPaymentForm: (props: NonNullable<typeof mocks.paypalProps>) => {
      mocks.paypalProps = props;
      useEffect(() => {
        mocks.paypalMounts += 1;
      }, []);
      return null;
    },
  };
});
vi.mock("@/components/checkout/AddressFormFields", () => ({
  AddressFormFields: () => null,
}));
vi.mock("react-svg-credit-card-payment-icons", () => ({
  PaymentIcon: () => null,
}));

import { PaymentSection } from "@/components/checkout/PaymentSection";

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  constructor(private callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  static scrollIntoView() {
    for (const instance of FakeIntersectionObserver.instances) {
      act(() => {
        instance.callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          instance as unknown as IntersectionObserver,
        );
      });
    }
  }
}

const SETTLE_WAIT = 900;
async function arriveAtPayment() {
  FakeIntersectionObserver.scrollIntoView();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, SETTLE_WAIT));
  });
}

const paypalCart = {
  id: "cart_1",
  total: "39.83",
  amount_due: "39.83",
  currency: "AUD",
  shipping_address: null,
  billing_address: null,
  shipping_eq_billing_address: true,
  payment_methods: [
    {
      id: "pm_pp",
      name: "PayPal",
      type: "SpreePaypalCheckout::Gateway",
      session_required: true,
    },
  ],
} as unknown as Cart;

/** The order as getCheckoutOrder reads it back from Spree. */
function order(total: string, requirements: Cart["requirements"] = []): Cart {
  return {
    ...paypalCart,
    total,
    amount_due: total,
    requirements,
  } as Cart;
}

function session(id: string, paypalOrderId: string, amount: string) {
  return {
    success: true,
    session: {
      id,
      external_id: paypalOrderId,
      external_data: { id: paypalOrderId, status: "CREATED" },
      amount,
    },
  };
}

type BillingUpdate = (data: {
  billing_address?: AddressParams;
  use_shipping?: boolean;
}) => Promise<boolean>;
let onPaymentComplete: Mock<(result: PaymentCompleteResult) => Promise<void>>;
let onValidateBeforePayment: Mock<() => Promise<boolean>>;
let onUpdateBillingAddress: Mock<BillingUpdate>;

async function renderAtPayPal() {
  render(
    <PaymentSection
      cart={paypalCart}
      countries={[]}
      isAuthenticated={false}
      fetchStates={async () => []}
      onUpdateBillingAddress={onUpdateBillingAddress}
      onPaymentComplete={onPaymentComplete}
      onValidateBeforePayment={onValidateBeforePayment}
      processing={false}
      setProcessing={() => {}}
    />,
  );
  await arriveAtPayment();
  // The session made on arrival only draws the buttons.
  expect(mocks.paypalProps?.paypalOrderId).toBe("PP_ON_ARRIVAL");
  mocks.createCheckoutPaymentSession.mockClear();
}

const paypal = () => {
  if (!mocks.paypalProps) throw new Error("PayPal form never rendered");
  return mocks.paypalProps;
};

beforeEach(() => {
  Element.prototype.getBoundingClientRect = () =>
    ({
      top: 100,
      bottom: 900,
      left: 0,
      right: 0,
      width: 0,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;

  vi.clearAllMocks();
  mocks.paypalProps = null;
  mocks.paypalMounts = 0;
  // Created on arrival, when the customer had chosen nothing yet: items only.
  mocks.createCheckoutPaymentSession.mockResolvedValue(
    session("ps_arrival", "PP_ON_ARRIVAL", "39.83"),
  );
  mocks.getCreditCards.mockResolvedValue({ data: [] });
  onPaymentComplete = vi
    .fn<(result: PaymentCompleteResult) => Promise<void>>()
    .mockResolvedValue(undefined);
  onValidateBeforePayment = vi
    .fn<() => Promise<boolean>>()
    .mockResolvedValue(true);
  onUpdateBillingAddress = vi.fn<BillingUpdate>().mockResolvedValue(true);
  FakeIntersectionObserver.instances = [];
  globalThis.IntersectionObserver =
    FakeIntersectionObserver as unknown as typeof IntersectionObserver;
});

describe("PayPal button: the click", () => {
  it("keeps the popup shut when the checkout is not ready to pay", async () => {
    await renderAtPayPal();
    onValidateBeforePayment.mockResolvedValue(false);

    const allowed = await paypal().onClick();

    expect(allowed).toBe(false);
    expect(onValidateBeforePayment).toHaveBeenCalledTimes(1);
  });

  it("lets the popup open when the checkout is ready", async () => {
    await renderAtPayPal();

    await expect(paypal().onClick()).resolves.toBe(true);
  });
});

describe("PayPal button: the order PayPal shows", () => {
  it("is created at the click, for the total as it is then", async () => {
    await renderAtPayPal();
    // The customer has since chosen delivery: 39.83 became 51.18.
    mocks.getCheckoutOrder.mockResolvedValue(order("51.18"));
    mocks.createCheckoutPaymentSession.mockResolvedValue(
      session("ps_click", "PP_AT_CLICK", "51.18"),
    );

    const paypalOrderId = await paypal().createOrder();

    // Not the stale order made on arrival, which still says 39.83.
    expect(paypalOrderId).toBe("PP_AT_CLICK");
    expect(mocks.createCheckoutPaymentSession).toHaveBeenCalledTimes(1);
    expect(mocks.createCheckoutPaymentSession).toHaveBeenCalledWith(
      "cart_1",
      "pm_pp",
      expect.objectContaining({ return_url: expect.any(String) }),
    );
  });

  it("is never created while address or delivery is missing", async () => {
    await renderAtPayPal();
    mocks.getCheckoutOrder.mockResolvedValue(
      order("5.25", [
        { step: "address", field: "ship_address", message: "Add an address" },
      ]),
    );

    await expect(paypal().createOrder()).rejects.toThrow("paypalStepsMissing");
    expect(mocks.createCheckoutPaymentSession).not.toHaveBeenCalled();
  });

  it("is refused when a gift card lowers what is owed", async () => {
    await renderAtPayPal();
    mocks.getCheckoutOrder.mockResolvedValue({
      ...order("51.18"),
      amount_due: "21.18",
    });

    await expect(paypal().createOrder()).rejects.toThrow("paypalCreditApplied");
    expect(mocks.createCheckoutPaymentSession).not.toHaveBeenCalled();
  });

  it("is refused when the session and the order disagree on the amount", async () => {
    await renderAtPayPal();
    mocks.getCheckoutOrder.mockResolvedValue(order("51.18"));
    mocks.createCheckoutPaymentSession.mockResolvedValue(
      session("ps_click", "PP_AT_CLICK", "39.83"),
    );

    await expect(paypal().createOrder()).rejects.toThrow("paypalTotalChanged");
  });
});

describe("PayPal button: the capture", () => {
  async function approvedAt(totalAtClick: string) {
    await renderAtPayPal();
    mocks.getCheckoutOrder.mockResolvedValue(order(totalAtClick));
    mocks.createCheckoutPaymentSession.mockResolvedValue(
      session("ps_click", "PP_AT_CLICK", totalAtClick),
    );
    await paypal().createOrder();
  }

  it("captures when the order still totals what PayPal was created for", async () => {
    await approvedAt("51.18");
    mocks.getCheckoutOrder.mockResolvedValue(order("51.18"));

    await act(async () => {
      await paypal().onApproved("PP_AT_CLICK");
    });

    expect(onUpdateBillingAddress).toHaveBeenCalledWith({ use_shipping: true });
    expect(onPaymentComplete).toHaveBeenCalledTimes(1);
    expect(onPaymentComplete).toHaveBeenCalledWith({
      type: "session",
      sessionId: "ps_click",
    });
  });

  it("does not capture when a discount came off after PayPal opened", async () => {
    // The 9 Sep order: PayPal at 100.13, the order at 84.40 by approval.
    await approvedAt("100.13");
    mocks.getCheckoutOrder.mockResolvedValue(order("84.40"));
    const mountsBefore = mocks.paypalMounts;

    await act(async () => {
      await paypal().onApproved("PP_AT_CLICK");
    });

    expect(onPaymentComplete).not.toHaveBeenCalled();
    // The approved PayPal order is spent; the buttons start over.
    expect(mocks.paypalMounts).toBe(mountsBefore + 1);
  });

  it("does not capture when a step went missing while the popup was open", async () => {
    await approvedAt("51.18");
    mocks.getCheckoutOrder.mockResolvedValue(
      order("51.18", [
        { step: "delivery", field: "shipments", message: "Choose delivery" },
      ]),
    );

    await act(async () => {
      await paypal().onApproved("PP_AT_CLICK");
    });

    expect(onPaymentComplete).not.toHaveBeenCalled();
    // And it points at the missing section, the way "Pay now" does.
    expect(onValidateBeforePayment).toHaveBeenCalled();
  });

  it("does not capture a PayPal order it did not create at a click", async () => {
    // The stale order drawn on arrival, or anything else, is never captured.
    await approvedAt("51.18");

    await act(async () => {
      await paypal().onApproved("PP_ON_ARRIVAL");
    });

    expect(onPaymentComplete).not.toHaveBeenCalled();
  });

  it("never starts a second PayPal payment once a capture was asked for", async () => {
    // Completing the order can fail after PayPal has captured (stock ran out,
    // or the gem's bookkeeping raised after the capture). onPaymentComplete
    // reports that on the page and returns normally, and the page stays. The
    // next click must not open PayPal again: a fresh PayPal order would be a
    // second charge. Found by an independent review of this change.
    await approvedAt("51.18");
    mocks.getCheckoutOrder.mockResolvedValue(order("51.18"));
    await act(async () => {
      await paypal().onApproved("PP_AT_CLICK");
    });
    expect(onPaymentComplete).toHaveBeenCalledTimes(1);
    onValidateBeforePayment.mockClear();

    await expect(paypal().onClick()).resolves.toBe(false);
    expect(onValidateBeforePayment).not.toHaveBeenCalled();
  });

  it("refuses to create a PayPal order for a cart that already holds a payment", async () => {
    // The same case after a reload, when the lock above is gone.
    await renderAtPayPal();
    mocks.getCheckoutOrder.mockResolvedValue({
      ...order("51.18"),
      payments: [{ status: "completed" }],
    } as unknown as Cart);

    await expect(paypal().createOrder()).rejects.toThrow(
      "paymentAlreadyReceived",
    );
    expect(mocks.createCheckoutPaymentSession).not.toHaveBeenCalled();
  });

  it("lets the customer try again after a refusal, since nothing was captured", async () => {
    await approvedAt("100.13");
    mocks.getCheckoutOrder.mockResolvedValue(order("84.40"));
    await act(async () => {
      await paypal().onApproved("PP_AT_CLICK");
    });
    expect(onPaymentComplete).not.toHaveBeenCalled();

    await expect(paypal().onClick()).resolves.toBe(true);
  });

  it("lets the customer try again when something fails before the capture", async () => {
    await approvedAt("51.18");
    onUpdateBillingAddress.mockRejectedValue(new Error("network"));
    await act(async () => {
      await paypal().onApproved("PP_AT_CLICK");
    });
    expect(onPaymentComplete).not.toHaveBeenCalled();

    await expect(paypal().onClick()).resolves.toBe(true);
  });

  it("captures one PayPal order once", async () => {
    await approvedAt("51.18");
    mocks.getCheckoutOrder.mockResolvedValue(order("51.18"));

    await act(async () => {
      await paypal().onApproved("PP_AT_CLICK");
    });
    await act(async () => {
      await paypal().onApproved("PP_AT_CLICK");
    });

    expect(onPaymentComplete).toHaveBeenCalledTimes(1);
  });

  it("does not capture when the billing address cannot be saved", async () => {
    await approvedAt("51.18");
    onUpdateBillingAddress.mockResolvedValue(false);

    await act(async () => {
      await paypal().onApproved("PP_AT_CLICK");
    });

    expect(onPaymentComplete).not.toHaveBeenCalled();
  });
});
