import { describe, expect, it } from "vitest";
import { breaksXml, sitemapSafeUrl } from "@/lib/data/sitemapUrl";

/**
 * The client found this one by reading a sitemap, which is the only way it could
 * have been found: the document served 200, was the right size, and no check
 * anywhere parsed it.
 *
 * His three filenames are in here verbatim, so the case that shipped is the case
 * that is pinned.
 */
describe("sitemapSafeUrl", () => {
  const BASE =
    "https://store.example/rails/active_storage/blobs/proxy/eyJfcmFpbHMiOnsiZGF0YSI6MTQxNSwicHVyIjoiYmxvYl9pZCJ9fQ==--4085fe317b8e3a49eb04c004b7d222b91fba551c";

  const HIS_FILES = [
    "Bamboo-&-S.S.-Lid--FRONT-HANDLE-DOWN.jpg",
    "Bamboo-&-S.S.-Lid---FRONT-HANDLE-UP.jpg",
    "1-2000-megaTANKA-SS-lid-&-1-kooler-cover-COMBO-V2.jpg",
  ];

  it("encodes the ampersand that rejected the whole document", () => {
    for (const file of HIS_FILES) {
      const out = sitemapSafeUrl(`${BASE}/${file}`);
      expect(out).not.toContain("&");
      expect(out).toContain("%26");
      expect(breaksXml(out)).toBe(false);
    }
  });

  it("leaves a URL with nothing unsafe in it exactly as it was", () => {
    const clean = `${BASE}/2L-thermo-with-PP-lid.jpg`;
    expect(sitemapSafeUrl(clean)).toBe(clean);
  });

  it("does not touch a percent that is already there", () => {
    // 71 of the 215 image URLs in one shop's sitemap already carry percent
    // encoding from the signed blob key. Encoding the percent would 404 all of
    // them, which is a worse outcome than the bug being fixed.
    const encoded = `${BASE}/already%20encoded%20name.jpg`;
    expect(sitemapSafeUrl(encoded)).toBe(encoded);
    expect(sitemapSafeUrl(encoded)).not.toContain("%25");
  });

  it("is idempotent, so running it twice is not a bug", () => {
    const once = sitemapSafeUrl(`${BASE}/${HIS_FILES[0]}`);
    expect(sitemapSafeUrl(once)).toBe(once);
  });

  it("encodes the angle brackets too", () => {
    const out = sitemapSafeUrl(`${BASE}/a<b>c.jpg`);
    expect(out).toContain("%3C");
    expect(out).toContain("%3E");
    expect(breaksXml(out)).toBe(false);
  });

  it("leaves a query string alone, because its ampersands are structural", () => {
    // There are none today and ActiveStorage proxy URLs do not use them. If one
    // ever appears with an ampersand in it, this is the line that says so: the
    // value is left intact and breaksXml reports true, which fails the assertion
    // below rather than shipping XML that does not parse.
    const withQuery = `${BASE}/name.jpg?a=1&b=2`;
    expect(sitemapSafeUrl(withQuery)).toBe(withQuery);
    expect(breaksXml(sitemapSafeUrl(withQuery))).toBe(true);
  });
});

describe("breaksXml", () => {
  it("accepts an already escaped entity", () => {
    expect(breaksXml("a&amp;b")).toBe(false);
    expect(breaksXml("a&#38;b")).toBe(false);
    expect(breaksXml("a&#x26;b")).toBe(false);
  });

  it("rejects a bare ampersand and a bare bracket", () => {
    expect(breaksXml("a&b")).toBe(true);
    expect(breaksXml("a<b")).toBe(true);
    expect(breaksXml("a>b")).toBe(true);
  });
});
