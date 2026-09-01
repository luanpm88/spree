import { cleanUrlsEnabled } from "@/lib/store";

/**
 * Extract the /country/locale base path prefix from a pathname.
 * e.g. "/us/en/products" -> "/us/en"
 *
 * ── the SECOND place that knows the prefix exists ────────────────────────────
 *
 * basePathFor() in lib/routing says it is the only one. It was wrong, and this
 * is the other: 17 call sites derive the prefix from the CURRENT URL instead of
 * from configuration, because they are client components and a prop would have
 * to be threaded through every one of them.
 *
 * Under clean URLs that guess is not merely wrong, it is confidently wrong. On
 * /products/some-slug it returns "/products/some-slug" as the market prefix, so
 * the cart drawer's links became /products/some-slug/cart and
 * /products/some-slug/checkout/cart_xxx. Measured, not imagined: three 404s in
 * the browser walk, all of them prefetches of links that render only after
 * add-to-cart, which is why nothing in the served HTML looked wrong.
 *
 * It stayed hidden for as long as the prefix existed, because two segments is a
 * correct guess when the address really does start with a country and a locale.
 */
export function extractBasePath(pathname: string): string {
  // Nothing to strip when the shop has no prefix. Returning "" here is what
  // makes all 17 callers correct at once.
  if (cleanUrlsEnabled()) return "";
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 2) return "";
  return `/${segments[0]}/${segments[1]}`;
}

/** Any candidate that resolves off this placeholder origin is not a local path. */
export const INTERNAL_ORIGIN = "https://storefront.invalid";
/**
 * Survives URL parsing intact, but decodes to a path separator downstream.
 * Only ever tested against the path — a query value may legitimately carry an
 * encoded path of its own (a nested `?redirect=` target).
 */
const ENCODED_PATH_SEPARATOR = /%(?:2f|5c)/i;

/**
 * Resolve a candidate into a same-origin path, or null when it points anywhere
 * else. The single guard behind every post-login return target: a leading-slash
 * check alone is not enough, because the URL parser treats a backslash as a
 * slash for http(s), so "/\evil.com" resolves to the off-site "//evil.com".
 * Repeated query keys arrive as an array — only the first is considered.
 */
export function resolveLocalPath(
  value: string | string[] | undefined | null,
): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (
    !candidate?.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\")
  ) {
    return null;
  }

  try {
    const url = new URL(candidate, INTERNAL_ORIGIN);
    if (
      url.origin !== INTERNAL_ORIGIN ||
      ENCODED_PATH_SEPARATOR.test(url.pathname)
    ) {
      return null;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/**
 * Resolve a `?redirect=` value into a safe same-origin path, falling back when
 * it points anywhere else.
 */
export function safeRedirectPath(
  value: string | string[] | undefined | null,
  fallback: string,
): string {
  return resolveLocalPath(value) ?? fallback;
}

/**
 * Get the path portion after the /country/locale prefix.
 * e.g. "/us/en/products/shoes" -> "/products/shoes"
 */
export function getPathWithoutPrefix(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length <= 2) return "";
  return `/${segments.slice(2).join("/")}`;
}
