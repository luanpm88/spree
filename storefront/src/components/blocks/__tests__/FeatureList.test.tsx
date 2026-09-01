import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FeatureList } from "@/components/blocks/FeatureList";

/**
 * The block the four business pages are built from.
 *
 * The strings here are fixtures, not his copy. His words live in content.ts,
 * which is gitignored because this repository is public.
 *
 * What is worth proving is the handful of decisions that are invisible in a
 * screenshot and wrong in a click: the list TYPE when the items are numbered,
 * the market in front of an internal href, and the button he has drawn but not
 * yet given an address to. Every one of those has already shipped wrong once on
 * this project, in another block.
 */
describe("FeatureList", () => {
  const items = [
    { title: "First", body: ["One line."] },
    { title: "Second", body: ["Another line."] },
    { title: "Third", body: ["A third line."] },
  ];

  it("renders the heading, the intro, every item and the footnote", () => {
    render(
      <FeatureList
        type="feature_list"
        heading="Group heading"
        intro={["Intro line."]}
        footnote="Small print."
        items={items}
        basePath="/b2b/en"
      />,
    );

    expect(screen.getByRole("heading", { name: "Group heading" })).toBeDefined();
    expect(screen.getByText("Intro line.")).toBeDefined();
    expect(screen.getByText("Small print.")).toBeDefined();
    for (const item of items) {
      expect(screen.getByRole("heading", { name: item.title })).toBeDefined();
    }
  });

  // An ordered list, not a bulleted one with numbers drawn on it. The number is
  // the meaning of a process step, so it has to reach a screen reader as
  // ordering rather than as a decoration next to the words.
  it("uses an ordered list when the items are numbered", () => {
    const { container } = render(
      <FeatureList
        type="feature_list"
        numbered
        items={items}
        basePath="/b2b/en"
      />,
    );
    expect(container.querySelector("ol")).not.toBeNull();
    expect(container.querySelector("ul")).toBeNull();
  });

  it("uses a plain list when they are not", () => {
    const { container } = render(
      <FeatureList type="feature_list" items={items} basePath="/b2b/en" />,
    );
    expect(container.querySelector("ul")).not.toBeNull();
    expect(container.querySelector("ol")).toBeNull();
  });

  // basePath carries the country and the locale. A block that emits the bare
  // href sends a wholesale customer to a page outside their own market, which
  // on this shop means straight back out through the gate to the sign-in page.
  // It looks right in a screenshot and is wrong on the click.
  it("puts the market in front of an internal href", () => {
    render(
      <FeatureList
        type="feature_list"
        items={[
          {
            title: "Linked",
            cta: { label: "Go", href: "/pages/custom-branding" },
          },
        ]}
        basePath="/b2b/en"
      />,
    );
    expect(screen.getByRole("link", { name: "Go" }).getAttribute("href")).toBe(
      "/b2b/en/pages/custom-branding",
    );
  });

  it("leaves an outside address alone", () => {
    render(
      <FeatureList
        type="feature_list"
        items={[
          { title: "Away", cta: { label: "Out", href: "https://example.com/x" } },
        ]}
        basePath="/b2b/en"
      />,
    );
    expect(screen.getByRole("link", { name: "Out" }).getAttribute("href")).toBe(
      "https://example.com/x",
    );
  });

  // Four buttons on the tracking page are drawn and have no address yet: the
  // MyProjects sign-in and the three freight carriers. They must be visible,
  // because a row without its button is not his row, and they must not be
  // clickable, because a button that goes nowhere sends someone to the shop's
  // own front page wondering where their shipment went.
  it("shows a button with no address as present and not clickable", () => {
    render(
      <FeatureList
        type="feature_list"
        items={[{ title: "Pending", cta: { label: "Track", href: "" } }]}
        basePath="/b2b/en"
      />,
    );

    expect(screen.getByText("Track")).toBeDefined();
    expect(screen.queryByRole("link", { name: "Track" })).toBeNull();
    expect(screen.getByText("Track").getAttribute("aria-disabled")).toBe("true");
  });

  // A heading and an intro with no items is a real shape on these pages: four
  // of the groups he wrote are a heading over two or three paragraphs. They were
  // rich_text at first, which put an h1 half way down the page in a narrower
  // centred column, so the alignment jumped twice per page.
  it("renders a heading and an intro with no items, and no empty list", () => {
    const { container } = render(
      <FeatureList
        type="feature_list"
        heading="Just prose"
        intro={["A paragraph."]}
        items={[]}
        basePath="/b2b/en"
      />,
    );
    expect(screen.getByRole("heading", { name: "Just prose" })).toBeDefined();
    expect(screen.getByText("A paragraph.")).toBeDefined();
    expect(container.querySelector("ul")).toBeNull();
    expect(container.querySelector("ol")).toBeNull();
  });

  it("renders nothing at all when there is nothing to render", () => {
    const { container } = render(
      <FeatureList type="feature_list" items={[]} basePath="/b2b/en" />,
    );
    expect(container.innerHTML).toBe("");
  });
});


describe("TextImage, a block with only a picture in it", () => {
  // His tracking page asks for the diagram "full content width, immediately
  // below the introduction". Built as an ordinary text_image it drew into half
  // the page beside a blank column. The rule is keyed on there being no words at
  // all, so this also proves an ordinary hero is untouched: every other block
  // carries a heading or a paragraph.
  it("draws one column when there are no words, and two when there are", async () => {
    const { TextImage } = await import("@/components/blocks/TextImage");
    const image = { src: "/brand/x.png", alt: "A diagram", width: 100, height: 50 };

    const alone = render(
      <TextImage type="text_image" body={[]} image={image} basePath="/b2b/en" />,
    );
    expect(alone.container.querySelector(".md\\:grid-cols-1")).not.toBeNull();
    expect(alone.container.querySelector(".md\\:grid-cols-2")).toBeNull();
    alone.unmount();

    const withWords = render(
      <TextImage
        type="text_image"
        heading="Hero"
        body={["A line."]}
        image={image}
        basePath="/b2b/en"
      />,
    );
    expect(withWords.container.querySelector(".md\\:grid-cols-2")).not.toBeNull();
  });
});

describe("Inline, a link whose label carries its own markers", () => {
  // 25 links across the estate are written [**words**](url) and every one of
  // them printed its asterisks to the customer, because the label was rendered
  // as a plain string: "Please visit our **<the shops page>**." with the
  // stars visible, on his FAQ pages.
  it("renders bold inside a link label rather than printing the markers", async () => {
    const { Inline } = await import("@/components/blocks/Inline");
    render(<Inline text="Visit [**the shop map**](https://example.com) today." />);

    const link = screen.getByRole("link", { name: "the shop map" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.querySelector("strong")?.textContent).toBe("the shop map");
    expect(screen.queryByText(/\*\*/)).toBeNull();
  });

  it("leaves a plain label alone", async () => {
    const { Inline } = await import("@/components/blocks/Inline");
    render(<Inline text="Visit [the shop map](https://example.com) today." />);
    const link = screen.getByRole("link", { name: "the shop map" });
    expect(link.querySelector("strong")).toBeNull();
  });
});

describe("Faq, a heading inside an answer", () => {
  // Six lines on one shop's FAQ are written "## Something" and every one printed
  // its hashes to the customer: the branch did not exist and the line fell
  // through to an ordinary paragraph.
  it("renders a ## line as a heading rather than as text with hashes in it", async () => {
    const { Faq } = await import("@/components/blocks/Faq");
    render(
      <Faq
        type="faq"
        sections={[
          {
            items: [
              { question: "A question?", answer: ["## A heading", "Some prose."] },
            ],
          },
        ]}
      />,
    );
    expect(screen.queryByText(/^##/)).toBeNull();
    expect(screen.getByText("A heading")).toBeDefined();
    expect(screen.getByText("Some prose.")).toBeDefined();
  });
});
