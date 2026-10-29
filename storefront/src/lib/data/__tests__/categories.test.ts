import { beforeEach, describe, expect, it, vi } from "vitest";

const listCategories = vi.fn();

vi.mock("@/lib/spree", () => ({
  getClient: () => ({ categories: { list: listCategories } }),
  getAccessToken: vi.fn(),
  getLocaleOptions: vi.fn().mockResolvedValue({ country: "nz", locale: "en" }),
}));

vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

import { getCategories } from "@/lib/data/categories";

describe("getCategories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listCategories.mockResolvedValue({ data: [] });
  });

  // Unsorted, the Store API returns categories in whatever order Postgres
  // reads them, so the menu reshuffled after every edit to the tree.
  it("asks for the dashboard's order when the caller names none", async () => {
    await getCategories({ depth_eq: 0 });

    expect(listCategories).toHaveBeenCalledWith(
      { sort: "lft", depth_eq: 0 },
      { country: "nz", locale: "en" },
    );
  });

  it("keeps a sort the caller asks for", async () => {
    await getCategories({ sort: "name" });

    expect(listCategories).toHaveBeenCalledWith(
      { sort: "name" },
      { country: "nz", locale: "en" },
    );
  });
});
