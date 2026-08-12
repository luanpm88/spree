"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { HiddenPricingProvider } from "@/contexts/HiddenPricingContext";
import { WholesaleHeader } from "./WholesaleHeader";

interface WholesalePendingBrowseProps {
  basePath: string;
  customerName: string;
  children: React.ReactNode;
}

/**
 * Signed in, not approved yet, browsing the catalogue.
 *
 * The client asked for exactly this: "Customer signs up and only sees a
 * wholesale price or a 0.00 price, we then check the details and we approve the
 * user and move the user to a Customer Group called Bulk Orders, then they see
 * the real price." So an applicant is not walled off while they wait. They can
 * see the range and decide whether it is worth waiting for, which is the point
 * of letting them in at all.
 *
 * The hard wall (WholesaleApplicationPending) still stands on ordering surfaces.
 * Browsing without prices is useful; a cart you cannot price is not.
 *
 * `signInHref` is required by the context but never used on this path, because
 * the prompt renders as text for `awaiting_approval`. It is filled with the
 * account page so that a future caller reading the value does not find an empty
 * string and send a signed-in customer to a sign-in form.
 */
export function WholesalePendingBrowse({
  basePath,
  customerName,
  children,
}: WholesalePendingBrowseProps) {
  const t = useTranslations("wholesale");
  const hiddenPricing = useMemo(
    () => ({
      signInHref: `${basePath}/account`,
      reason: "awaiting_approval" as const,
    }),
    [basePath],
  );

  return (
    <HiddenPricingProvider value={hiddenPricing}>
      <WholesaleHeader basePath={basePath} customerName={customerName} />
      {/* Said once, at the top, rather than repeated beside every price. The
          per-price prompt is deliberately two words; this is where the reader
          finds out what happens next and that nothing is required of them. */}
      <div className="border-b border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30">
        <div className="mx-auto max-w-7xl px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          <span className="font-medium">
            {t("hiddenPrice.awaitingApproval")}
          </span>
          {". "}
          {t("hiddenPrice.awaitingApprovalHint")}
        </div>
      </div>
      <main>{children}</main>
    </HiddenPricingProvider>
  );
}
