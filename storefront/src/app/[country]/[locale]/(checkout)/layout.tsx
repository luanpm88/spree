"use client";

import { ArrowLeft, ChevronDown, ShoppingBag } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  CheckoutProvider,
  CheckoutSummary,
  useCheckout,
} from "@/contexts/CheckoutContext";
import { shopBrand } from "@/lib/blocks/brand";
import { getPolicies } from "@/lib/data/policies";
import { getStoreName } from "@/lib/store";
import { extractBasePath } from "@/lib/utils/path";

const storeName = getStoreName();
// Read at module scope, like storeName above. Both come from build-time
// environment, so there is nothing per-request about either.
const logoUrl = process.env.NEXT_PUBLIC_LOGO_URL || shopBrand().logo || "";

function CheckoutHeader() {
  const pathname = usePathname();
  const basePath = extractBasePath(pathname);
  const t = useTranslations("checkoutLayout");

  return (
    <header className="flex items-center justify-between h-16">
      {/* The shop's own mark, the same source the site header uses.

          This was hardcoded to /spree.png, the FRAMEWORK's logo, so every shop
          built from this storefront wore Spree's mark on its checkout. The site
          header was converted months ago and this one was missed, which is why
          it survived: nothing walks the checkout, because reaching it needs a
          signed-in account and a cart.

          He found it and reported it as "Logo at the top is not showing", and
          not showing is exactly right: measured on the wholesale shop, that
          request answered 400 with naturalWidth 0, so the page rendered the alt
          text where the logo belongs. Two of them, header and footer.

          Falls back to the shop's name as text rather than to somebody else's
          logo, which is never wrong. */}
      <Link href={basePath || "/"} className="flex items-center space-x-2">
        {logoUrl ? (
          <Image
            src={logoUrl}
            alt={storeName}
            width={240}
            height={38}
            className="h-8 w-auto max-w-[190px] object-contain"
            fetchPriority="high"
            loading="eager"
          />
        ) : (
          <span className="text-lg font-bold tracking-tight truncate">
            {storeName}
          </span>
        )}
      </Link>
      <Link
        href={basePath || "/"}
        className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
        aria-label={t("backToStore")}
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        {t("backToStore")}
      </Link>
    </header>
  );
}

function CheckoutFooter() {
  const pathname = usePathname();
  const basePath = extractBasePath(pathname);
  const t = useTranslations("checkoutLayout");

  // Fetched rather than listed in the code. The list that used to be here named
  // two policies the client's store does not have, so this footer carried two
  // links to a page that said it did not exist. Slugs are store data and the shop
  // owner can rename them in the admin at any time.
  //
  // An effect because this whole module is a client component and the getter is a
  // server action. Synchronising with the network is what effects are still for.
  // The links appearing a moment after the rest of the footer is the right trade
  // against restructuring the checkout shell.
  const [policies, setPolicies] = useState<{ slug: string; name: string }[]>(
    [],
  );
  useEffect(() => {
    let live = true;
    getPolicies()
      .then((list) => {
        if (live) setPolicies(list);
      })
      .catch(() => {
        // A checkout that fails because its footer could not list policies would
        // be a worse outcome than a checkout with no policy links.
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <footer className="py-4 text-xs text-gray-500 border-t border-gray-200 mt-auto flex flex-wrap items-center gap-x-3 gap-y-1">
      <p>
        {t("allRightsReserved", { year: new Date().getFullYear(), storeName })}
      </p>
      {policies.map((policy) => (
        <Link
          key={policy.slug}
          href={`${basePath}/policies/${policy.slug}`}
          target="_blank"
          className="text-gray-500 underline hover:text-gray-700"
        >
          {policy.name}
        </Link>
      ))}
    </footer>
  );
}

function MobileSummaryToggle() {
  const [isOpen, setIsOpen] = useState(false);
  const t = useTranslations("checkoutLayout");
  const { summaryContent } = useCheckout();

  // Hide the toggle entirely when there's no summary to show (e.g. the
  // order-placed page clears summaryContent because the page already
  // displays the order details inline).
  if (summaryContent === null) return null;

  return (
    <div className="lg:hidden border-b border-gray-200 bg-gray-50">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-5 py-4 flex items-center justify-between text-left"
        aria-expanded={isOpen}
        aria-controls="checkout-summary-panel"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
          <ShoppingBag className="w-5 h-5 text-gray-600" />
          {isOpen ? t("hideOrderSummary") : t("showOrderSummary")}
        </span>
        <ChevronDown
          className={`w-5 h-5 text-gray-500 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      {isOpen && (
        <div id="checkout-summary-panel" className="px-5 pb-4">
          <CheckoutSummary />
        </div>
      )}
    </div>
  );
}

interface CheckoutLayoutProps {
  children: React.ReactNode;
}

function CheckoutLayoutContent({ children }: CheckoutLayoutProps) {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Mobile header */}
      <div className="lg:hidden border-b border-gray-200">
        <div className="px-5">
          <CheckoutHeader />
        </div>
      </div>

      {/* Mobile summary toggle */}
      <MobileSummaryToggle />

      {/* Main checkout grid — Shopify proportions */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_minmax(0,640px)_minmax(0,440px)_1fr]">
        {/* Main content area — white bg */}
        <div className="lg:col-start-2 flex flex-col">
          <div className="flex-1 px-5 py-6 lg:pl-10 lg:pr-12 lg:py-10">
            {/* Desktop header */}
            <div className="hidden lg:block mb-8">
              <CheckoutHeader />
            </div>
            {children}
          </div>
          <div className="px-5 lg:pl-10 lg:pr-12 pb-4">
            <CheckoutFooter />
          </div>
        </div>

        {/* Desktop summary sidebar — Shopify: light gray bg with left border */}
        <div className="hidden lg:block lg:col-start-3 border-l border-gray-200 bg-gray-50">
          <div className="sticky top-0 px-10 py-10">
            <CheckoutSummary />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CheckoutLayout({ children }: CheckoutLayoutProps) {
  return (
    <CheckoutProvider>
      <CheckoutLayoutContent>{children}</CheckoutLayoutContent>
    </CheckoutProvider>
  );
}
