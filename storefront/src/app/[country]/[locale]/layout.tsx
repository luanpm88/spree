import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { Suspense } from "react";
import "../../globals.css";
import { CartDrawer } from "@/components/cart/CartDrawer";
import { DocumentShell } from "@/components/layout/DocumentShell";
import { JsonLd } from "@/components/seo/JsonLd";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/contexts/AuthContext";
import { CartProvider } from "@/contexts/CartContext";
import { StoreProvider } from "@/contexts/StoreContext";
import {
  DEFAULT_LOCALE,
  loadMessages,
  resolveSupportedLocale,
} from "@/i18n/locales";
import {
  findMarketForCountry,
  getDefaultMarketLocaleTarget,
  getMarketDefaultLocale,
  isLocaleEnabledForMarket,
} from "@/i18n/markets";
import {
  buildLocalizedRedirectPath,
  REQUEST_CLEAN_URLS_HEADER,
  REQUEST_PATHNAME_HEADER,
  REQUEST_SEARCH_HEADER,
} from "@/i18n/routing";
import { getMarkets } from "@/lib/data/markets";
import { generateStoreMetadata } from "@/lib/metadata/store";
import { buildOrganizationJsonLd } from "@/lib/seo";
import { getDefaultCountry, getDefaultLocale } from "@/lib/store";

interface CountryLocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{
    country: string;
    locale: string;
  }>;
}

async function redirectToLocalizedRoute(
  country: string,
  locale: string,
): Promise<never> {
  const requestHeaders = await headers();
  redirect(
    buildLocalizedRedirectPath({
      country,
      locale,
      pathname: requestHeaders.get(REQUEST_PATHNAME_HEADER),
      search: requestHeaders.get(REQUEST_SEARCH_HEADER),
      // Told by the middleware, never inferred. Without it this redirect drops
      // the page the visitor asked for and lands them on the market root, which
      // on a clean-URL shop is the home page.
      cleanUrls: requestHeaders.get(REQUEST_CLEAN_URLS_HEADER) === "1",
    }),
  );
}

/**
 * Root layouts with dynamic segments must provide their required build-time
 * params. Prebuild only the configured default route so every nested page is
 * not multiplied by the full Market list. Other valid routes render on demand.
 */
export function generateStaticParams() {
  return [
    {
      country: getDefaultCountry(),
      locale: resolveSupportedLocale(getDefaultLocale()) ?? DEFAULT_LOCALE,
    },
  ];
}

export async function generateMetadata({
  params,
}: CountryLocaleLayoutProps): Promise<Metadata> {
  const { locale } = await params;
  return generateStoreMetadata({ locale });
}

/**
 * Market resolution can read request headers when it needs to preserve the
 * current path during a fallback redirect. Keep the whole route decision
 * behind one boundary so Cache Components never prerender an unvalidated
 * Market context or treat that request data as a blocking route error.
 */
export default function CountryLocaleLayout(props: CountryLocaleLayoutProps) {
  return (
    <Suspense fallback={null}>
      <CountryLocaleLayoutContent {...props} />
    </Suspense>
  );
}

export async function CountryLocaleLayoutContent({
  children,
  params,
}: CountryLocaleLayoutProps) {
  const { country, locale } = await params;

  const requestedLocale = resolveSupportedLocale(locale);
  if (!requestedLocale) notFound();

  // Fetch Market configuration through a known-valid storefront context. The
  // requested country/locale pair has not been validated yet; forwarding it to
  // the Store API can fail before we get the Market data needed to redirect an
  // unsupported pair (for example /pl/pl when Poland's Market supports de).
  const marketLookupLocale =
    resolveSupportedLocale(getDefaultLocale()) ?? DEFAULT_LOCALE;
  const markets = await getMarkets({
    country: getDefaultCountry(),
    locale: marketLookupLocale,
  })
    .then((res) => res.data)
    .catch(() => null);

  const renderStorefront = async (
    availableMarkets: NonNullable<typeof markets>,
  ) => {
    const messages = await loadMessages(requestedLocale);

    return (
      <DocumentShell locale={requestedLocale}>
        <CountryLocaleProviders
          country={country}
          locale={requestedLocale}
          markets={availableMarkets}
          messages={messages}
        >
          {children}
        </CountryLocaleProviders>
      </DocumentShell>
    );
  };

  // Let route-level data handling surface an API outage instead of redirecting
  // the request back to itself. Static storefront locale validation still runs.
  if (markets === null) {
    return renderStorefront([]);
  }

  // Validate that the URL country belongs to an available market.
  // If not, redirect server-side to avoid SSR with wrong prices.
  let currentMarket = findMarketForCountry(markets, country);

  // A shop whose configured country is not one of its Market's countries.
  //
  // One of these shops sells to 34 countries and is not based in any of them,
  // so it is addressed by its own name rather than by an ISO pair, the same way
  // the others happen to be addressed by theirs. No Market lists that name, so
  // the lookup failed, the layout redirected at the default Market's first
  // country, and the page answered 307 to itself until the browser stopped.
  //
  // Narrow on purpose: this only applies when the segment is the country this
  // build was made for. Any other unknown country still redirects, because that
  // is a visitor asking for a market the shop does not serve.
  if (
    !currentMarket &&
    country.toLowerCase() === getDefaultCountry().toLowerCase()
  ) {
    currentMarket = markets.find((m) => m.default) ?? markets[0];
  }

  if (!currentMarket) {
    const defaultTarget = getDefaultMarketLocaleTarget(markets);
    const fallbackCountry = (
      defaultTarget?.country ?? getDefaultCountry()
    ).toLowerCase();
    const fallbackLocale =
      defaultTarget?.locale ??
      resolveSupportedLocale(getDefaultLocale()) ??
      DEFAULT_LOCALE;

    // A successful but unusable Markets response may only resolve to the route
    // already being handled. Render through the outage-safe path instead of
    // creating an infinite redirect loop.
    if (
      fallbackCountry === country.toLowerCase() &&
      fallbackLocale === requestedLocale
    ) {
      return renderStorefront([]);
    }

    return redirectToLocalizedRoute(fallbackCountry, fallbackLocale);
  }

  // A globally available bundle is not necessarily enabled for every Market.
  // Redirect to a renderable locale instead of letting an automatically
  // negotiated country/locale combination become a storefront 404.
  if (!isLocaleEnabledForMarket(currentMarket, requestedLocale)) {
    const fallbackLocale = getMarketDefaultLocale(currentMarket);
    if (!fallbackLocale) notFound();
    return redirectToLocalizedRoute(country, fallbackLocale);
  }

  return renderStorefront(markets);
}

interface CountryLocaleProvidersProps {
  children: React.ReactNode;
  country: string;
  locale: Locale;
  markets: Awaited<ReturnType<typeof getMarkets>>["data"];
  messages: IntlMessages;
}

function CountryLocaleProviders({
  children,
  country,
  locale,
  markets,
  messages,
}: CountryLocaleProvidersProps) {
  return (
    <NextIntlClientProvider messages={messages} locale={locale}>
      <StoreProvider
        initialCountry={country}
        initialLocale={locale}
        initialMarkets={markets}
      >
        <AuthProvider>
          <CartProvider>
            <JsonLd data={buildOrganizationJsonLd()} />
            {children}
            <CartDrawer />
            <Toaster />
          </CartProvider>
        </AuthProvider>
      </StoreProvider>
    </NextIntlClientProvider>
  );
}
