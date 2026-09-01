import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Enquiry } from "@/components/blocks/Enquiry";

/**
 * The block that stands where the subscribe box stands on the retail shops.
 *
 * The home page test already proves this block is in the wholesale shop's list
 * and absent from the retail ones. What it cannot prove is that the thing
 * renders, and the part worth proving is the button: the whole point of the
 * block is that someone can ask for a product it does not carry, so a button
 * that renders without an href is the block failing while looking correct.
 *
 * The strings here are fixtures, not his copy. His words live in content.ts,
 * which is gitignored because this repository is public.
 */
describe("Enquiry", () => {
  const block = {
    type: "enquiry" as const,
    heading: "Heading",
    body: "Body line.",
    button: { label: "Contact", href: "/contact" },
  };

  it("renders the heading, the body and a button that goes somewhere", () => {
    render(<Enquiry {...block} basePath="/b2b/en" />);

    expect(screen.getByRole("heading", { name: "Heading" })).toBeDefined();
    expect(screen.getByText("Body line.")).toBeDefined();

    const link = screen.getByRole("link", { name: "Contact" });
    expect(link.getAttribute("href")).toBe("/b2b/en/contact");
  });

  // basePath carries the country and the locale. A block that emits the bare
  // href sends a wholesale customer to a page outside their own market, which
  // on this shop means straight back out through the gate to the sign-in page.
  it("puts the market in front of the href rather than emitting it bare", () => {
    render(<Enquiry {...block} basePath="/nz/en" />);

    expect(
      screen.getByRole("link", { name: "Contact" }).getAttribute("href"),
    ).toBe("/nz/en/contact");
  });

  // His copy is pulled off his live site and carries ** and link markers. A
  // block that prints a plain string prints those markers to a customer, which
  // has already happened here once on the notice block.
  it("formats his inline markers rather than printing them", () => {
    render(
      <Enquiry
        {...block}
        body="Ask us about **bulk** orders."
        basePath="/b2b/en"
      />,
    );

    expect(screen.queryByText(/\*\*/)).toBeNull();
    expect(screen.getByText("bulk").tagName).toBe("STRONG");
  });

  // The tracking page draws an Open MyProjects button and his copy never says
  // where it goes. Rendered as a Link anyway this emitted <a href="">, a live
  // link to the page you are already on, so a customer looking for their order
  // clicked it and the page reloaded.
  it("shows a button with no address as present and not clickable", () => {
    render(
      <Enquiry
        type="enquiry"
        heading="Access MyProjects"
        body="Use the link in your order email."
        button={{ label: "Open MyProjects", href: "" }}
        basePath="/b2b/en"
      />,
    );

    expect(screen.getByText("Open MyProjects")).toBeDefined();
    expect(screen.queryByRole("link", { name: "Open MyProjects" })).toBeNull();
    expect(screen.getByText("Open MyProjects").getAttribute("aria-disabled")).toBe(
      "true",
    );
  });
});
