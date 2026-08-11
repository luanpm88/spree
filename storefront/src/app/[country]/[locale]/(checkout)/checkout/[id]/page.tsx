import type { Address, Cart, Country } from "@spree/sdk";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getAddresses } from "@/lib/data/addresses";
import { getCheckoutOrder } from "@/lib/data/checkout";
import { isAuthenticated as checkAuth } from "@/lib/data/cookies";
import { getCountry } from "@/lib/data/countries";
import { getMarketCountries, resolveMarket } from "@/lib/data/markets";

import { CheckoutPageContent } from "./CheckoutPageContent";

export interface CheckoutInitialData {
  cart: Cart;
  countries: Country[];
  savedAddresses: Address[];
  isAuthenticated: boolean;
}

interface CheckoutPageProps {
  params: Promise<{
    id: string;
    country: string;
    locale: string;
  }>;
  // The order token, when the visitor arrived from an emailed payment link. Spree's
  // payment_link_email appends it because the recipient's browser has never held
  // this cart's cookie. account/reset-password already reads a token the same way.
  searchParams?: Promise<{ token?: string }>;
}

async function CheckoutDataLoader({ params, searchParams }: CheckoutPageProps) {
  await connection();

  const { id: cartId, country: urlCountry } = await params;
  const { token: orderToken } = (await searchParams) ?? {};

  // Check auth first so we can skip address fetch for guests
  const authStatus = await checkAuth();

  // Fetch initial data in parallel during SSR
  const [cartData, market, addressesData] = await Promise.all([
    getCheckoutOrder(cartId, orderToken),
    resolveMarket(urlCountry).catch(() => null),
    authStatus ? getAddresses() : Promise.resolve({ data: [] as Address[] }),
  ]);

  // Redirect to order-placed if already complete
  if (cartData?.current_step === "complete") {
    const basePath = `/${urlCountry}/en`;
    redirect(`${basePath}/order-placed/${cartId}`);
  }

  const countriesData = market
    ? await getMarketCountries(market.id).catch(() => ({
        data: [] as Country[],
      }))
    : { data: [] as Country[] };

  // Prefetch states for the default country (warms the server cache)
  const defaultIso =
    cartData?.shipping_address?.country_iso ?? countriesData.data[0]?.iso;
  if (defaultIso) {
    getCountry(defaultIso).catch(() => {});
  }

  const initialData: CheckoutInitialData | null = cartData
    ? {
        cart: cartData,
        countries: countriesData.data,
        savedAddresses: addressesData.data,
        isAuthenticated: authStatus,
      }
    : null;

  return (
    <CheckoutPageContent
      cartId={cartId}
      urlCountry={urlCountry}
      initialData={initialData}
    />
  );
}

export default function CheckoutPage({
  params,
  searchParams,
}: CheckoutPageProps) {
  return (
    <Suspense>
      <CheckoutDataLoader params={params} searchParams={searchParams} />
    </Suspense>
  );
}
