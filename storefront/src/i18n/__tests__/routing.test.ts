import { describe, expect, it } from "vitest";
import { buildLocalizedRedirectPath } from "@/i18n/routing";

describe("localized route fallback", () => {
  it("replaces the locale while preserving the page and query", () => {
    expect(
      buildLocalizedRedirectPath({
        country: "AR",
        locale: "es",
        pathname: "/ar/en/products/coffee",
        search: "?sort=price",
      }),
    ).toBe("/ar/es/products/coffee?sort=price");
  });

  it("falls back to the target root when request context is unavailable", () => {
    expect(buildLocalizedRedirectPath({ country: "us", locale: "en" })).toBe(
      "/us/en",
    );
  });
});

/**
 * A clean-URL shop hands this function a path with NO market in front of it.
 *
 * Getting that wrong is what sent every visitor from outside the shop's own
 * country to the home page. Measured on the live Canada storefront on 4 Sep,
 * through a Cloudflare edge in Amsterdam, so cf-ipcountry said nl:
 *
 *   200 /products/some-bottle-with-a-lid
 *   <meta http-equiv="refresh" content="1;url=/ca/en">
 *   308 /ca/en   ->   200 /
 *
 * The middleware puts the visitor in a market the shop does not have, this
 * layout redirects them to the default one, and the path was dropped on the way.
 * It happens with JavaScript off, which is how a crawler sees it.
 */
describe("clean URLs, where the path carries no market prefix", () => {
  it("keeps the page the visitor asked for", () => {
    expect(
      buildLocalizedRedirectPath({
        country: "ca",
        locale: "en",
        pathname: "/products/some-bottle-with-a-lid",
        cleanUrls: true,
      }),
    ).toBe("/ca/en/products/some-bottle-with-a-lid");
  });

  it("keeps a two segment page the prefix regex would have eaten", () => {
    // THE reason the middleware is asked rather than the path inspected.
    // LOCALIZED_PREFIX is /[a-z]{2,12}/[a-z]{2,3}, and "/pages/faq" fits it
    // exactly as well as "/ca/en" does. Anything that guesses keeps some paths
    // and silently swallows others, and this is one it would swallow.
    expect(
      buildLocalizedRedirectPath({
        country: "ca",
        locale: "en",
        pathname: "/pages/faq",
        cleanUrls: true,
      }),
    ).toBe("/ca/en/pages/faq");
  });

  it("keeps the query as well as the path", () => {
    expect(
      buildLocalizedRedirectPath({
        country: "ca",
        locale: "en",
        pathname: "/products",
        search: "?sort=price",
        cleanUrls: true,
      }),
    ).toBe("/ca/en/products?sort=price");
  });

  it("leaves no trailing slash on the market root", () => {
    // /ca/en/ and /ca/en are two addresses for one page, and the whole point of
    // clean URLs on these shops was to stop two forms competing.
    expect(
      buildLocalizedRedirectPath({
        country: "ca",
        locale: "en",
        pathname: "/",
        cleanUrls: true,
      }),
    ).toBe("/ca/en");
  });

  it("still strips a real prefix when the middleware has not said otherwise", () => {
    // Shops addressed with a prefix must behave exactly as before. Absent the
    // header, the regex runs and this is unchanged.
    expect(
      buildLocalizedRedirectPath({
        country: "ca",
        locale: "en",
        pathname: "/nl/en/products/coffee",
      }),
    ).toBe("/ca/en/products/coffee");
  });
});
