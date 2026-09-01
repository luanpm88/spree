import { Inline, isBullet, plain } from "@/components/blocks/Inline";
import type { RichTextBlock } from "@/lib/blocks/types";

/**
 * Prose. The block behind About, Buy Local and the policy-style pages.
 *
 * Lines arrive as separate strings rather than one blob of HTML, so nothing can
 * inject tags into the page. Formatting rides along as markers, which `Inline`
 * turns into elements. See that file for why it is markers and not markup.
 *
 * Three line shapes, all of them taken from the client's own pages rather than
 * invented: a heading, a bullet, and a paragraph.
 */
export function RichText({ heading, body }: RichTextBlock) {
  // Consecutive bullets become one list. Rendering each as its own <ul> is the
  // easy version and it is wrong: screen readers announce four lists of one item
  // where his page has one list of four.
  const groups: Array<{ bullets: string[] } | { line: string }> = [];
  for (const line of body) {
    const last = groups.at(-1);
    if (isBullet(line)) {
      if (last && "bullets" in last) last.bullets.push(line.slice(2));
      else groups.push({ bullets: [line.slice(2)] });
    } else {
      groups.push({ line });
    }
  }

  return (
    <section className="py-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-3xl">
        {/* Black and larger. The old heading was marked "needs to be black and
            bigger font, it is getting lost": it sat at the same weight as the
            copy beneath it and in the same muted colour. */}
        {heading ? (
          <h1 className="text-4xl font-bold text-black mb-8">{heading}</h1>
        ) : null}
        {groups.map((group, index) => {
          if ("bullets" in group) {
            return (
              <ul
                // biome-ignore lint/suspicious/noArrayIndexKey: a list of prose lines has no id
                key={`list-${index}`}
                className="mb-4 ml-5 list-disc space-y-1 leading-relaxed"
              >
                {group.bullets.map((item) => (
                  <li key={plain(item).slice(0, 40)}>
                    <Inline text={item} />
                  </li>
                ))}
              </ul>
            );
          }

          const { line } = group;
          const key = plain(line).slice(0, 40) || `line-${index}`;
          const words = plain(line);

          if (line.startsWith("## ")) {
            return (
              <h2 key={key} className="text-xl font-bold mt-10 mb-3">
                <Inline text={line.slice(3)} />
              </h2>
            );
          }
          if (line.startsWith("### ")) {
            return (
              <h3 key={key} className="font-semibold mt-6 mb-2">
                <Inline text={line.slice(4)} />
              </h3>
            );
          }
          // A whole line in capitals is a section label in his copy. Tested on the
          // words rather than the raw line, because his are wrapped in bold and
          // "**ORDERS**" is not equal to its own upper case.
          if (words === words.toUpperCase() && words.length > 3) {
            return (
              // Black and larger, the same as the FAQ group headings. These are
              // the same thing on a prose page — ORDERS, PAYMENTS & REFUNDS over
              // the block it labels — and they were set in the same small muted
              // grey he drew an arrow at: "needs to be black and bigger font, it
              // is getting lost".
              <h2
                key={key}
                className="text-lg font-bold tracking-wide mt-10 mb-4 text-black"
              >
                {words}
              </h2>
            );
          }
          if (words.startsWith("Q:")) {
            return (
              <h3 key={key} className="font-semibold mt-6 mb-2">
                <Inline
                  text={line.replace(/\*\*/g, "").replace(/^Q:\s*/, "")}
                />
              </h3>
            );
          }
          return (
            <p key={key} className="mb-4 leading-relaxed">
              <Inline text={line} />
            </p>
          );
        })}
      </div>
    </section>
  );
}
