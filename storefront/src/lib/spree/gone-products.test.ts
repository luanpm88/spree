// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const productsGet = vi.fn();
vi.mock("./config", () => ({
  getClient: () => ({ products: { get: productsGet } }),
  getConfig: () => ({}),
}));

import {
  BYPASS_HEADER,
  createGoneProductCheck,
  type ProductRoute,
  productRouteOf,
  saysNoindex,
  type Verdict,
} from "./gone-products";
import { createSpreeMiddleware } from "./middleware";

const SOFT_404 =
  '<!DOCTYPE html><html><head><meta name="robots" content="noindex"/><title>Product Not Found</title></head><body><header>SHOP</header><h1>Not found</h1></body></html>';
const PRODUCT_PAGE =
  "<!DOCTYPE html><html><head><title>Bottle</title></head><body><header>SHOP</header><h1>Bottle</h1></body></html>";

function req(
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
) {
  return new NextRequest(url, init);
}

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

describe("which requests render a product", () => {
  it("reads a prefixed address that passes straight through", () => {
    const route = productRouteOf(
      req("https://shop.example/nz/en/products/steel-bottle"),
      NextResponse.next(),
    );
    expect(route).toEqual({
      country: "nz",
      locale: "en",
      slug: "steel-bottle",
    });
  });

  it("reads a clean address from the rewrite, not from the address bar", () => {
    const route = productRouteOf(
      req("https://shop.example/products/steel-bottle"),
      NextResponse.rewrite(
        new URL("https://shop.example/nz/en/products/steel-bottle"),
      ),
    );
    expect(route).toEqual({
      country: "nz",
      locale: "en",
      slug: "steel-bottle",
    });
  });

  it("works on what the locale middleware really returns, both shapes", () => {
    const prefixed = createSpreeMiddleware({
      defaultCountry: "nz",
      defaultLocale: "en",
    });
    const a = req("https://shop.example/nz/en/products/steel-bottle");
    expect(productRouteOf(a, prefixed(a))).toEqual({
      country: "nz",
      locale: "en",
      slug: "steel-bottle",
    });

    const clean = createSpreeMiddleware({
      defaultCountry: "nz",
      defaultLocale: "en",
      cleanUrls: true,
    });
    const b = req("https://shop.example/products/steel-bottle");
    expect(productRouteOf(b, clean(b))).toEqual({
      country: "nz",
      locale: "en",
      slug: "steel-bottle",
    });
  });

  it("ignores redirects, sign-in bounces and responses with their own body", () => {
    const r = req("https://shop.example/products/steel-bottle");
    expect(
      productRouteOf(
        r,
        NextResponse.redirect(
          "https://shop.example/nz/en/products/steel-bottle",
        ),
      ),
    ).toBeNull();
    expect(
      productRouteOf(r, new NextResponse("hi", { status: 200 })),
    ).toBeNull();
  });

  // Next removes rsc and the router headers before the proxy runs, so what
  // arrives here from a client-side navigation is a browser fetch(): only
  // Sec-Fetch-Dest says so.
  it("leaves client-side navigations and prefetches alone", () => {
    for (const dest of ["empty", "script", "image", "iframe"]) {
      const r = req("https://shop.example/nz/en/products/steel-bottle", {
        headers: { "sec-fetch-dest": dest },
      });
      expect(productRouteOf(r, NextResponse.next())).toBeNull();
    }
  });

  it("checks a browser's page load and a crawler that sends no Sec-Fetch headers", () => {
    const load = req("https://shop.example/nz/en/products/steel-bottle", {
      headers: { "sec-fetch-dest": "document" },
    });
    expect(productRouteOf(load, NextResponse.next())).not.toBeNull();
    const crawler = req("https://shop.example/nz/en/products/steel-bottle", {
      headers: { "user-agent": "Googlebot/2.1" },
    });
    expect(productRouteOf(crawler, NextResponse.next())).not.toBeNull();
  });

  it("checks only GET and HEAD", () => {
    const r = req("https://shop.example/nz/en/products/steel-bottle", {
      method: "POST",
    });
    expect(productRouteOf(r, NextResponse.next())).toBeNull();
    const h = req("https://shop.example/nz/en/products/steel-bottle", {
      method: "HEAD",
    });
    expect(productRouteOf(h, NextResponse.next())).not.toBeNull();
  });

  it("matches only a product page, nothing above or below it", () => {
    for (const path of [
      "/nz/en/products",
      "/nz/en/products/steel-bottle/reviews",
      "/nz/en/wholesale/products/steel-bottle",
      "/nz/en/c/products",
      "/products/steel-bottle",
    ]) {
      expect(
        productRouteOf(req(`https://shop.example${path}`), NextResponse.next()),
      ).toBeNull();
    }
  });

  it("decodes the slug the way the page receives it, and gives up on a broken one", () => {
    expect(
      productRouteOf(
        req("https://shop.example/nz/en/products/caf%C3%A9-cup"),
        NextResponse.next(),
      )?.slug,
    ).toBe("café-cup");
    expect(
      productRouteOf(
        req("https://shop.example/nz/en/products/bad%E0%A4%A"),
        NextResponse.next(),
      ),
    ).toBeNull();
  });
});

describe("noindex detection", () => {
  it("finds the robots tag in either attribute order", () => {
    expect(saysNoindex('<meta name="robots" content="noindex"/>')).toBe(true);
    expect(saysNoindex('<meta content="noindex, follow" name="robots">')).toBe(
      true,
    );
  });

  it("does not read the serialised payload every page carries as a tag", () => {
    expect(saysNoindex(PRODUCT_PAGE)).toBe(false);
    expect(
      saysNoindex(
        `${PRODUCT_PAGE}<script>self.__next_f.push([1,"[\\"$\\",\\"meta\\",null,{\\"name\\":\\"robots\\",\\"content\\":\\"noindex\\"}]"])</script>`,
      ),
    ).toBe(false);
    expect(saysNoindex('<meta name="description" content="noindex">')).toBe(
      false,
    );
  });
});

describe("a gone product answers 404 with today's page", () => {
  let lookup: ReturnType<
    typeof vi.fn<(route: ProductRoute) => Promise<Verdict>>
  >;
  let render: ReturnType<
    typeof vi.fn<(request: NextRequest, headers: Headers) => Promise<Response>>
  >;
  let clock: number;

  beforeEach(() => {
    lookup = vi.fn<(route: ProductRoute) => Promise<Verdict>>();
    render =
      vi.fn<(request: NextRequest, headers: Headers) => Promise<Response>>();
    clock = 1_000_000;
  });

  function check(enabled = true) {
    return createGoneProductCheck({
      enabled,
      lookup,
      render,
      now: () => clock,
    });
  }

  function baseResponse() {
    const response = NextResponse.next();
    response.cookies.set("spree_country", "nz", { path: "/" });
    return response;
  }

  it("lets a product that exists through untouched, without rendering anything", async () => {
    lookup.mockResolvedValue("found");
    const base = baseResponse();
    const out = await check()(
      req("https://shop.example/nz/en/products/steel-bottle"),
      base,
    );
    expect(out).toBe(base);
    expect(render).not.toHaveBeenCalled();
  });

  it("serves the rendered page with a 404 and keeps the locale cookies", async () => {
    lookup.mockResolvedValue("gone");
    render.mockImplementation(async () => htmlResponse(SOFT_404));
    const out = await check()(
      req("https://shop.example/nz/en/products/old-bottle", {
        headers: { cookie: "spree_cart_token=abc", host: "shop.example" },
      }),
      baseResponse(),
    );
    expect(out.status).toBe(404);
    expect(await out.text()).toBe(SOFT_404);
    expect(out.headers.get("content-type")).toContain("text/html");
    expect(out.headers.get("cache-control")).toContain("no-store");
    expect(out.headers.getSetCookie().join(";")).toContain("spree_country=nz");
    expect(lookup).toHaveBeenCalledWith({
      country: "nz",
      locale: "en",
      slug: "old-bottle",
    });
  });

  it("renders with the visitor's cookies and only headers on the allowlist", async () => {
    lookup.mockResolvedValue("gone");
    render.mockImplementation(async () => htmlResponse(SOFT_404));
    await check()(
      req("https://shop.example/nz/en/products/old-bottle", {
        headers: {
          cookie: "spree_cart_token=abc",
          host: "shop.example",
          "cf-ipcountry": "NZ",
          "x-middleware-subrequest": "proxy:proxy:proxy",
          "next-url": "/elsewhere",
        },
      }),
      baseResponse(),
    );
    const sent = render.mock.calls[0][1];
    expect(sent.get("cookie")).toBe("spree_cart_token=abc");
    expect(sent.get("cf-ipcountry")).toBe("NZ");
    expect(sent.get("x-forwarded-host")).toBe("shop.example");
    expect(sent.get(BYPASS_HEADER)).toBeTruthy();
    expect(sent.has("x-middleware-subrequest")).toBe(false);
    expect(sent.has("next-url")).toBe(false);
    expect(sent.has("host")).toBe(false);
  });

  it("skips the check on its own internal render, and only with the right secret", async () => {
    lookup.mockResolvedValue("gone");
    render.mockImplementation(async () => htmlResponse(SOFT_404));
    const run = check();
    await run(
      req("https://shop.example/nz/en/products/old-bottle"),
      baseResponse(),
    );
    const secret = render.mock.calls[0][1].get(BYPASS_HEADER) as string;
    lookup.mockClear();

    const base = baseResponse();
    const inner = await run(
      req("https://shop.example/nz/en/products/another-gone", {
        headers: { [BYPASS_HEADER]: secret },
      }),
      base,
    );
    expect(inner).toBe(base);
    expect(lookup).not.toHaveBeenCalled();

    const forged = await run(
      req("https://shop.example/nz/en/products/another-gone", {
        headers: { [BYPASS_HEADER]: "guess" },
      }),
      baseResponse(),
    );
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(forged.status).toBe(404);
  });

  it("answers a HEAD with a bare 404 and renders nothing", async () => {
    lookup.mockResolvedValue("gone");
    const out = await check()(
      req("https://shop.example/nz/en/products/old-bottle", { method: "HEAD" }),
      baseResponse(),
    );
    expect(out.status).toBe(404);
    expect(render).not.toHaveBeenCalled();
  });

  it("falls back to today's response when the rendered page does not say noindex", async () => {
    lookup.mockResolvedValue("gone");
    render.mockImplementation(async () => htmlResponse(PRODUCT_PAGE));
    const base = baseResponse();
    expect(
      await check()(
        req("https://shop.example/nz/en/products/back-again"),
        base,
      ),
    ).toBe(base);
  });

  it("falls back when the internal render fails, errors or is not a page", async () => {
    lookup.mockResolvedValue("gone");
    for (const outcome of [
      () => Promise.reject(new Error("ECONNREFUSED")),
      () => Promise.resolve(htmlResponse(SOFT_404, 500)),
      () => Promise.resolve(htmlResponse("", 307)),
      () =>
        Promise.resolve(
          new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
    ]) {
      render.mockImplementationOnce(outcome);
      const base = baseResponse();
      expect(
        await check()(
          req("https://shop.example/nz/en/products/old-bottle"),
          base,
        ),
      ).toBe(base);
    }
  });

  it("lets the request through when the answer is unknown, and asks again next time", async () => {
    lookup.mockResolvedValue("unknown");
    const run = check();
    const base = baseResponse();
    expect(
      await run(req("https://shop.example/nz/en/products/steel-bottle"), base),
    ).toBe(base);
    await run(
      req("https://shop.example/nz/en/products/steel-bottle"),
      baseResponse(),
    );
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(render).not.toHaveBeenCalled();
  });

  it("treats a lookup that throws as unknown", async () => {
    lookup.mockRejectedValue(new Error("boom"));
    const base = baseResponse();
    expect(
      await check()(
        req("https://shop.example/nz/en/products/steel-bottle"),
        base,
      ),
    ).toBe(base);
  });

  it("keeps a found answer for 30 minutes and a gone one for 5", async () => {
    const run = check();
    lookup.mockResolvedValue("found");
    await run(
      req("https://shop.example/nz/en/products/steel-bottle"),
      baseResponse(),
    );
    clock += 29 * 60_000;
    await run(
      req("https://shop.example/nz/en/products/steel-bottle"),
      baseResponse(),
    );
    expect(lookup).toHaveBeenCalledTimes(1);
    clock += 2 * 60_000;
    await run(
      req("https://shop.example/nz/en/products/steel-bottle"),
      baseResponse(),
    );
    expect(lookup).toHaveBeenCalledTimes(2);

    lookup.mockClear();
    lookup.mockResolvedValue("gone");
    render.mockImplementation(async () => htmlResponse(SOFT_404));
    await run(
      req("https://shop.example/nz/en/products/old-bottle"),
      baseResponse(),
    );
    clock += 4 * 60_000;
    await run(
      req("https://shop.example/nz/en/products/old-bottle"),
      baseResponse(),
    );
    expect(lookup).toHaveBeenCalledTimes(1);
    clock += 2 * 60_000;
    await run(
      req("https://shop.example/nz/en/products/old-bottle"),
      baseResponse(),
    );
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("keeps markets apart: the same slug in two countries is two questions", async () => {
    lookup.mockResolvedValue("found");
    const run = check();
    await run(
      req("https://shop.example/nz/en/products/steel-bottle"),
      baseResponse(),
    );
    await run(
      req("https://shop.example/au/en/products/steel-bottle"),
      baseResponse(),
    );
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("asks once when many visitors arrive at the same moment", async () => {
    let answer: (v: Verdict) => void = () => {};
    lookup.mockImplementation(
      () => new Promise<Verdict>((resolve) => (answer = resolve)),
    );
    const run = check();
    const all = Array.from({ length: 5 }, () =>
      run(
        req("https://shop.example/nz/en/products/steel-bottle"),
        baseResponse(),
      ),
    );
    answer("found");
    await Promise.all(all);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("forgets the oldest answer once it holds a thousand", async () => {
    lookup.mockResolvedValue("found");
    const run = check();
    for (let i = 0; i <= 1000; i++) {
      await run(
        req(`https://shop.example/nz/en/products/p-${i}`),
        baseResponse(),
      );
    }
    expect(lookup).toHaveBeenCalledTimes(1001);
    await run(
      req("https://shop.example/nz/en/products/p-1000"),
      baseResponse(),
    );
    expect(lookup).toHaveBeenCalledTimes(1001);
    await run(req("https://shop.example/nz/en/products/p-0"), baseResponse());
    expect(lookup).toHaveBeenCalledTimes(1002);
  });

  it("does nothing at all on a shop that requires an account", async () => {
    const base = baseResponse();
    expect(
      await check(false)(
        req("https://shop.example/nz/en/products/old-bottle"),
        base,
      ),
    ).toBe(base);
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("the question it asks the API", () => {
  const saved = process.env.SPREE_API_LOCALE;

  beforeEach(() => {
    productsGet.mockReset();
    delete process.env.SPREE_API_LOCALE;
  });
  afterEach(() => {
    vi.useRealTimers();
    if (saved === undefined) delete process.env.SPREE_API_LOCALE;
    else process.env.SPREE_API_LOCALE = saved;
  });

  async function verdict(slug = "steel-bottle", url?: string) {
    const render = vi.fn(async () => htmlResponse(SOFT_404));
    const out = await createGoneProductCheck({ enabled: true, render })(
      req(url ?? `https://shop.example/nz/en/products/${slug}`),
      NextResponse.next(),
    );
    return out.status === 404 ? "gone" : "not gone";
  }

  it("calls a product gone only on 404 with record_not_found", async () => {
    productsGet.mockRejectedValue({ status: 404, code: "record_not_found" });
    expect(await verdict("a")).toBe("gone");
    expect(productsGet).toHaveBeenCalledWith("a", undefined, {
      locale: "en",
      country: "nz",
    });
  });

  it("does not trust any other failure", async () => {
    for (const [i, error] of [
      { status: 404, code: "not_found" },
      { status: 404 },
      { status: 401, code: "invalid_token" },
      { status: 500, code: "internal_error" },
      new Error("fetch failed"),
    ].entries()) {
      productsGet.mockRejectedValueOnce(error);
      expect(await verdict(`b-${i}`)).toBe("not gone");
    }
  });

  it("calls a product that answers found", async () => {
    productsGet.mockResolvedValue({ id: "prod_1", slug: "c" });
    expect(await verdict("c")).toBe("not gone");
  });

  it("gives up after two seconds and lets the page through", async () => {
    vi.useFakeTimers();
    productsGet.mockImplementation(() => new Promise(() => {}));
    const pending = verdict("d");
    await vi.advanceTimersByTimeAsync(2001);
    expect(await pending).toBe("not gone");
  });

  it("asks in the API locale when the shop overrides it, as the page does", async () => {
    process.env.SPREE_API_LOCALE = "en-AU";
    productsGet.mockResolvedValue({ id: "prod_1" });
    await verdict("e", "https://shop.example/au/en/products/e");
    expect(productsGet).toHaveBeenCalledWith("e", undefined, {
      locale: "en-AU",
      country: "au",
    });
  });
});
