import type { MetadataRoute } from "next";
import { DEFAULT_LOCALE, resolveSupportedLocale } from "@/i18n/locales";
import {
  getMarketLocaleTargets,
  type MarketLocaleTarget,
} from "@/i18n/markets";
import { pageSlugs } from "@/lib/blocks/pages";
import { getPolicies } from "@/lib/data/policies";
import {
  getSitemapCategoryPage,
  getSitemapMarkets,
  getSitemapProductPage,
  getSitemapResourceCount,
  type SitemapCategory,
  type SitemapProduct,
} from "@/lib/data/sitemap";
import { sitemapSafeUrl } from "@/lib/data/sitemapUrl";
import {
  cleanUrlsEnabled,
  getDefaultCountry,
  getDefaultLocale,
  getStoreUrl,
  isAccountRequired,
} from "@/lib/store";

export const dynamic = "force-dynamic";

type CountryLocale = MarketLocaleTarget;

interface LocaleOptions {
  locale: string;
  country: string;
}

interface LocaleCatalog extends LocaleOptions {
  marketId: string;
  productCount: number;
  categoryCount: number;
}

interface PageCaches {
  products: Map<string, Promise<SitemapProduct[]>>;
  categories: Map<string, Promise<SitemapCategory[]>>;
}

/**
 * Google permits 50,000 URLs, but 10,000 keeps each request below roughly 100
 * Store API pages and avoids long-running sitemap responses on large catalogs.
 */
const URLS_PER_SITEMAP = 10_000;
/**
 * The addresses that are not a product and not a category.
 *
 * Was a hardcoded 3, listing the home page, /products and /c. Two problems with
 * that, both found by fetching every address the sitemap advertises:
 *
 *   /c answered 404. There is no categories index page in this storefront, so the
 *   sitemap was telling search engines to go and look at nothing.
 *
 *   The content pages and the policies were missing entirely. A shop's About and
 *   FAQ are the pages a person searches for by name, and they were the only ones
 *   with no route into them.
 *
 * Computed rather than counted by hand, because the page set differs per shop:
 * one country has a Buy Local page and another does not, so any fixed number is
 * wrong for at least one of them. The count feeds the chunk arithmetic, so a
 * wrong number silently drops entries off the end of a chunk.
 */
async function staticPaths(): Promise<string[]> {
  const policies = await getPolicies();
  return [
    "",
    "/products",
    ...pageSlugs().map((slug) => `/pages/${slug}`),
    ...policies.map((policy) => `/policies/${policy.slug}`),
  ];
}
const ITEMS_PER_PAGE = 100;
const MAX_PAGES = 1000;
const MAX_CONCURRENT_PAGE_REQUESTS = 8;
const MAX_CONCURRENT_CATALOG_REQUESTS = 4;
/** Maximum items we can actually fetch, given pagination limits. */
const MAX_FETCHABLE_ITEMS = ITEMS_PER_PAGE * MAX_PAGES;

/**
 * Default locale options for build-time API calls. During build, cookies() is
 * not available, so sitemap requests always pass explicit locale options.
 */
function getDefaultLocaleOptions(): LocaleOptions {
  return {
    locale: getDefaultLocale(),
    country: getDefaultCountry(),
  };
}

async function resolveLocaleCatalogs(
  countryLocales: CountryLocale[],
): Promise<Map<string, LocaleCatalog>> {
  const uniqueTargets = new Map<string, CountryLocale>();

  for (const target of countryLocales) {
    const key = catalogKey(target);
    if (!uniqueTargets.has(key)) uniqueTargets.set(key, target);
  }

  const targets = Array.from(uniqueTargets.entries());
  const entries: Array<readonly [string, LocaleCatalog]> = [];
  for (
    let offset = 0;
    offset < targets.length;
    offset += MAX_CONCURRENT_CATALOG_REQUESTS
  ) {
    const batch = targets.slice(
      offset,
      offset + MAX_CONCURRENT_CATALOG_REQUESTS,
    );
    entries.push(
      ...(await Promise.all(
        batch.map(
          async ([key, target]) =>
            [key, await buildLocaleCatalog(target)] as const,
        ),
      )),
    );
  }
  return new Map(entries);
}

function catalogKey(target: { marketId: string; locale: string }): string {
  return `${target.marketId}:${target.locale.toLowerCase()}`;
}

/**
 * Splits the sitemap into bounded files. Counts are fetched once per
 * Market/locale pair: countries in one Market share an inventory, while two
 * Markets using the same locale may expose entirely different catalogs.
 */
export async function generateSitemaps(): Promise<Array<{ id: number }>> {
  // A shop that may not be browsed without an account publishes no index of
  // itself. See the same guard in sitemap() below and in robots.ts: the three
  // together are what "no URL should be able to be seen without first login in"
  // means for a crawler, which never signs in and never will.
  if (isAccountRequired()) return [];

  try {
    const countryLocales = await resolveCountryLocales();
    const catalogs = await resolveLocaleCatalogs(countryLocales);
    // Once per response. The list reaches the API, and calling it inside the
    // reduce would ask the same question once per market for no new answer.
    const staticCount = (await staticPaths()).length;
    const totalUrls = countryLocales.reduce((total, target) => {
      const catalog = catalogs.get(catalogKey(target));
      return total + (catalog ? catalogSize(catalog, staticCount) : 0);
    }, 0);
    const sitemapCount = Math.max(1, Math.ceil(totalUrls / URLS_PER_SITEMAP));

    return Array.from({ length: sitemapCount }, (_, id) => ({ id }));
  } catch {
    // API may be unavailable at build time. Return a single sitemap chunk that
    // will be populated on demand when the API recovers.
    return [{ id: 0 }];
  }
}

export default async function sitemap(props: {
  id: Promise<string>;
}): Promise<MetadataRoute.Sitemap> {
  const id = Number(await props.id);
  if (!Number.isSafeInteger(id) || id < 0) return [];
  if (isAccountRequired()) return [];

  const baseUrl = resolveBaseUrl();
  if (!baseUrl) return [];

  let countryLocales: CountryLocale[];
  let catalogs: Map<string, LocaleCatalog>;

  try {
    countryLocales = await resolveCountryLocales();
    catalogs = await resolveLocaleCatalogs(countryLocales);
  } catch (error) {
    console.error("Sitemap generation failed: API unavailable.", error);
    return [];
  }

  const paths = await staticPaths();
  const chunkStart = id * URLS_PER_SITEMAP;
  const chunkEnd = chunkStart + URLS_PER_SITEMAP;
  const entries: MetadataRoute.Sitemap = [];
  const pageCaches: PageCaches = {
    products: new Map(),
    categories: new Map(),
  };
  let targetStart = 0;

  for (const target of countryLocales) {
    const catalog = catalogs.get(catalogKey(target));
    if (!catalog) continue;

    const targetEnd = targetStart + catalogSize(catalog, paths.length);
    if (targetEnd <= chunkStart) {
      targetStart = targetEnd;
      continue;
    }
    if (targetStart >= chunkEnd) break;

    // Clean URLs list one address per page instead of one per market, which is
    // the whole point: two forms of the same page in a sitemap is two pages
    // competing with each other. This file is also the one he is waiting on
    // before he finishes his LLMS work: "I think I will wait until the URL
    // Structure is final and the shops are live to see the sitmap.mxl to pull
    // the URLS from there."
    const basePath = cleanUrlsEnabled()
      ? baseUrl
      : `${baseUrl}/${target.country}/${target.locale}`;
    appendStaticEntries(
      entries,
      paths,
      basePath,
      targetStart,
      chunkStart,
      chunkEnd,
    );

    const productStart = targetStart + paths.length;
    const productEnd = productStart + catalog.productCount;
    const categoryStart = productEnd;
    const categoryEnd = categoryStart + catalog.categoryCount;

    const productRange = intersectRange(
      productStart,
      productEnd,
      chunkStart,
      chunkEnd,
    );
    const categoryRange = intersectRange(
      categoryStart,
      categoryEnd,
      chunkStart,
      chunkEnd,
    );

    const [products, categories] = await Promise.allSettled([
      productRange
        ? fetchProductRange(
            catalog,
            productRange.start - productStart,
            productRange.end - productStart,
            pageCaches,
          )
        : Promise.resolve([]),
      categoryRange
        ? fetchCategoryRange(
            catalog,
            categoryRange.start - categoryStart,
            categoryRange.end - categoryStart,
            pageCaches,
          )
        : Promise.resolve([]),
    ]);

    if (products.status === "fulfilled") {
      appendProductEntries(entries, basePath, products.value);
    } else {
      console.error(
        `Sitemap: skipping products for ${target.country}/${target.locale}.`,
        products.reason,
      );
    }
    if (categories.status === "fulfilled") {
      appendCategoryEntries(entries, basePath, categories.value);
    } else {
      console.error(
        `Sitemap: skipping categories for ${target.country}/${target.locale}.`,
        categories.reason,
      );
    }

    targetStart = targetEnd;
  }

  return entries;
}

function resolveBaseUrl(): string | undefined {
  const candidate = (getStoreUrl() || "").replace(/\/$/, "");

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }
    return parsed.origin + parsed.pathname.replace(/\/$/, "");
  } catch {
    console.error(
      "Sitemap generation skipped: neither NEXT_PUBLIC_SITE_URL nor " +
        "NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL is set or valid. " +
        "Sitemaps require absolute http(s) URLs.",
    );
    return undefined;
  }
}

function catalogSize(catalog: LocaleCatalog, staticCount: number): number {
  return staticCount + catalog.productCount + catalog.categoryCount;
}

function intersectRange(
  rangeStart: number,
  rangeEnd: number,
  chunkStart: number,
  chunkEnd: number,
): { start: number; end: number } | undefined {
  const start = Math.max(rangeStart, chunkStart);
  const end = Math.min(rangeEnd, chunkEnd);
  return start < end ? { start, end } : undefined;
}

function appendStaticEntries(
  entries: MetadataRoute.Sitemap,
  paths: string[],
  basePath: string,
  targetStart: number,
  chunkStart: number,
  chunkEnd: number,
): void {
  const staticEntries: MetadataRoute.Sitemap = paths.map((path) => {
    if (path === "") {
      return { url: basePath, changeFrequency: "daily", priority: 1 };
    }
    if (path === "/products") {
      return {
        url: `${basePath}/products`,
        changeFrequency: "daily",
        priority: 0.8,
      };
    }
    // Content and policy pages change rarely and are not the front door, so they
    // are weighted below the catalogue rather than left out of it.
    return {
      // Safe, because `path` carries policy slugs and content page slugs and
      // both are editable in his admin. Nothing currently holds an "&", and the
      // three image filenames that did were enough to reject the whole document.
      url: sitemapSafeUrl(`${basePath}${path}`),
      changeFrequency: "monthly" as const,
      priority: path.startsWith("/policies/") ? 0.3 : 0.6,
    };
  });

  for (const [offset, entry] of staticEntries.entries()) {
    const position = targetStart + offset;
    if (position >= chunkStart && position < chunkEnd) entries.push(entry);
  }
}

function appendProductEntries(
  entries: MetadataRoute.Sitemap,
  basePath: string,
  products: SitemapProduct[],
): void {
  for (const product of products) {
    entries.push({
      url: sitemapSafeUrl(`${basePath}/products/${product.slug}`),
      ...(product.updated_at
        ? { lastModified: new Date(product.updated_at) }
        : {}),
      changeFrequency: "weekly",
      priority: 0.6,
      ...(product.media && product.media.length > 0
        ? {
            // Through sitemapSafeUrl, always. ActiveStorage keeps the
            // original filename in the URL path, three of his photographs are
            // named with an "&" in them, and a bare "&" made the whole
            // document fail to parse on every shop. See that module for why
            // this percent-encodes rather than XML-escapes.
            images: product.media
              .map((image) => image.original_url || image.large_url)
              .filter((url: string | null): url is string => url != null)
              .map(sitemapSafeUrl),
          }
        : {}),
    });
  }
}

function appendCategoryEntries(
  entries: MetadataRoute.Sitemap,
  basePath: string,
  categories: SitemapCategory[],
): void {
  for (const category of categories) {
    if (category.is_root) continue;
    entries.push({
      url: sitemapSafeUrl(`${basePath}/c/${category.permalink}`),
      ...(category.updated_at
        ? { lastModified: new Date(category.updated_at) }
        : {}),
      changeFrequency: "weekly",
      priority: 0.5,
    });
  }
}

/** Resolve every valid country/locale URL exposed by configured Markets. */
async function resolveCountryLocales(): Promise<CountryLocale[]> {
  const localeOptions = getDefaultLocaleOptions();
  const markets = await getSitemapMarkets(localeOptions);
  const targets = getMarketLocaleTargets(markets);

  return targets.length > 0
    ? targets
    : [
        {
          marketId: "default",
          country: localeOptions.country,
          locale:
            resolveSupportedLocale(localeOptions.locale) ?? DEFAULT_LOCALE,
        },
      ];
}

async function buildLocaleCatalog(
  target: CountryLocale,
): Promise<LocaleCatalog> {
  const localeOptions = { locale: target.locale, country: target.country };
  const [productCount, categoryCount] = await Promise.all([
    getSitemapResourceCount("products", target.marketId, localeOptions),
    getSitemapResourceCount("categories", target.marketId, localeOptions),
  ]);

  return {
    marketId: target.marketId,
    ...localeOptions,
    productCount: Math.min(productCount, MAX_FETCHABLE_ITEMS),
    categoryCount: Math.min(categoryCount, MAX_FETCHABLE_ITEMS),
  };
}

async function fetchProductRange(
  catalog: LocaleCatalog,
  start: number,
  end: number,
  pageCaches: PageCaches,
): Promise<SitemapProduct[]> {
  return fetchItemRange(start, end, (page) =>
    getCachedProductPage(catalog, page, pageCaches.products),
  );
}

async function fetchCategoryRange(
  catalog: LocaleCatalog,
  start: number,
  end: number,
  pageCaches: PageCaches,
): Promise<SitemapCategory[]> {
  return fetchItemRange(start, end, (page) =>
    getCachedCategoryPage(catalog, page, pageCaches.categories),
  );
}

async function fetchItemRange<T>(
  start: number,
  end: number,
  loadPage: (page: number) => Promise<T[]>,
): Promise<T[]> {
  if (start >= end) return [];

  const firstPage = Math.floor(start / ITEMS_PER_PAGE) + 1;
  const lastPage = Math.ceil(end / ITEMS_PER_PAGE);
  const pages = Array.from(
    { length: lastPage - firstPage + 1 },
    (_, index) => firstPage + index,
  );
  const items: T[] = [];

  for (
    let offset = 0;
    offset < pages.length;
    offset += MAX_CONCURRENT_PAGE_REQUESTS
  ) {
    const batch = pages.slice(offset, offset + MAX_CONCURRENT_PAGE_REQUESTS);
    const results = await Promise.all(batch.map(loadPage));
    for (const result of results) items.push(...result);
  }

  const loadedRangeStart = (firstPage - 1) * ITEMS_PER_PAGE;
  return items.slice(start - loadedRangeStart, end - loadedRangeStart);
}

function getCachedProductPage(
  catalog: LocaleCatalog,
  page: number,
  cache: PageCaches["products"],
): Promise<SitemapProduct[]> {
  const key = `${catalogKey(catalog)}:${page}`;
  let cached = cache.get(key);
  if (!cached) {
    cached = getSitemapProductPage(catalog.marketId, page, ITEMS_PER_PAGE, {
      locale: catalog.locale,
      country: catalog.country,
    }).catch((error) => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, cached);
  }
  return cached;
}

function getCachedCategoryPage(
  catalog: LocaleCatalog,
  page: number,
  cache: PageCaches["categories"],
): Promise<SitemapCategory[]> {
  const key = `${catalogKey(catalog)}:${page}`;
  let cached = cache.get(key);
  if (!cached) {
    cached = getSitemapCategoryPage(catalog.marketId, page, ITEMS_PER_PAGE, {
      locale: catalog.locale,
      country: catalog.country,
    }).catch((error) => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, cached);
  }
  return cached;
}
