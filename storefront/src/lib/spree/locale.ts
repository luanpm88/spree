import { cookies } from "next/headers";
import { getConfig } from "./config";

const DEFAULT_COUNTRY_COOKIE = "spree_country";
const DEFAULT_LOCALE_COOKIE = "spree_locale";

/**
 * The locale the API is asked in, which is not always the locale in the URL.
 *
 * ── the fault this exists for ───────────────────────────────────────────────
 *
 * He reported search returning nothing on three shops. Two of them were real
 * and had this cause. Measured on his live AU shop, the same query with one
 * header changed:
 *
 *   no locale header        count=65
 *   x-spree-locale: en      count=0
 *   x-spree-locale: en-AU   count=65
 *
 * and on a shop where search worked, all three said 56.
 *
 * The two shops that failed have a default_locale of en-AU and en-NZ. Their
 * products carry translations for that locale and none for plain `en`. The
 * storefront was sending `en`, because that is the locale segment in the URL,
 * so Spree searched a set of translations that does not exist and correctly
 * returned nothing.
 *
 * Nothing else looked wrong, which is why this took so long to find. Browsing
 * works, because a product listing falls back to the base columns. The API is
 * right, the data is right, the query is right, and the one header that was
 * wrong is not in the query string, so six measurements of the request all came
 * back correct.
 *
 * ── why the URL is not changed instead ─────────────────────────────────────
 *
 * The obvious alternative is to put en-AU in the URL. His addresses are
 * /au/en/... today, they are in his footer, in search results and in the
 * llms.txt he wrote, and moving every one of them to fix a search header would
 * be a far larger change than the fault. The URL locale stays as it is and
 * drives the interface; this drives the API.
 *
 * Read at request time from the environment rather than baked in at build time,
 * so a shop can be corrected by setting the variable and recreating the
 * container instead of rebuilding the image. Unset, which is six of the seven
 * shops, nothing changes at all.
 */
function apiLocale(urlLocale: string | undefined): string | undefined {
  return process.env.SPREE_API_LOCALE?.trim() || urlLocale;
}

/**
 * Read locale/country from cookies (set by middleware).
 * Falls back to config defaults.
 */
export async function getLocaleOptions(): Promise<{
  locale?: string;
  country?: string;
}> {
  const config = getConfig();

  try {
    const cookieStore = await cookies();

    const country = cookieStore.get(
      config.countryCookieName ?? DEFAULT_COUNTRY_COOKIE,
    )?.value;
    const locale = cookieStore.get(
      config.localeCookieName ?? DEFAULT_LOCALE_COOKIE,
    )?.value;

    return {
      locale: apiLocale(locale || config.defaultLocale),
      country: country || config.defaultCountry,
    };
  } catch {
    // During prerendering, cookies() rejects — fall back to config defaults
    return {
      locale: apiLocale(config.defaultLocale),
      country: config.defaultCountry,
    };
  }
}
