import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The last link: PaymentSection's answers have to reach PayPal's own buttons.
 * A false from onClick must become actions.reject(), or the popup opens
 * anyway, which is exactly how a customer paid with no address on 6 Sep
 * (docs/DISCOVERIES.md §84). PayPal's SDK is replaced by a stand-in that keeps
 * the props it was given, so the callbacks can be driven the way PayPal does.
 */

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/lib/utils/payment-gateway", () => ({
  isPayPalConfigured: true,
  paypalClientId: "test-client-id",
}));

type ButtonProps = {
  onClick: (
    data: Record<string, unknown>,
    actions: { resolve: () => Promise<void>; reject: () => Promise<void> },
  ) => Promise<void> | void;
  createOrder: () => Promise<string>;
  onApprove: (data: { orderID: string }) => Promise<void>;
};
const sdk = vi.hoisted(() => ({ buttons: null as null | ButtonProps }));

vi.mock("@paypal/react-paypal-js", () => ({
  PayPalScriptProvider: ({ children }: { children: React.ReactNode }) =>
    children,
  PayPalButtons: (props: ButtonProps) => {
    sdk.buttons = props;
    return null;
  },
}));

import { PayPalPaymentForm } from "@/components/checkout/PayPalPaymentForm";

async function mount(
  over: Partial<Parameters<typeof PayPalPaymentForm>[0]> = {},
) {
  const props = {
    paypalOrderId: "PP_ON_ARRIVAL",
    currency: "aud",
    onReady: vi.fn(),
    onClick: vi.fn().mockResolvedValue(true),
    createOrder: vi.fn().mockResolvedValue("PP_AT_CLICK"),
    onApproved: vi.fn(),
    ...over,
  };
  render(<PayPalPaymentForm {...props} />);
  await waitFor(() => expect(sdk.buttons).not.toBeNull());
  return props;
}

function actions() {
  return {
    resolve: vi.fn().mockResolvedValue(undefined),
    reject: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  sdk.buttons = null;
});

describe("PayPalPaymentForm hands PayPal the checkout's answers", () => {
  it("keeps the popup shut when the checkout says no", async () => {
    await mount({ onClick: vi.fn().mockResolvedValue(false) });
    const a = actions();

    await act(async () => {
      await sdk.buttons?.onClick({}, a);
    });

    expect(a.reject).toHaveBeenCalledTimes(1);
    expect(a.resolve).not.toHaveBeenCalled();
  });

  it("opens the popup when the checkout says yes", async () => {
    await mount();
    const a = actions();

    await act(async () => {
      await sdk.buttons?.onClick({}, a);
    });

    expect(a.resolve).toHaveBeenCalledTimes(1);
    expect(a.reject).not.toHaveBeenCalled();
  });

  it("keeps the popup shut when the check itself fails", async () => {
    await mount({ onClick: vi.fn().mockRejectedValue(new Error("network")) });
    const a = actions();

    await act(async () => {
      await sdk.buttons?.onClick({}, a);
    });

    expect(a.reject).toHaveBeenCalledTimes(1);
  });

  it("asks the checkout for the PayPal order, never reuses the one it was drawn with", async () => {
    const props = await mount();

    const id = await sdk.buttons?.createOrder();

    expect(props.createOrder).toHaveBeenCalledTimes(1);
    expect(id).toBe("PP_AT_CLICK");
  });

  it("reports which PayPal order was approved", async () => {
    const props = await mount();

    await act(async () => {
      await sdk.buttons?.onApprove({ orderID: "PP_AT_CLICK" });
    });

    expect(props.onApproved).toHaveBeenCalledWith("PP_AT_CLICK");
  });
});
