import { INTERNAL_ORIGIN, resolveLocalPath } from "./path";

function isAllowedLocalizedDestination(
  pathname: string,
  basePath: string,
): boolean {
  const accountPath = `${basePath}/account`;
  const checkoutPath = `${basePath}/checkout`;

  return (
    pathname === accountPath ||
    pathname.startsWith(`${accountPath}/`) ||
    pathname === checkoutPath ||
    pathname.startsWith(`${checkoutPath}/`)
  );
}

/**
 * Every page of this market, rather than the two that normally send someone to
 * sign in.
 *
 * A shop can be gated as a whole, and on such a shop any address at all bounces
 * to the login page: the wholesale shop must not show a product to someone who
 * was forwarded the link. If the return target stayed narrowed to account and
 * checkout, that person would sign in and land on their account page with no
 * sign of the product they were sent, which reads as a broken link rather than
 * as a gate.
 *
 * The narrowing that matters is still here. `resolveLocalPath` has already
 * rejected anything cross-origin, and the path must sit inside this market's
 * own prefix, so this cannot be used to bounce someone to another shop or to
 * another site.
 */
function isWithinMarket(pathname: string, basePath: string): boolean {
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

/**
 * Resolve a login return target without allowing cross-origin or cross-market
 * navigation: a safe local path, narrowed to the destinations that send users
 * through the account sign-in page. Account and checkout are the only two on a
 * shop anyone may browse; a gated shop passes `anyPageInMarket` because every
 * page of it is behind the login.
 */
export function resolveAccountRedirect(
  redirect: string | null | undefined,
  basePath: string,
  anyPageInMarket = false,
): string | null {
  const target = resolveLocalPath(redirect);
  if (!target) return null;

  const { pathname } = new URL(target, INTERNAL_ORIGIN);
  const allowed = anyPageInMarket
    ? isWithinMarket(pathname, basePath)
    : isAllowedLocalizedDestination(pathname, basePath);

  return allowed ? target : null;
}

export function buildAccountLoginHref(
  basePath: string,
  returnTo?: string | null,
  anyPageInMarket = false,
): string {
  const accountPath = `${basePath}/account`;
  const safeReturnTo = resolveAccountRedirect(
    returnTo,
    basePath,
    anyPageInMarket,
  );

  if (!safeReturnTo || safeReturnTo === accountPath) return accountPath;

  return `${accountPath}?redirect=${encodeURIComponent(safeReturnTo)}`;
}

/**
 * Move a validated localized account/checkout target to a new market prefix.
 * The page suffix, query string, and hash belong to the target and must stay
 * intact when the storefront country or locale changes.
 */
export function rebaseAccountRedirect(
  redirect: string | null | undefined,
  currentBasePath: string,
  nextBasePath: string,
): string | null {
  const safeRedirect = resolveAccountRedirect(redirect, currentBasePath);
  if (!safeRedirect) return null;

  const target = new URL(safeRedirect, INTERNAL_ORIGIN);
  const currentPrefix = `${currentBasePath}/`;
  const nextPath =
    target.pathname === currentBasePath
      ? nextBasePath
      : target.pathname.startsWith(currentPrefix)
        ? `${nextBasePath}${target.pathname.slice(currentBasePath.length)}`
        : null;

  if (!nextPath) return null;

  return resolveAccountRedirect(
    `${nextPath}${target.search}${target.hash}`,
    nextBasePath,
  );
}

/**
 * Rebase a login return target inside a URL search string. Invalid redirect
 * values are discarded instead of being carried into another market.
 */
export function rebaseAccountRedirectSearch(
  search: string,
  currentBasePath: string,
  nextBasePath: string,
): string {
  const params = new URLSearchParams(search);
  const redirect = params.get("redirect");
  if (redirect === null) return search;

  const rebasedRedirect = rebaseAccountRedirect(
    redirect,
    currentBasePath,
    nextBasePath,
  );
  if (rebasedRedirect) {
    params.set("redirect", rebasedRedirect);
  } else {
    params.delete("redirect");
  }

  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}
