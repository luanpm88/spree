import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The locale sent to the API, separately from the locale in the URL.
 *
 * ── the fault this exists for ───────────────────────────────────────────────
 *
 * Search returned nothing on two of his shops for weeks. The cause was one
 * request header. Measured on his live AU shop, same query, one header changed:
 *
 *   no locale header        count=65
 *   x-spree-locale: en      count=0
 *   x-spree-locale: en-AU   count=65
 *
 * Those two shops have a default_locale of en-AU and en-NZ and their products
 * have no plain `en` translations, so a search in `en` correctly matched
 * nothing. Browsing looked perfect the whole time, because a listing falls back
 * to the base columns.
 *
 * This is asserted rather than trusted for two reasons. The override is a
 * single `||` that reads like dead code to anyone who does not know the story,
 * and the whole fault was invisible to every other check: the shop rendered,
 * answered 200, and sold.
 */
describe("the locale the API is asked in", () => {
  const cookieStore = { get: () => undefined };
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("next/headers", () => ({ cookies: async () => cookieStore }));
    vi.doMock("@/lib/spree/config", () => ({
      getConfig: () => ({ defaultLocale: "en", defaultCountry: "au" }),
    }));
  });
  afterEach(() => {
    delete process.env.SPREE_API_LOCALE;
    vi.doUnmock("next/headers");
    vi.doUnmock("@/lib/spree/config");
  });

  it("sends the shop's own locale when one is set", async () => {
    process.env.SPREE_API_LOCALE = "en-AU";
    const { getLocaleOptions } = await import("@/lib/spree/locale");
    expect((await getLocaleOptions()).locale).toBe("en-AU");
  });

  it("leaves the other six shops on the URL locale", async () => {
    // Unset is the normal case. Six of the seven shops have a default_locale of
    // plain `en` and search works on them, so this must change nothing there.
    const { getLocaleOptions } = await import("@/lib/spree/locale");
    expect((await getLocaleOptions()).locale).toBe("en");
  });

  it("ignores a variable set to nothing but spaces", async () => {
    // An env var present and empty is how a compose file half-edited looks, and
    // "" as a locale would be worse than the fault: it would send an empty
    // header rather than falling back.
    process.env.SPREE_API_LOCALE = "   ";
    const { getLocaleOptions } = await import("@/lib/spree/locale");
    expect((await getLocaleOptions()).locale).toBe("en");
  });

  it("does not touch the country", async () => {
    // The country decides pricing and the market. This fault was about
    // translations only, and widening the fix to the country would put every
    // shop's prices in the blast radius of a search bug.
    process.env.SPREE_API_LOCALE = "en-AU";
    const { getLocaleOptions } = await import("@/lib/spree/locale");
    expect((await getLocaleOptions()).country).toBe("au");
  });
});
