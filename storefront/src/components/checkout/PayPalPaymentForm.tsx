"use client";

import { CircleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  isPayPalConfigured,
  paypalClientId,
} from "@/lib/utils/payment-gateway";

export interface PayPalPaymentFormHandle {
  confirmPayment: (returnUrl: string) => Promise<{ error?: string }>;
  fetchUpdates: () => Promise<void>;
}

interface PayPalPaymentFormProps {
  /** Remounts the buttons when the session behind them is replaced. */
  paypalOrderId: string;
  currency: string;
  onReady: (handle: PayPalPaymentFormHandle) => void;
  /**
   * Runs when the PayPal button is pressed, before the popup opens. False keeps
   * the popup shut: the same checks the "Pay now" button makes, which this
   * button used to skip (see lib/utils/paypal-guard.ts).
   */
  onClick: () => Promise<boolean>;
  /**
   * Creates the PayPal order the popup will show, at the moment of the click,
   * for the order total as it is then. Resolves to PayPal's order id.
   */
  createOrder: () => Promise<string>;
  /** Called when the customer approves in the popup, with PayPal's order id. */
  onApproved: (paypalOrderId: string) => void;
}

function PayPalPaymentFormInner({
  paypalOrderId,
  currency,
  onReady,
  onClick,
  createOrder,
  onApproved,
}: PayPalPaymentFormProps) {
  const t = useTranslations("checkout");
  const [error, setError] = useState<string | null>(null);
  const approvedRef = useRef(false);
  const [approvedForUI, setApprovedForUI] = useState(false);

  // For PayPal, confirmPayment is called by the checkout page's "Place Order"
  // button. If the user already approved via the popup, resolve immediately.
  // Otherwise return an error telling them to use the PayPal button.
  const confirmPayment = useCallback(
    async (_returnUrl: string): Promise<{ error?: string }> => {
      if (approvedRef.current) {
        return {};
      }
      return { error: t("paypalApproveFirst") };
    },
    [t],
  );

  const fetchUpdates = useCallback(async () => {}, []);

  // Lazy-load the PayPal SDK components
  const [PayPalSDK, setPayPalSDK] = useState<{
    PayPalScriptProvider: typeof import("@paypal/react-paypal-js")["PayPalScriptProvider"];
    PayPalButtons: typeof import("@paypal/react-paypal-js")["PayPalButtons"];
  } | null>(null);

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const confirmPaymentRef = useRef(confirmPayment);
  confirmPaymentRef.current = confirmPayment;
  const fetchUpdatesRef = useRef(fetchUpdates);
  fetchUpdatesRef.current = fetchUpdates;

  useEffect(() => {
    if (PayPalSDK) return;

    let cancelled = false;

    import("@paypal/react-paypal-js")
      .then((mod) => {
        if (cancelled) return;
        setPayPalSDK({
          PayPalScriptProvider: mod.PayPalScriptProvider,
          PayPalButtons: mod.PayPalButtons,
        });
        onReadyRef.current({
          confirmPayment: (...args) => confirmPaymentRef.current(...args),
          fetchUpdates: (...args) => fetchUpdatesRef.current(...args),
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load PayPal. Please refresh and try again.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [PayPalSDK]);

  // Stable refs for the callbacks, so PayPalButtons is not re-rendered (and
  // its iframe rebuilt) every time the parent renders.
  const onApprovedRef = useRef(onApproved);
  onApprovedRef.current = onApproved;
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;
  const createOrderRef = useRef(createOrder);
  createOrderRef.current = createOrder;

  if (!PayPalSDK) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
      </div>
    );
  }

  const { PayPalScriptProvider, PayPalButtons } = PayPalSDK;

  return (
    <div>
      <PayPalScriptProvider
        options={{
          clientId: paypalClientId,
          currency: currency.toUpperCase(),
          intent: "capture",
        }}
      >
        <PayPalButtons
          style={{
            shape: "rect",
            layout: "vertical",
            color: "gold",
            label: "paypal",
          }}
          onClick={async (_data, actions) => {
            setError(null);
            let allowed = false;
            try {
              allowed = await onClickRef.current();
            } catch {
              allowed = false;
            }
            return allowed ? actions.resolve() : actions.reject();
          }}
          createOrder={() => createOrderRef.current()}
          onApprove={async (data) => {
            approvedRef.current = true;
            setApprovedForUI(true);
            setError(null);
            // Trigger payment completion directly — no need for
            // the user to click "Place Order" again.
            onApprovedRef.current(data.orderID);
          }}
          onError={(err) => {
            const msg = err instanceof Error ? err.message : t("paypalError");
            setError(msg);
          }}
          onCancel={() => {
            setError(t("paypalCancelled"));
          }}
        />
      </PayPalScriptProvider>

      {approvedForUI && (
        <p className="text-sm text-green-600 mt-2 text-center">
          {t("paypalApproved")}
        </p>
      )}

      {error && (
        <Alert variant="destructive" className="mt-3">
          <CircleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export function PayPalPaymentForm(props: PayPalPaymentFormProps) {
  if (!isPayPalConfigured) {
    return null;
  }

  return <PayPalPaymentFormInner {...props} />;
}
