import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { REQUEST_PATHNAME_HEADER } from "@/i18n/routing";
import { getCustomer } from "@/lib/data/customer";
import { isPublicOnGatedShop } from "@/lib/spree/middleware";
import { getPublicPaths, isAccountRequired } from "@/lib/store";
import { buildAccountLoginHref } from "@/lib/utils/account-redirect";

/**
 * The closed shop's gate, on the server, where the session is real.
 *
 * ── why the middleware is not enough ─────────────────────────────────────────
 *
 * The middleware decides by asking whether a `_spree_jwt` cookie is present and
 * non-empty. It cannot do better: this storefront is a separate application
 * from Rails and does not hold Spree's signing secret, so it cannot verify a
 * token, and a JWT nobody verifies is a string anybody can type.
 *
 *     document.cookie = '_spree_jwt=x'
 *
 * That one line was enough to walk the whole shop. On the retail shops the same
 * check guards only the account pages, where a forged token buys nothing: every
 * request behind it asks the API for that customer's own data and the API
 * answers 401. Putting the entire catalogue behind the same check changed what
 * it was worth, because product pages do not read the customer's token at all.
 * They read the shop's publishable key, and they render.
 *
 * So the middleware keeps doing what it is good at, which is bouncing a visitor
 * to the login in one hop before a page is built, and this runs inside the page
 * where `getCustomer()` can ask the API who the caller actually is.
 *
 * ── what it costs ────────────────────────────────────────────────────────────
 *
 * One API call per page render on a closed shop, and none at all on an open one:
 * `isAccountRequired()` is a build-time constant, so for the five retail shops
 * this function returns before it does anything.
 *
 * ── the exception list is not repeated here ──────────────────────────────────
 *
 * `isPublicOnGatedShop` is imported from the middleware rather than restated,
 * because two lists that must agree eventually will not. The policies a new
 * business has to read before it can apply, and the sign-in pages themselves,
 * are open in both places or in neither.
 */
export interface GateState {
  /** Whether this shop requires an account at all. */
  gated: boolean;
  /** Whether the caller has one, verified against the API rather than assumed. */
  signedIn: boolean;
}

export async function enforceShopGate(basePath: string): Promise<GateState> {
  if (!isAccountRequired()) return { gated: false, signedIn: true };

  // Set by the middleware on every request it lets through. Absent means the
  // request did not come through the middleware, which on a closed shop is
  // itself a reason not to serve the page.
  const requestHeaders = await headers();
  const pathname = requestHeaders.get(REQUEST_PATHNAME_HEADER) ?? basePath;
  const customer = await getCustomer();

  if (customer) return { gated: true, signedIn: true };

  // The pages that stay open on a closed shop are open to a stranger, and they
  // render inside the shop's own chrome: the header carries the whole category
  // tree and the search box, the footer repeats the categories. So the sign-in
  // page hands someone with no account the shape of the catalogue and a way to
  // query it, which is the thing the gate exists to withhold.
  //
  // Reported rather than redirected, because these pages must stay reachable.
  // The layout renders them without the navigation instead.
  if (isPublicOnGatedShop(pathname, basePath, getPublicPaths())) {
    return { gated: true, signedIn: false };
  }

  redirect(buildAccountLoginHref(basePath, pathname, true));
}
