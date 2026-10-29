"use server";

import type { CategoryListParams, ProductListParams } from "@spree/sdk";
import { cacheLife, cacheTag } from "next/cache";
import { getAccessToken, getClient, getLocaleOptions } from "@/lib/spree";
import { asCustomerOrGuest } from "./catalog-token";

async function cachedListCategories(
  params: CategoryListParams | undefined,
  options: { locale?: string; country?: string },
) {
  "use cache: remote";
  cacheLife("hours");
  cacheTag("categories");
  return getClient().categories.list(params, options);
}

/**
 * Categories in the order staff set on the dashboard, unless the caller asks
 * for another. The Store API has no default order for this list: unsorted, it
 * came back in a different order after every edit to the tree (measured 29 Oct
 * on 6.0.0), and the live 5.6 menu shows his main categories shuffled.
 */
export async function getCategories(
  params?: CategoryListParams,
  options?: { locale?: string; country?: string },
) {
  const localeOptions = options ?? (await getLocaleOptions());
  return cachedListCategories({ sort: "lft", ...params }, localeOptions);
}

export async function cachedGetCategory(
  idOrPermalink: string,
  params: { expand?: string[] } | undefined,
  options: { locale?: string; country?: string },
) {
  "use cache: remote";
  cacheLife("tenMinutes");
  cacheTag("category");
  return getClient().categories.get(idOrPermalink, params, options);
}

export async function getCategory(
  idOrPermalink: string,
  params?: { expand?: string[] },
) {
  const options = await getLocaleOptions();
  return cachedGetCategory(idOrPermalink, params, options);
}

/**
 * Persistent cached category products fetch. Cache key is derived from
 * all function arguments (categoryId, params, locale, country, userToken).
 * Guest users pass undefined so the cache entry is shared.
 */
async function cachedListCategoryProducts(
  categoryId: string,
  params: ProductListParams | undefined,
  options: { locale?: string; country?: string },
  userToken?: string,
) {
  "use cache: remote";
  cacheLife("tenMinutes");
  cacheTag("products", `category-products:${categoryId}`);
  // The customer's token, so a prices-hidden shop prices this list for an
  // approved customer (./catalog-token.ts). Undefined for a guest.
  return getClient().products.list(
    { ...params, in_category: categoryId },
    { ...options, ...(userToken ? { token: userToken } : undefined) },
  );
}

export async function getCategoryProducts(
  categoryId: string,
  params?: ProductListParams,
) {
  const options = await getLocaleOptions();
  const userToken = await getAccessToken();
  return asCustomerOrGuest(userToken, (token) =>
    cachedListCategoryProducts(categoryId, params, options, token),
  );
}
