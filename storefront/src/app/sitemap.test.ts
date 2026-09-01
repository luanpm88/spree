import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  marketsList: vi.fn(),
  productsList: vi.fn(),
  categoriesList: vi.fn(),
}));

/**
 * The addresses that are neither a product nor a category are pinned here.
 *
 * They used to be a hardcoded 3 inside sitemap.ts. They are now computed from
 * the shop's own content pages and from the policies the Store API reports, and
 * both of those differ per shop: pageSlugs() reads a file that is gitignored, so
 * left unmocked this test's arithmetic would depend on which shop's copy happens
 * to be checked out, and would pass or fail by machine.
 *
 * One page and no policy keeps the static count at 3 so that every chunk
 * expectation below still means what it meant when it was written. The policy
 * and page behaviour is covered by its own test at the end of this file, where
 * the numbers are small enough to read.
 */
vi.mock("@/lib/blocks/pages", () => ({ pageSlugs: () => ["about"] }));
vi.mock("@/lib/data/policies", () => ({ getPolicies: async () => [] }));

vi.mock("@/lib/data/sitemap", () => ({
  getSitemapMarkets: async (options: { country: string; locale: string }) =>
    (await api.marketsList(options)).data,
  getSitemapResourceCount: async (
    resource: "products" | "categories",
    _marketId: string,
    options: { country: string; locale: string },
  ) => {
    const response = await (resource === "products"
      ? api.productsList({ page: 1, limit: 1 }, options)
      : api.categoriesList(
          { page: 1, limit: 1, parent_id_not_null: true },
          options,
        ));
    return response.meta.count;
  },
  getSitemapProductPage: async (
    _marketId: string,
    page: number,
    limit: number,
    options: { country: string; locale: string },
  ) =>
    (await api.productsList({ page, limit, expand: ["media"] }, options)).data,
  getSitemapCategoryPage: async (
    _marketId: string,
    page: number,
    limit: number,
    options: { country: string; locale: string },
  ) =>
    (
      await api.categoriesList(
        { page, limit, parent_id_not_null: true },
        options,
      )
    ).data,
}));

const store = vi.hoisted(() => ({ accountRequired: false, cleanUrls: false }));

vi.mock("@/lib/store", () => ({
  getDefaultCountry: () => "us",
  getDefaultLocale: () => "en",
  getStoreUrl: () => "https://store.example",
  isAccountRequired: () => store.accountRequired,
  cleanUrlsEnabled: () => store.cleanUrls,
}));

function marketCountries(...isos: string[]) {
  return [
    {
      id: "market-1",
      default: true,
      default_locale: "en",
      supported_locales: ["en"],
      countries: isos.map((iso) => ({ iso })),
    },
  ];
}

function mockCatalog(productCount: number, categoryCount: number): void {
  api.productsList.mockImplementation(
    async ({ page, limit }: { page: number; limit: number }) => {
      if (limit === 1) {
        return { data: [], meta: { count: productCount } };
      }

      return {
        data: Array.from({ length: limit }, (_, index) => ({
          id: `product-${(page - 1) * limit + index}`,
          slug: `p-${(page - 1) * limit + index}`,
        })),
        meta: { count: productCount },
      };
    },
  );
  api.categoriesList.mockImplementation(
    async ({ page, limit }: { page: number; limit: number }) => {
      if (limit === 1) {
        return { data: [], meta: { count: categoryCount } };
      }

      return {
        data: Array.from({ length: limit }, (_, index) => ({
          id: `category-${(page - 1) * limit + index}`,
          permalink: `c-${(page - 1) * limit + index}`,
          is_root: false,
        })),
        meta: { count: categoryCount },
      };
    },
  );
}

describe("localized sitemap generation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("reuses translated catalog pages across countries with the same locale", async () => {
    api.marketsList.mockResolvedValue({ data: marketCountries("US", "CA") });
    mockCatalog(2, 1);
    const { default: sitemap } = await import("@/app/sitemap");

    const entries = await sitemap({ id: Promise.resolve("0") });

    expect(entries).toHaveLength(12);
    expect(entries.map((entry) => entry.url)).toEqual(
      expect.arrayContaining([
        "https://store.example/us/en/products/p-0",
        "https://store.example/ca/en/products/p-0",
        "https://store.example/us/en/c/c-0",
        "https://store.example/ca/en/c/c-0",
      ]),
    );
    expect(
      api.productsList.mock.calls.filter(([params]) => params.limit === 100),
    ).toHaveLength(1);
    expect(
      api.categoriesList.mock.calls.filter(([params]) => params.limit === 100),
    ).toHaveLength(1);
  });

  it("calculates sitemap files from locale counts without loading catalog pages", async () => {
    api.marketsList.mockResolvedValue({ data: marketCountries("US", "CA") });
    mockCatalog(30_000, 0);
    const { generateSitemaps } = await import("@/app/sitemap");

    await expect(generateSitemaps()).resolves.toEqual(
      Array.from({ length: 7 }, (_, id) => ({ id })),
    );
    expect(
      api.productsList.mock.calls.filter(([params]) => params.limit === 100),
    ).toHaveLength(0);
    expect(
      api.categoriesList.mock.calls.filter(([params]) => params.limit === 100),
    ).toHaveLength(0);
  });

  it("loads only API pages intersecting the requested sitemap chunk", async () => {
    api.marketsList.mockResolvedValue({ data: marketCountries("US", "CA") });
    mockCatalog(30_000, 0);
    const { default: sitemap } = await import("@/app/sitemap");

    const entries = await sitemap({ id: Promise.resolve("1") });
    const loadedPages = api.productsList.mock.calls
      .filter(([params]) => params.limit === 100)
      .map(([params]) => params.page);

    expect(entries).toHaveLength(10_000);
    expect(entries[0]?.url).toBe("https://store.example/us/en/products/p-9997");
    expect(entries.at(-1)?.url).toBe(
      "https://store.example/us/en/products/p-19996",
    );
    expect(Math.min(...loadedPages)).toBe(100);
    expect(Math.max(...loadedPages)).toBe(200);
    expect(loadedPages).toHaveLength(101);
  });

  it("keeps inventories isolated when Markets share the same locale", async () => {
    api.marketsList.mockResolvedValue({
      data: [
        ...marketCountries("US"),
        {
          ...marketCountries("AS")[0],
          id: "market-2",
          default: false,
        },
      ],
    });
    api.productsList.mockImplementation(
      async (
        { page, limit }: { page: number; limit: number },
        { country }: { country: string },
      ) => {
        const count = country === "us" ? 2 : 0;
        return {
          data:
            limit === 1
              ? []
              : Array.from({ length: count }, (_, index) => ({
                  id: `product-${page}-${index}`,
                  slug: `us-product-${index}`,
                })),
          meta: { count },
        };
      },
    );
    api.categoriesList.mockImplementation(async () => ({
      data: [],
      meta: { count: 0 },
    }));
    const { default: sitemap } = await import("@/app/sitemap");

    const entries = await sitemap({ id: Promise.resolve("0") });
    const urls = entries.map((entry) => entry.url);

    expect(urls).toContain("https://store.example/us/en/products/us-product-0");
    expect(urls).not.toContain(
      "https://store.example/as/en/products/us-product-0",
    );
    expect(entries).toHaveLength(8);
    expect(
      api.productsList.mock.calls.filter(([params]) => params.limit === 1),
    ).toHaveLength(2);
  });

  it("does not retain process-level catalog pages across sitemap requests", async () => {
    api.marketsList.mockResolvedValue({ data: marketCountries("US") });
    mockCatalog(1, 0);
    const { default: sitemap } = await import("@/app/sitemap");

    await sitemap({ id: Promise.resolve("0") });
    await sitemap({ id: Promise.resolve("0") });

    expect(
      api.productsList.mock.calls.filter(([params]) => params.limit === 100),
    ).toHaveLength(2);
  });

  it("keeps categories when a product page request fails", async () => {
    api.marketsList.mockResolvedValue({ data: marketCountries("US") });
    api.productsList.mockImplementation(
      async ({ limit }: { limit: number }) => {
        if (limit === 1) return { data: [], meta: { count: 1 } };
        throw new Error("products unavailable");
      },
    );
    api.categoriesList.mockImplementation(
      async ({ limit }: { limit: number }) => ({
        data:
          limit === 1
            ? []
            : [{ id: "category-1", permalink: "coffee", is_root: false }],
        meta: { count: 1 },
      }),
    );
    const { default: sitemap } = await import("@/app/sitemap");

    const entries = await sitemap({ id: Promise.resolve("0") });

    expect(entries.map((entry) => entry.url)).toContain(
      "https://store.example/us/en/c/coffee",
    );
    expect(entries.some((entry) => entry.url.includes("/products/p-"))).toBe(
      false,
    );
  });

  /**
   * What the static half of the sitemap actually advertises.
   *
   * This half was a hardcoded 3 and two of the three facts behind that number
   * were wrong, which nothing here could see: /c was listed and answers 404, and
   * the content pages and policies were listed nowhere at all. The count also
   * feeds the chunk arithmetic above, so a wrong number does not merely
   * advertise the wrong address, it drops real entries off the end of a chunk.
   *
   * This test re-mocks the two sources with a set it can read, so it asserts on
   * the addresses themselves rather than on a total.
   */
  it("advertises the content pages and the policies, and no categories index", async () => {
    vi.doMock("@/lib/blocks/pages", () => ({
      pageSlugs: () => ["about", "faq"],
    }));
    vi.doMock("@/lib/data/policies", () => ({
      getPolicies: async () => [
        { slug: "privacy-policy", name: "Privacy Policy" },
        { slug: "shipping-policy", name: "Shipping Policy" },
      ],
    }));

    api.marketsList.mockResolvedValue({ data: marketCountries("US") });
    mockCatalog(0, 0);
    const { default: sitemap } = await import("@/app/sitemap");

    const urls = (await sitemap({ id: Promise.resolve("0") })).map(
      (entry) => entry.url,
    );

    expect(urls).toEqual(
      expect.arrayContaining([
        "https://store.example/us/en",
        "https://store.example/us/en/products",
        "https://store.example/us/en/pages/about",
        "https://store.example/us/en/pages/faq",
        "https://store.example/us/en/policies/privacy-policy",
        "https://store.example/us/en/policies/shipping-policy",
      ]),
    );

    // /c has no page in this storefront. It was advertised for months and
    // answered 404 to anything that followed it.
    expect(urls).not.toContain("https://store.example/us/en/c");
    expect(urls.filter((url) => url.endsWith("/c"))).toHaveLength(0);

    vi.doUnmock("@/lib/blocks/pages");
    vi.doUnmock("@/lib/data/policies");
  });

  /**
   * A crawler never signs in, so anything a sitemap lists is public forever:
   * a search engine that has read the file keeps the addresses whether or not
   * the file is corrected afterwards.
   *
   * The wholesale shop's requirement is that a URL shows nothing to someone
   * without an account. Publishing every one of those URLs in a machine
   * readable list defeats it more completely than any single page could.
   */
  it("publishes nothing at all for a shop that requires an account", async () => {
    store.accountRequired = true;
    try {
      api.marketsList.mockResolvedValue({ data: marketCountries("US") });
      mockCatalog(500, 20);
      const { default: sitemap, generateSitemaps } = await import(
        "@/app/sitemap"
      );

      expect(await generateSitemaps()).toEqual([]);
      expect(await sitemap({ id: Promise.resolve("0") })).toEqual([]);
      expect(api.productsList).not.toHaveBeenCalled();
    } finally {
      store.accountRequired = false;
    }
  });

  it("rejects invalid sitemap chunk identifiers before loading data", async () => {
    const { default: sitemap } = await import("@/app/sitemap");

    await expect(sitemap({ id: Promise.resolve("-1") })).resolves.toEqual([]);
    await expect(sitemap({ id: Promise.resolve("invalid") })).resolves.toEqual(
      [],
    );
    expect(api.marketsList).not.toHaveBeenCalled();
  });
});
