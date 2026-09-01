import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * His Resources page, read out of the shape he writes it in.
 *
 * ── why this exists ──────────────────────────────────────────────────────────
 *
 * He photographed our Resources page beside his on 20 Aug. His lays each
 * document out as a row with a button; ours printed all eleven of his lines as
 * paragraphs, "Download PDF" included, three times, as ordinary text.
 *
 * The cause was not styling. The downloads block had been declared in types.ts
 * from the start with no component behind it, so nothing could construct one and
 * every line fell through to rich text. Adding the component is half of it; the
 * other half is reading his flat copy into rows, which is what this covers.
 *
 * The fixtures below carry the SHAPE of his page and none of his words, because
 * content.ts is gitignored and this repository is public.
 */

const RESOURCES = {
  heading: "Resources",
  body: [
    "One line of introduction.",
    "Available Downloads",
    "First Document",
    "What the first document is.",
    "Download PDF",
    "Second Document",
    "What the second document is.",
    "Download PDF",
  ],
} as const;

let pages: Record<string, unknown> = {};
let newsletter: Record<string, unknown> = {};
vi.mock("@/lib/blocks/content", () => ({
  get PAGES_BY_SHOP() {
    return { b2b: pages };
  },
  get NEWSLETTER_BY_SHOP() {
    return newsletter;
  },
  get BOOKING_EMBED_BY_SHOP() {
    return {};
  },
}));

async function pageFor(slug: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_DEFAULT_COUNTRY", "b2b");
  const { contentPage } = await import("@/lib/blocks/pages");
  return contentPage(slug);
}

describe("the Resources page", () => {
  beforeEach(() => {
    pages = { resources: RESOURCES };
    newsletter = {};
  });

  it("splits his copy into prose and a list of documents", async () => {
    const page = await pageFor("resources");

    expect(page?.blocks.map((b) => b.type)).toEqual(["rich_text", "downloads"]);
  });

  it("keeps the introduction above the list and does not swallow it", async () => {
    const page = await pageFor("resources");
    const prose = page?.blocks[0];

    expect(prose?.type).toBe("rich_text");
    if (prose?.type !== "rich_text") return;
    expect(prose.body).toEqual(["One line of introduction."]);
  });

  it("reads each document as a title and a description, and drops the button label", async () => {
    const page = await pageFor("resources");
    const list = page?.blocks[1];

    expect(list?.type).toBe("downloads");
    if (list?.type !== "downloads") return;

    expect(list.heading).toBe("Available Downloads");
    expect(list.items).toEqual([
      { title: "First Document", description: "What the first document is." },
      { title: "Second Document", description: "What the second document is." },
    ]);
    // The words "Download PDF" are his label for the button, not a line of the
    // page. Printing them was the whole fault.
    expect(JSON.stringify(list.items)).not.toContain("Download PDF");
  });

  // He has not sent the files yet, so no row can carry a URL. A button with
  // nowhere to go is worse than no button, so the row renders without one.
  // A bare button label carries no URL, so the row renders without a live link.
  // That is the shape the plain-text dump of his page produces, because it
  // strips anchors.
  it("leaves the link off when the copy is only a label", async () => {
    const page = await pageFor("resources");
    const list = page?.blocks[1];
    if (list?.type !== "downloads") return;

    expect(list.items.every((i) => i.href === undefined)).toBe(true);
  });

  // And the shape that matters: the label written as a markdown link, which is
  // what script/pull_page_copy.py produces from his HTML and what his own page
  // actually contains.
  //
  // This test is here because the opposite was believed for a day and a half.
  // A comment in pages.ts asserted the URLs "are not in his copy" and that every
  // row therefore renders without its button "until he sends the three files".
  // His three files were public on his own CDN the whole time, and a message
  // asking him to send them was drafted twice.
  it("carries his URL when the button label is a link", async () => {
    pages = {
      resources: {
        heading: "Resources",
        body: [
          "One line of introduction.",
          "Available Downloads",
          "First Document",
          "What the first document is.",
          "[Download PDF](https://files.example/first.pdf)",
          "Second Document",
          "What the second document is.",
          "[Download PDF](https://files.example/second%20two.pdf)",
        ],
      },
    };

    const page = await pageFor("resources");
    const list = page?.blocks[1];
    expect(list?.type).toBe("downloads");
    if (list?.type !== "downloads") return;

    expect(list.items.map((i) => i.title)).toEqual([
      "First Document",
      "Second Document",
    ]);
    expect(list.items.map((i) => i.href)).toEqual([
      "https://files.example/first.pdf",
      // A percent encoded space survives intact. His third filename has a space
      // in it, and an unencoded one breaks the link parser and silently drops
      // the row back to having no button.
      "https://files.example/second%20two.pdf",
    ]);
    // The label is not left in the description or the title.
    expect(JSON.stringify(list.items)).not.toContain("Download PDF");
  });

  // A page whose copy has no button label at all is ordinary prose. Falling back
  // rather than producing an empty list is what stops a page he rewrites one
  // afternoon from rendering as a heading and nothing else.
  it("falls back to prose when his copy carries no documents", async () => {
    pages = {
      resources: { heading: "Resources", body: ["Just a paragraph."] },
    };
    const page = await pageFor("resources");

    expect(page?.blocks.map((b) => b.type)).toEqual(["rich_text"]);
  });
  // He carries a newsletter block on three of his content pages and not on the
  // others, and not on his front page, where his enquiry block stands instead.
  // Marked done once already with this missing, which is why it has a test.
  it("appends his newsletter to the pages that carry one and no others", async () => {
    newsletter = {
      b2b: {
        heading: "Stay Updated",
        body: "One line.",
        buttonLabel: "Get updates",
        onPages: ["resources"],
      },
    };
    pages = {
      resources: RESOURCES,
      other: { heading: "Other", body: ["A paragraph."] },
    };

    const withIt = await pageFor("resources");
    expect(withIt?.blocks.at(-1)?.type).toBe("subscribe");

    const withoutIt = await pageFor("other");
    expect(withoutIt?.blocks.some((b) => b.type === "subscribe")).toBe(false);
  });

  it("asks for an email and not a name, which is his retail ask", async () => {
    newsletter = {
      b2b: {
        heading: "Stay Updated",
        body: "One line.",
        buttonLabel: "Get updates",
        onPages: ["resources"],
      },
    };
    const page = await pageFor("resources");
    const block = page?.blocks.at(-1);
    if (block?.type !== "subscribe") return;
    expect(block.askForName).toBe(false);
  });
});
