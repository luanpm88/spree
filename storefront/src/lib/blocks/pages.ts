import {
  BOOKING_EMBED_BY_SHOP,
  NEWSLETTER_BY_SHOP,
  PAGES_BY_SHOP,
} from "@/lib/blocks/content";
import type {
  DownloadsBlock,
  FaqBlock,
  PageDefinition,
} from "@/lib/blocks/types";

/**
 * The content pages, as block lists, per shop.
 *
 * Same split as the home page: this file says which blocks a page has, and
 * content.ts says what they contain. Today every one is a single rich text
 * block, which is why the block count stayed at seven while the page count went
 * up. Pages are cheap; block types are not.
 *
 * The page SET is per shop, not only the words. One shop has about and faq,
 * another has those plus a buy-local page and a hidden thank-you page. A shop
 * that does not have a page returns a 404 rather than borrowing another shop's
 * copy, which is what the first build did: it served one country's FAQ, heading
 * and all, on another country's shop.
 */
function shopKey(): string {
  return (process.env.NEXT_PUBLIC_DEFAULT_COUNTRY || "").toLowerCase();
}

function pagesForShop() {
  return PAGES_BY_SHOP[shopKey()] ?? {};
}

export function pageSlugs(): string[] {
  return Object.keys(pagesForShop());
}

/**
 * Turn his flat FAQ copy into questions and answers.
 *
 * He writes it as one list: a section heading in capitals, then a line starting
 * "Q:", then however many lines answer it, then the next question. That is a
 * shape, not a mess, so it is parsed rather than asking him to retype 32
 * questions into a new format on every shop.
 *
 * A line counts as a section heading when it is entirely upper case. His are
 * "ORDERS, PAYMENTS & REFUNDS" and "SHIPPING & DELIVERY".
 */
function parseFaq(heading: string, body: readonly string[]): PageDefinition {
  const sections: FaqBlock["sections"] = [];
  let section: FaqBlock["sections"][number] | undefined;
  let item: { question: string; answer: string[] } | undefined;

  // Tested on the words, not the raw line. His headings and questions arrive
  // wrapped in bold markers now that the copy carries his formatting, and
  // "**ORDERS**" does not equal its own upper case, nor does it start with "Q:".
  const words = (line: string) =>
    line.replace(/\*\*/g, "").replace(/^-\s+/, "").trim();
  const isHeading = (line: string) => {
    const w = words(line);
    return w === w.toUpperCase() && /[A-Z]/.test(w) && !w.startsWith("Q:");
  };

  const openSection = () => {
    if (!section) {
      section = { items: [] };
      sections.push(section);
    }
    return section;
  };

  for (const line of body) {
    if (isHeading(line)) {
      item = undefined;
      section = { title: words(line), items: [] };
      sections.push(section);
      continue;
    }
    if (words(line).startsWith("Q:")) {
      // The question is a heading in the accordion, so it loses its markers. The
      // answer keeps them: his answers carry bold and links.
      item = { question: words(line).replace(/^Q:\s*/, ""), answer: [] };
      openSection().items.push(item);
      continue;
    }
    // Anything else belongs to the question above it. A stray line before the
    // first question would otherwise vanish, so it opens one of its own rather
    // than being dropped.
    if (item) {
      item.answer.push(line);
    } else {
      item = { question: line, answer: [] };
      openSection().items.push(item);
    }
  }

  return { name: heading, blocks: [{ type: "faq", heading, sections }] };
}

/**
 * Turn his flat Resources copy into a list of documents.
 *
 * Same reasoning as parseFaq. He writes the page as one run of lines: an
 * introduction, a section heading, then each document as three lines, its name,
 * a line about it, and the words "Download PDF". That is a shape, so it is read
 * rather than asking him to restructure a page he already wrote.
 *
 * He photographed ours beside his on 20 Aug. His has each document as a row with
 * a button on the right; ours printed all eleven lines as paragraphs, including
 * "Download PDF" three times as ordinary text. That was not a styling fault: the
 * downloads block had no component, so nothing could build one and every line
 * fell through to rich text.
 *
 * The lines before the section heading stay as prose above the list.
 *
 * A button line may carry its URL as a markdown link, and on his shop it does.
 * The comment that used to sit here said the opposite: that the URLs were not in
 * his copy because he attaches files in his page editor, so every row rendered
 * without a button "until he sends the three files". That was wrong on both
 * counts. His three files are plain href attributes in his own page and they
 * answer 200 from his CDN. What lost them was reading the page's plain-text dump
 * rather than its HTML, because the dump strips anchors and leaves the bare words
 * "Download PDF". A message asking him for files he published months ago was
 * drafted twice off the back of that sentence.
 */
function parseDownloads(
  heading: string,
  body: readonly string[],
): PageDefinition {
  const BUTTON = "download pdf";
  // A button line is either the bare label or the label as a markdown link.
  //
  // The bare form is what the plain-text dump of his page produces, because that
  // dump drops anchors. The link form is what script/pull_page_copy.py produces
  // from the HTML, and it is the one that carries his file. Both are accepted so
  // a page pulled either way still renders its rows.
  const LINKED = /^\s*\[([^\]]+)\]\(([^)]+)\)\s*$/;
  const isButton = (line: string) => {
    const bare = line.trim().toLowerCase() === BUTTON;
    const m = line.match(LINKED);
    return bare || (m ? m[1].trim().toLowerCase() === BUTTON : false);
  };
  const hrefOf = (line: string) => {
    const m = line.match(LINKED);
    return m ? m[2].trim() : undefined;
  };

  // Where the documents start: the last line before the first button that is not
  // itself part of a document. Everything above it is the introduction.
  const firstButton = body.findIndex(isButton);
  if (firstButton === -1) {
    return {
      name: heading,
      blocks: [{ type: "rich_text", heading, body: [...body] }],
    };
  }

  // A document is the two lines before its button. Walking backwards from each
  // button is what makes this survive a document with no description, which
  // would otherwise shift every row after it by one.
  const items: DownloadsBlock["items"] = [];
  let cursor = 0;
  let listStart = body.length;

  for (let i = 0; i < body.length; i++) {
    if (!isButton(body[i])) continue;
    const block = body.slice(cursor, i);
    const title = block[block.length - 2] ?? block[block.length - 1];
    const description = block.length >= 2 ? block[block.length - 1] : undefined;
    if (title) {
      const href = hrefOf(body[i]);
      items.push({
        title,
        ...(description ? { description } : {}),
        ...(href ? { href } : {}),
      });
      listStart = Math.min(listStart, i - block.length + cursor);
    }
    cursor = i + 1;
  }

  // The intro is everything before the first document, minus the line that
  // introduces the list itself, which becomes the list's own heading.
  const consumed = items.length * 3;
  const intro = body.slice(
    0,
    body.length - consumed - (cursor < body.length ? body.length - cursor : 0),
  );
  const listHeading = intro[intro.length - 1];
  const prose = intro.slice(0, -1);

  return {
    name: heading,
    blocks: [
      { type: "rich_text", heading, body: [...prose] },
      { type: "downloads", heading: listHeading, items },
    ],
  };
}

/**
 * The newsletter block, on the pages of his that carry one.
 *
 * Appended after whatever the page is made of, which is where his sits. Returns
 * nothing for a shop or a page without one, so the five retail shops and his
 * booking page are untouched.
 */
function newsletterFor(slug: string): PageDefinition["blocks"] {
  const n = NEWSLETTER_BY_SHOP[shopKey()];
  if (!n || !n.onPages.includes(slug)) return [];
  return [
    {
      type: "subscribe",
      heading: n.heading,
      body: n.body,
      buttonLabel: n.buttonLabel,
      // Email only. The name field is his retail ask; his wholesale form has
      // one box.
      askForName: false,
    },
  ];
}

/**
 * The title and description he wrote for a page, if he wrote them.
 *
 * Every one of the four business pages ends with a Title, a Meta description
 * and a URL. Until these arrived there was nowhere to put any of it: the title
 * was derived from the page heading and the description was never set, so every
 * page on every shop went out with no meta description at all.
 *
 * Returns undefined for a page he has not written one for, and the route falls
 * back to the heading exactly as before, so the other pages do not move.
 */
export function pageSeo(slug: string): { title?: string; description?: string } | undefined {
  return pagesForShop()[slug]?.seo;
}

export function contentPage(slug: string): PageDefinition | undefined {
  const entry = pagesForShop()[slug];
  if (!entry) return undefined;
  const tail = newsletterFor(slug);

  // A page that carries its own blocks is already the shape he drew, so nothing
  // here parses it. See PageEntry in content.ts for why the four business pages
  // are written that way rather than inferred out of prose.
  if (entry.blocks) {
    return { name: entry.heading, blocks: [...entry.blocks, ...tail] };
  }
  const body = entry.body ?? [];

  // The FAQ is the one page he asked to open and close. Everything else is prose.
  if (slug === "faq") {
    const page = parseFaq(entry.heading, body);
    return { ...page, blocks: [...page.blocks, ...tail] };
  }
  // Resources is a list of documents, which is a different shape from prose.
  if (slug === "resources") {
    const page = parseDownloads(entry.heading, body);
    return { ...page, blocks: [...page.blocks, ...tail] };
  }
  // Book a Meeting is his words, then his booking calendar. The calendar is not
  // in his copy because on his own shop it is pasted into the page editor as an
  // iframe, so the address was read off his live page rather than invented.
  if (slug === "book-a-meeting") {
    return {
      name: entry.heading,
      blocks: [
        { type: "rich_text", heading: entry.heading, body: [...body] },
        {
          type: "embed",
          heading: "Select a Date & Time",
          src: BOOKING_EMBED_BY_SHOP[shopKey()] ?? "",
          title: entry.heading,
          height: 900,
        },
        ...tail,
      ],
    };
  }

  return {
    name: entry.heading,
    blocks: [
      { type: "rich_text", heading: entry.heading, body: [...body] },
      ...tail,
    ],
  };
}
