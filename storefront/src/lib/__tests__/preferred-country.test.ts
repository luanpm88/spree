import { afterEach, describe, expect, it } from "vitest";
import { preferredCountryIso } from "@/lib/store";

/**
 * The US market sells to the territories as well, and the list arrives in
 * alphabetical order, so the checkout opened on American Samoa. A US postcode
 * typed into it is rejected, no shipping is quoted, and the shop cannot be
 * bought from until the customer notices the country box.
 */
const US_MARKET = [
  { iso: "AS" }, // American Samoa, first alphabetically
  { iso: "GU" },
  { iso: "PR" },
  { iso: "US" },
];

afterEach(() => {
  process.env.NEXT_PUBLIC_DEFAULT_COUNTRY = undefined;
});

describe("preferredCountryIso", () => {
  it("picks the shop's own country, not the first in the market", () => {
    expect(preferredCountryIso(US_MARKET, "us")).toBe("US");
  });

  it("picks nothing on a many-country market with no country of its own", () => {
    // The rest-of-world shop builds with a shop name here rather than a country
    // code. It was opening on Belgium, and a Belgian postcode is four digits.
    expect(preferredCountryIso(US_MARKET, "nolocal")).toBe("");
  });

  it("picks the only country when the market has one", () => {
    expect(preferredCountryIso([{ iso: "NZ" }], "b2b")).toBe("NZ");
  });

  it("is unchanged on a market of one country", () => {
    expect(preferredCountryIso([{ iso: "AU" }], "au")).toBe("AU");
  });

  it("matches whatever case the API returns", () => {
    expect(preferredCountryIso([{ iso: "as" }, { iso: "us" }], "US")).toBe(
      "us",
    );
  });

  it("is empty for an empty market, which is what the caller treated as no default", () => {
    expect(preferredCountryIso([], "us")).toBe("");
  });
});
