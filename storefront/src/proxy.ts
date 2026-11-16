import type { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_LOCALE,
  resolveSupportedLocale,
  SUPPORTED_LOCALES,
} from "@/i18n/locales";
import { getClient } from "@/lib/spree/config";
import { createGoneProductCheck } from "@/lib/spree/gone-products";
import { createMarketsSnapshot } from "@/lib/spree/markets-snapshot";
import { createSpreeMiddleware } from "@/lib/spree/middleware";
import {
  cleanUrlsEnabled,
  getDefaultCountry,
  getDefaultLocale,
  getPublicPaths,
  isAccountRequired,
} from "@/lib/store";

// Asked the same way the layout asks, so both see the same list.
const markets = createMarketsSnapshot(() =>
  getClient()
    .markets.list({
      country: getDefaultCountry(),
      locale: resolveSupportedLocale(getDefaultLocale()) ?? DEFAULT_LOCALE,
    })
    .then((res) => res.data),
);

const localeMiddleware = createSpreeMiddleware({
  defaultCountry: getDefaultCountry(),
  defaultLocale: getDefaultLocale(),
  supportedLocales: SUPPORTED_LOCALES,
  requireAccount: isAccountRequired(),
  publicPaths: getPublicPaths(),
  cleanUrls: cleanUrlsEnabled(),
  markets,
});

// A deleted product answers 404 instead of 200 + noindex. See gone-products.ts.
// Off on a shop that requires an account: a crawler only reaches its sign-in.
const goneProduct = createGoneProductCheck({ enabled: !isAccountRequired() });

export async function proxy(request: NextRequest): Promise<NextResponse> {
  return goneProduct(request, localeMiddleware(request));
}

/**
 * What the middleware never sees.
 *
 * This used to end with `.*\..*$`, which excluded every address containing a
 * dot anywhere. On an open shop that is a reasonable shorthand for "a file in
 * /public". On a closed one it is a hole, and a wide one:
 *
 *   /b2b/en/products/1.5l-drum      a product slug with a dot in it
 *   /b2b/en/c/bottles-1.5l          a category permalink with one
 *   /sitemap.xml, /robots.txt       the two files that list every address
 *
 * Measured against the old pattern rather than reasoned about: all six came
 * back excluded, so all six rendered to anyone with the link, on a shop whose
 * whole requirement is that they do not.
 *
 * So only the three prefixes that genuinely must not reach it are named. Real
 * static files still skip the gate, but that decision now happens inside the
 * middleware where it can be made differently for a shop that is closed.
 */
export const config = {
  matcher: ["/((?!api/|_next/static|_next/image).*)"],
};
