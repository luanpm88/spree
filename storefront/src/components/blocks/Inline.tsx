import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Bold, italic and links inside a line of copy.
 *
 * ── why a tiny markup and not HTML ───────────────────────────────────────────
 *
 * The client's pages are formatted: nineteen bold runs on his About page alone,
 * an italic pull quote, bulleted lists, and links out to his help site. Carrying
 * that as plain strings lost all of it, which is what he meant by "all pages need
 * formatting as per the live shop".
 *
 * The obvious fix is to store HTML and hand it to dangerouslySetInnerHTML. That
 * is how a CMS field becomes an injection: the moment page copy comes from an
 * editor rather than from this repository, whatever is in that field runs. So the
 * copy carries markers instead, and this turns them into React elements. There is
 * no path from the content file to a raw tag.
 *
 * ── the markers ──────────────────────────────────────────────────────────────
 *
 *   **bold**        \*italic\*        [label](https://example.com)
 *
 * Deliberately three. Every one of them earns its place in his existing pages,
 * and anything more is a markup language nobody asked for.
 */

const PATTERN = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;

export function Inline({ text }: { text: string }): ReactNode {
  const parts = text.split(PATTERN).filter((part) => part !== "");

  return parts.map((part, index) => {
    // Index in the key because the same word can legitimately appear twice in
    // one sentence, and these fragments have no identity of their own.
    const key = `${index}-${part.slice(0, 24)}`;

    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }

    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const [, rawLabel, href] = link;
      // The label goes back through this function, because his labels carry
      // markers of their own.
      //
      // 25 links across the estate are written [**words**](url), and every one
      // of them printed its asterisks to the customer: the label was rendered as
      // a plain string. "Please visit our **<the shops page>**." with the
      // stars visible, on his FAQ pages.
      //
      // It terminates: a label is strictly shorter than the part it came from,
      // and the pattern's [^\]]+ cannot match a nested link, so the recursion is
      // one level in practice and bounded by the string length in principle.
      // keyed, because the linter cannot see that this is one element and
      // not a list: it is created inside a map callback.
      const label = <Inline key={`${key}-label`} text={rawLabel} />;
      // Anything off this site opens in a new tab, and only http(s) is followed.
      // A link is the one marker that carries an address, so it is the one that
      // has to refuse javascript: and data: outright.
      const external = /^https?:\/\//i.test(href);
      if (!external && !href.startsWith("/")) return label;
      return external ? (
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-primary"
        >
          {label}
        </a>
      ) : (
        <Link
          key={key}
          href={href}
          className="underline underline-offset-2 hover:text-primary"
        >
          {label}
        </Link>
      );
    }

    return part;
  });
}

/** True when a line is a bullet in his copy. */
export function isBullet(line: string): boolean {
  return line.startsWith("- ");
}

/** The line with its markers removed, for tests that read the words. */
export function plain(line: string): string {
  return line
    .replace(/\*\*/g, "")
    .replace(/(?<!\*)\*(?!\*)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^-\s+/, "")
    .trim();
}
