import { describe, expect, it } from "vitest";
import {
  type CategoryFacts,
  decideHomeCategories,
  homeCategories,
  type SubcategoryFacts,
} from "@/lib/blocks/home-eligibility";

const sub = (
  activeProducts: number,
  views90d?: number,
  active = true,
): SubcategoryFacts => ({
  active,
  activeProducts,
  ...(views90d === undefined ? {} : { views90d }),
});

const big = (views?: number): SubcategoryFacts[] => [
  sub(4, views),
  sub(4, views),
  sub(4, views),
  sub(4, views),
];

function cat(name: string, over: Partial<CategoryFacts> = {}): CategoryFacts {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    permalink: name.toLowerCase().replace(/\s+/g, "-"),
    active: true,
    override: false,
    position: "automatic",
    subcategories: big(),
    ...over,
  };
}

describe("his eligibility rules", () => {
  it("needs 4 subcategories with 4 active products each", () => {
    const three = cat("Three", { subcategories: [sub(4), sub(4), sub(4)] });
    const thin = cat("Thin", {
      subcategories: [sub(4), sub(4), sub(4), sub(3)],
    });
    const ok = cat("Ok");
    expect(homeCategories([three, thin, ok]).map((c) => c.name)).toEqual([
      "Ok",
    ]);
  });

  it("does not count an unpublished subcategory", () => {
    const c = cat("Hidden sub", {
      subcategories: [sub(4), sub(4), sub(4), sub(9, undefined, false)],
    });
    expect(homeCategories([c])).toEqual([]);
  });

  it("shows at most 6", () => {
    const many = Array.from({ length: 9 }, (_, i) => cat(`C${i}`));
    expect(homeCategories(many)).toHaveLength(6);
  });

  it("ranks by views over 90 days, highest first", () => {
    const low = cat("Low", { subcategories: big(1) });
    const high = cat("High", { subcategories: big(50) });
    expect(homeCategories([low, high]).map((c) => c.name)).toEqual([
      "High",
      "Low",
    ]);
  });

  it("falls back to product count until views exist, and views always win", () => {
    const counted = cat("Counted", { subcategories: big(0) });
    const bigger = cat("Bigger", {
      subcategories: [sub(10), sub(10), sub(10), sub(10)],
    });
    const smaller = cat("Smaller");
    expect(
      homeCategories([smaller, bigger, counted]).map((c) => c.name),
    ).toEqual(["Counted", "Bigger", "Smaller"]);
  });
});

describe("the manual override", () => {
  it("shows a category too small for the rules", () => {
    const young = cat("Drinkware", { override: true, subcategories: [sub(1)] });
    expect(homeCategories([young]).map((c) => c.name)).toEqual(["Drinkware"]);
  });

  it("never shows an unpublished category, override or not", () => {
    const off = cat("Off", { active: false, override: true, position: 1 });
    const [d] = decideHomeCategories([off]);
    expect(d.status).toBe("unpublished");
    expect(d.reason).toContain("never shows an unpublished category");
  });

  it("puts his launch example in his order", () => {
    const tiny = [sub(2)];
    const page = homeCategories([
      cat("Hospitality", { override: true, position: 3, subcategories: tiny }),
      cat("Drinkware", { override: true, position: 1, subcategories: tiny }),
      cat("Food Storage", { override: true, position: 2, subcategories: tiny }),
      cat("Popular", { subcategories: big(500) }),
    ]);
    expect(page.map((c) => c.name)).toEqual([
      "Drinkware",
      "Food Storage",
      "Hospitality",
      "Popular",
    ]);
  });

  it("lets a pinned category keep its slot while automatic ones fill around it", () => {
    const page = homeCategories([
      cat("A", { subcategories: big(30) }),
      cat("Pinned", { position: 2, subcategories: big(1) }),
      cat("B", { subcategories: big(20) }),
    ]);
    expect(page.map((c) => c.name)).toEqual(["A", "Pinned", "B"]);
  });

  it("gives a contested position to the one with more interest", () => {
    const decisions = decideHomeCategories([
      cat("Quiet", { position: 1, subcategories: big(2) }),
      cat("Busy", { position: 1, subcategories: big(9) }),
    ]);
    expect(decisions.map((d) => [d.category.name, d.slot])).toEqual([
      ["Busy", 1],
      ["Quiet", 2],
    ]);
    expect(decisions[1].reason).toContain("ranked automatically");
  });

  it("does not let a position alone show a category that is too small", () => {
    const d = decideHomeCategories([
      cat("Small", { position: 1, subcategories: [sub(1)] }),
    ]);
    expect(d[0].status).toBe("not_eligible");
  });
});

describe("the admin line", () => {
  it("says why, in his wording", () => {
    const [d] = decideHomeCategories([
      cat("Drinkware", {
        override: true,
        subcategories: [sub(4), sub(4), sub(1)],
      }),
    ]);
    expect(d.reason).toBe(
      "Homepage status: Position 1, Manual Override. Normal eligibility: Not yet eligible (2 of 4 required subcategories).",
    );
  });

  it("explains an eligible category that missed the top 6", () => {
    const seven = Array.from({ length: 7 }, (_, i) =>
      cat(`C${i}`, { subcategories: big(10 - i) }),
    );
    const last = decideHomeCategories(seven).find(
      (d) => d.category.name === "C6",
    );
    expect(last?.status).toBe("eligible_not_in_top");
  });
});
