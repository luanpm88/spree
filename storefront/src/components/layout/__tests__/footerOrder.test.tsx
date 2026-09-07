import type { Category } from "@spree/sdk";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/layout/footerLivery", () => ({
  livery: () => ({ link: "" }),
  LIVERY: { business: { link: "", heading: "" } },
}));

import { FooterCategoryLinks } from "@/components/layout/Footer";

const cat = (name: string): Category =>
  ({ id: name, name, permalink: name.toLowerCase() }) as unknown as Category;

/**
 * The order of the two lists in the footer.
 *
 * ── the fault this exists for ───────────────────────────────────────────────
 *
 * The business footer was built from his artwork and shipped, and he checked it
 * against the design line by line:
 *
 *   "The category list is not in the order of the image provided."
 *   "The polices MUST go in the right order"
 *
 * Both were right. The categories came out in whatever order the shop returned
 * and the policies in whatever order the database did, and neither matched the
 * sequence he had drawn. Nothing errored, every test passed, and the page looked
 * finished, which is exactly why he had to be the one to find it.
 *
 * Order is not something a screenshot check catches by glancing. It is a list
 * compared item by item against his artwork, so it is compared here instead.
 */
describe("footer category order", () => {
  const shop = [
    cat("Healthcare"),
    cat("Travel & Lifestyle"),
    cat("Drinkware"),
    cat("Food Storage"),
    cat("Pet Care"),
  ];

  it("follows the sequence he drew, not the one the shop returns", () => {
    render(
      <ul>
        <FooterCategoryLinks
          rootCategories={shop}
          basePath="/nz/en"
          order={["Drinkware", "Food Storage", "Travel & Lifestyle"]}
        />
      </ul>,
    );

    const shown = screen.getAllByRole("link").map((a) => a.textContent);
    expect(shown.slice(0, 3)).toEqual([
      "Drinkware",
      "Food Storage",
      "Travel & Lifestyle",
    ]);
  });

  it("keeps a category he never listed rather than dropping it", () => {
    // He wrote the list before some of these existed, and a category that
    // silently vanished from the footer would be a worse fault than one in the
    // wrong place. Healthcare and Pet Care are not on his artwork and are on
    // the shop.
    render(
      <ul>
        <FooterCategoryLinks
          rootCategories={shop}
          basePath="/nz/en"
          order={["Drinkware", "Food Storage", "Travel & Lifestyle"]}
        />
      </ul>,
    );

    const shown = screen.getAllByRole("link").map((a) => a.textContent);
    expect(shown).toHaveLength(shop.length);
    expect(shown).toContain("Healthcare");
    expect(shown).toContain("Pet Care");
    // And they follow the ones he did list, in their original relative order.
    expect(shown.slice(3)).toEqual(["Healthcare", "Pet Care"]);
  });

  it("leaves the other six shops exactly as their own shop returns them", () => {
    // No order passed means no sorting at all. Six shops share this component
    // and none of them asked for his sequence.
    render(
      <ul>
        <FooterCategoryLinks rootCategories={shop} basePath="/nz/en" />
      </ul>,
    );

    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(
      shop.map((c) => c.name),
    );
  });
});
