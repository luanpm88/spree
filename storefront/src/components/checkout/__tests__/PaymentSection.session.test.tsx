import type { Cart } from "@spree/sdk";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const mocks = vi.hoisted(() => ({
  createCheckoutPaymentSession: vi.fn(),
  updateCheckoutPaymentSession: vi.fn(),
  createDirectPayment: vi.fn(),
  getCreditCards: vi.fn(),
}));

vi.mock("@/lib/data/payment", () => ({
  createCheckoutPaymentSession: mocks.createCheckoutPaymentSession,
  updateCheckoutPaymentSession: mocks.updateCheckoutPaymentSession,
  createDirectPayment: mocks.createDirectPayment,
}));
vi.mock("@/lib/data/credit-cards", () => ({
  getCreditCards: mocks.getCreditCards,
}));

// The gateway forms pull in Stripe's and Adyen's browser SDKs. None of them is
// reached by these tests — the whole point is what happens BEFORE a form can
// exist — and loading them here would only add ways for this file to fail for
// reasons that are not about payment sessions.
vi.mock("@/components/checkout/StripePaymentForm", () => ({
  StripePaymentForm: () => null,
  confirmWithSavedCard: vi.fn(),
}));
vi.mock("@/components/checkout/AdyenPaymentForm", () => ({
  AdyenPaymentForm: () => null,
}));
vi.mock("@/components/checkout/PayPalPaymentForm", () => ({
  PayPalPaymentForm: () => null,
}));
vi.mock("@/components/checkout/AddressFormFields", () => ({
  AddressFormFields: () => null,
}));
vi.mock("react-svg-credit-card-payment-icons", () => ({
  PaymentIcon: () => null,
}));

import { PaymentSection } from "@/components/checkout/PaymentSection";

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];

  constructor(
    private callback: IntersectionObserverCallback,
    public options?: IntersectionObserverInit,
  ) {
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

function cartWith(sessionRequired: boolean): Cart {
  return {
    id: "cart_1",
    total: "51.20",
    amount_due: "51.20",
    currency: "NZD",
    shipping_address: null,
    billing_address: null,
    shipping_eq_billing_address: true,
    payment_methods: [
      {
        id: "pm_1",
        name: sessionRequired ? "Card Payments" : "Bank Transfer",
        type: sessionRequired
          ? "Spree::PaymentMethod::StripeCreditCard"
          : "Spree::PaymentMethod::Check",
        session_required: sessionRequired,
      },
    ],
  } as unknown as Cart;
}

function renderSection(cart: Cart) {
  return render(
    <PaymentSection
      cart={cart}
      countries={[]}
      isAuthenticated={false}
      fetchStates={async () => []}
      onUpdateBillingAddress={async () => true}
      onPaymentComplete={async () => {}}
      processing={false}
      setProcessing={() => {}}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createCheckoutPaymentSession.mockResolvedValue({
    success: true,
    session: {
      id: "ps_1",
      external_id: "pi_1",
      external_data: { client_secret: "cs_1" },
    },
  });
  mocks.getCreditCards.mockResolvedValue({ data: [] });
  FakeIntersectionObserver.instances = [];
  globalThis.IntersectionObserver =
    FakeIntersectionObserver as unknown as typeof IntersectionObserver;
});

/**
 * The wiring, as opposed to the hook.
 *
 * useReachedPaymentStep has its own tests and they pass whether or not anything
 * uses it. This file is the one that fails if the gate is removed from the init
 * effect, which is the single line standing between the shop owner's Stripe
 * dashboard and 549 rows again.
 */
describe("PaymentSection payment session timing", () => {
  it("asks Stripe for nothing when the checkout page merely opens", async () => {
    // The whole report, in one assertion: "every cart is making a connection
    // with Stripe". Mounting is not arriving.
    renderSection(cartWith(true));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.createCheckoutPaymentSession).not.toHaveBeenCalled();
  });

  it("creates exactly one session once the customer scrolls to it", async () => {
    // And the other half, which matters more: the customer who does arrive must
    // still get a card field. A gate that never opens is a shop that cannot sell.
    renderSection(cartWith(true));

    FakeIntersectionObserver.scrollIntoView();
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.createCheckoutPaymentSession).toHaveBeenCalledTimes(1);
    expect(mocks.createCheckoutPaymentSession).toHaveBeenCalledWith(
      "cart_1",
      "pm_1",
      expect.objectContaining({ return_url: expect.any(String) }),
    );
  });

  it("does not create a second session when the box is seen again", async () => {
    // Scrolling up to fix an address and back down must not mint another
    // intent. initRef guards this; the test is here because the guard now has
    // a second way to be re-entered that it did not have before.
    renderSection(cartWith(true));

    FakeIntersectionObserver.scrollIntoView();
    await act(async () => {
      await Promise.resolve();
    });
    FakeIntersectionObserver.scrollIntoView();
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.createCheckoutPaymentSession).toHaveBeenCalledTimes(1);
  });

  it("never touches a provider for a method that takes no session", async () => {
    // Bank transfer is what several of these shops actually run on. It has no
    // gateway at all, and arriving at the payment step must not invent one.
    renderSection(cartWith(false));

    FakeIntersectionObserver.scrollIntoView();
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.createCheckoutPaymentSession).not.toHaveBeenCalled();
  });
});
