"use client";

import { Clock, Lock } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useHiddenPricing } from "@/contexts/HiddenPricingContext";
import { cn } from "@/lib/utils";

/**
 * Rendered in place of a price when the viewer is not entitled to see it.
 *
 * Two readers reach this, and telling them apart is the whole point. A guest can
 * fix their situation by signing in, so they get a link. Somebody signed in and
 * waiting on approval cannot fix anything by clicking, and offering them a
 * sign-in link reads as though the site has forgotten who they are. They get
 * plain text saying what the shop is doing about it.
 *
 * Renders nothing outside a HiddenPricingProvider, so on the DTC storefront a
 * genuinely absent price stays silent.
 */
export function HiddenPricePrompt({ className }: { className?: string }) {
  const hiddenPricing = useHiddenPricing();
  const t = useTranslations("wholesale");

  if (!hiddenPricing) return null;

  const base =
    "inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4";

  if (hiddenPricing.reason === "awaiting_approval") {
    return (
      <span
        className={cn(
          "relative z-10",
          className ?? cn(base, "text-amber-700 dark:text-amber-500"),
        )}
      >
        <Clock className="h-3.5 w-3.5" />
        {t("hiddenPrice.awaitingApproval")}
      </span>
    );
  }

  return (
    <Link
      href={hiddenPricing.signInHref}
      className={cn(
        // Keeps the prompt clickable when a host card covers itself with a
        // stretched-link overlay (ProductCard).
        "relative z-10",
        className ?? cn(base, "text-slate-600 underline hover:text-slate-900"),
      )}
    >
      <Lock className="h-3.5 w-3.5" />
      {t("hiddenPrice.signInForPricing")}
    </Link>
  );
}
