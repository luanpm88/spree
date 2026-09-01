import { afterEach, describe, expect, it, vi } from "vitest";
import { extractBasePath, resolveLocalPath, safeRedirectPath } from "../path";

describe("resolveLocalPath", () => {
  it.each([
    ["/us/en/wholesale", "/us/en/wholesale"],
    [
      "/us/en/wholesale/products/mug?category_id=3#specs",
      "/us/en/wholesale/products/mug?category_id=3#specs",
    ],
    [["/us/en/wholesale", "/us/en/account"], "/us/en/wholesale"],
    // An encoded path is ordinary data inside a query value.
    [
      "/us/en/wholesale?redirect=%2Fus%2Fen%2Fwholesale",
      "/us/en/wholesale?redirect=%2Fus%2Fen%2Fwholesale",
    ],
  ])("resolves a same-origin path: %s", (value, expected) => {
    expect(resolveLocalPath(value)).toBe(expected);
  });

  it.each([
    "https://example.com/us/en/wholesale",
    "//example.com/us/en/wholesale",
    "/\\example.com/us/en/wholesale",
    "/us/en/wholesale%2f%2fexample.com",
    "us/en/wholesale",
    "//[",
    "",
  ])("rejects a value that is not a local path: %s", (value) => {
    expect(resolveLocalPath(value)).toBeNull();
  });

  it.each([null, undefined, []])("rejects %s", (value) => {
    expect(resolveLocalPath(value)).toBeNull();
  });
});

describe("safeRedirectPath", () => {
  const fallback = "/us/en/wholesale";

  it("returns the resolved path when it is local", () => {
    expect(safeRedirectPath("/us/en/wholesale/cart", fallback)).toBe(
      "/us/en/wholesale/cart",
    );
  });

  it("returns the fallback when the value points elsewhere", () => {
    expect(safeRedirectPath("https://example.com", fallback)).toBe(fallback);
  });
});

describe("extractBasePath under clean URLs", () => {
  // The whole point: two segments is a CORRECT guess while the address starts
  // with a country and a locale, and a confidently wrong one the moment it does
  // not. On /products/some-slug it used to hand back "/products/some-slug" as
  // the market prefix, so the cart drawer linked to /products/some-slug/cart.
  const paths = [
    "/products/800ml-bottle-with-sports-lid",
    "/c/collections/on-sale",
    "/pages/about",
    "/cart",
    "/",
  ];

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(paths)("returns no prefix at all for %s", (pathname) => {
    vi.stubEnv("NEXT_PUBLIC_CLEAN_URLS", "1");
    expect(extractBasePath(pathname)).toBe("");
  });

  it("still strips the prefix when the flag is off", () => {
    vi.stubEnv("NEXT_PUBLIC_CLEAN_URLS", "");
    expect(extractBasePath("/nz/en/products/x")).toBe("/nz/en");
  });

  it("makes the cart drawer's links absolute rather than relative", () => {
    vi.stubEnv("NEXT_PUBLIC_CLEAN_URLS", "1");
    const basePath = extractBasePath("/products/800ml-bottle-with-sports-lid");

    // These three are the exact URLs that came back 404 from the browser walk.
    expect(`${basePath}/cart`).toBe("/cart");
    expect(`${basePath}/checkout/cart_uh92YK1rnl`).toBe(
      "/checkout/cart_uh92YK1rnl",
    );
    expect(`${basePath}/products/x`).toBe("/products/x");
  });
});
