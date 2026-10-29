"use server";

import type { ProductListParams } from "@spree/sdk";
import { cacheLife, cacheTag } from "next/cache";
import {
  cacheTagSuffix,
  DEFAULT_SURFACE,
  getAccessToken,
  getClientForSurface,
  getLocaleOptions,
  type Surface,
} from "@/lib/spree";
import { asCustomerOrGuest } from "./catalog-token";

/**
 * Cached product list fetch. Cache key is derived from all function
 * arguments by Next.js "use cache":
 *
 * - locale/country: determines language and market-specific pricing
 * - surface: DTC vs wholesale — different catalog + channel pricing. Baked
 *   into both the cache tag and the arguments so the two never share entries.
 * - userToken: per-user cache segmentation (separate arg, NOT passed to
 *   SDK). Authenticated users may see different prices (B2B, loyalty).
 *   Each user's JWT is unique so the cache is segmented per user.
 *   Guest users pass undefined. On the wholesale surface the token is
 *   always present — the channel 401s guests.
 */
export async function cachedListProducts(
  params: ProductListParams | undefined,
  options: { locale?: string; country?: string },
  surface: Surface,
  userToken?: string,
) {
  "use cache: remote";
  cacheLife("tenMinutes");
  cacheTag(`products${cacheTagSuffix(surface)}`);
  return getClientForSurface(surface).products.list(params, {
    ...options,
    // The customer's token on every surface: the wholesale channel 401s
    // guests, and a prices-hidden channel prices only for who is asking
    // (./catalog-token.ts).
    ...(userToken ? { token: userToken } : undefined),
  });
}

export async function getProducts(
  params?: ProductListParams,
  surface: Surface = DEFAULT_SURFACE,
) {
  const options = await getLocaleOptions();
  const userToken = await getAccessToken();
  return asCustomerOrGuest(userToken, (token) =>
    cachedListProducts(params, options, surface, token),
  );
}

/**
 * Persistent cached product detail fetch. Cache key is derived from:
 *
 * - slugOrId, expand: identify the product and response shape
 * - locale/country: determines language and market-specific pricing
 * - surface: DTC vs wholesale — see cachedListProducts
 * - userToken: per-user cache segmentation (separate arg, NOT passed to
 *   SDK). Authenticated users may see different prices (B2B, loyalty).
 *   Guest users pass undefined, so all guests share one entry.
 */
export async function cachedGetProduct(
  slugOrId: string,
  expand: string[],
  options: { locale?: string; country?: string },
  surface: Surface,
  userToken?: string,
) {
  "use cache: remote";
  cacheLife("tenMinutes");
  cacheTag(
    `products${cacheTagSuffix(surface)}`,
    `product:${slugOrId}${cacheTagSuffix(surface)}`,
  );
  return getClientForSurface(surface).products.get(
    slugOrId,
    { expand },
    {
      ...options,
      ...(userToken ? { token: userToken } : undefined),
    },
  );
}

export async function getProduct(
  slugOrId: string,
  params?: { expand?: string[] },
  surface: Surface = DEFAULT_SURFACE,
) {
  const options = await getLocaleOptions();
  const userToken = await getAccessToken();
  return asCustomerOrGuest(userToken, (token) =>
    cachedGetProduct(slugOrId, params?.expand ?? [], options, surface, token),
  );
}

async function cachedGetProductFilters(
  params: Record<string, unknown> | undefined,
  options: { locale?: string; country?: string },
  surface: Surface,
  userToken?: string,
) {
  "use cache: remote";
  cacheLife("tenMinutes");
  cacheTag(`product-filters${cacheTagSuffix(surface)}`);
  return getClientForSurface(surface).products.filters(params, {
    ...options,
    ...(userToken ? { token: userToken } : undefined),
  });
}

export async function getProductFilters(
  params?: Record<string, unknown>,
  surface: Surface = DEFAULT_SURFACE,
) {
  const options = await getLocaleOptions();
  const userToken = await getAccessToken();
  return asCustomerOrGuest(userToken, (token) =>
    cachedGetProductFilters(params, options, surface, token),
  );
}
