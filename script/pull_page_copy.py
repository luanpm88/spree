"""Pull a live page's copy out of a Rails storefront, formatting and all.

    python3 script/pull_page_copy.py https://shop.example.com/pages/about

Prints the page as a JSON list of lines in the light markup the Next storefront
renders: **bold**, *italic*, [label](href), "- " for a bullet, "## " for a
heading. See src/components/blocks/Inline.tsx for the renderer.

── why this exists ──────────────────────────────────────────────────────────

The brief was "all pages need formatting as per the live shop". Retyping a
client's About and FAQ by hand loses the bold runs, the pull quote and the links
out to his help site, and it introduces typos into copy he wrote. This reads them
off the running site instead, so what ships is what he already published.

── why html.parser and not a regular expression ─────────────────────────────

The regex version produced bold markers that leaked down the page. His HTML has a
<strong> that opens inside one block and closes inside the next, and a stray close
with no open. A regex cannot see that. A parser carries the open tag stack and
closes what is open when a block ends.

── the two mistakes already made here ───────────────────────────────────────

Taking only the LONGEST trix-content block. Right for a page written as one body,
wrong for a page built from several: his subscribe page has five blocks and the
longest holds one sentence of the five, so four fifths went missing with no error.

Removing "empty italic pairs" with a pattern that allowed zero characters between
the markers. It matched the opening ** of every bold run and deleted it, so the
page came back correct in structure and stripped of every emphasis.
"""

import html.parser, json, re, sys, urllib.request

SKIP = {"script", "style", "svg", "button", "template", "noscript", "path", "g"}
BREAK = {"div", "p", "br", "li", "h1", "h2", "h3", "h4", "ul", "ol"}


class Reader(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.lines, self.buf = [], []
        self.skip_depth = 0
        self.bold = 0
        self.italic = 0
        self.href = None
        self.prefix = ""

    # ── lines ────────────────────────────────────────────────────────────────
    def flush(self):
        # Close anything still open so a marker can never cross into the next
        # line. This is the whole reason for using a parser.
        text = "".join(self.buf)
        if self.bold:
            text += "**"
        if self.italic:
            text += "*"
        text = re.sub(r"\s+", " ", text).strip()
        text = re.sub(r"\*\*\s*\*\*", "", text)
        # Require whitespace between the pair. Without it this pattern ate the
        # opening ** of every bold run: "**Word**" looks like an empty italic
        # pair to a rule that allows zero characters in the middle.
        text = re.sub(r"(?<!\*)\*\s+\*(?!\*)", "", text)
        if text and set(text) - {"*", " "}:
            self.lines.append((self.prefix + text).strip())
        self.buf = []
        self.prefix = ""
        reopen_b, reopen_i = self.bold, self.italic
        self.bold = self.italic = 0
        if reopen_b:
            self.buf.append("**")
            self.bold = 1
        if reopen_i:
            self.buf.append("*")
            self.italic = 1

    def handle_starttag(self, tag, attrs):
        if tag in SKIP:
            self.skip_depth += 1
            return
        if self.skip_depth:
            return
        if tag in BREAK:
            self.flush()
        a = dict(attrs)
        if tag == "li":
            self.prefix = "- "
        elif tag in ("h1", "h2"):
            self.prefix = "## "
        elif tag in ("h3", "h4"):
            self.prefix = "### "
        elif tag in ("strong", "b"):
            if not self.bold:
                self.buf.append("**")
            self.bold += 1
        elif tag in ("em", "i"):
            if not self.italic:
                self.buf.append("*")
            self.italic += 1
        elif tag == "a" and a.get("href"):
            self.href = a["href"]
            self.buf.append("[")

    def handle_endtag(self, tag):
        if tag in SKIP:
            self.skip_depth = max(0, self.skip_depth - 1)
            return
        if self.skip_depth:
            return
        if tag in ("strong", "b"):
            self.bold = max(0, self.bold - 1)
            if not self.bold:
                self.buf.append("**")
        elif tag in ("em", "i"):
            self.italic = max(0, self.italic - 1)
            if not self.italic:
                self.buf.append("*")
        elif tag == "a" and self.href is not None:
            self.buf.append(f"]({self.href})")
            self.href = None
        elif tag in BREAK:
            self.flush()

    def handle_data(self, data):
        if not self.skip_depth:
            self.buf.append(data.replace("\xa0", " "))


def content_block(h: str) -> str:
    """Every trix-content block on the page, in order.

    The first version took only the LONGEST one, which is right for a page written
    as one body and wrong for a page built from several. His subscribe page has
    five blocks and the longest holds one sentence of the five, so four fifths of
    the page went missing without any error.

    The announcement line above the header is a trix-content block too, and it
    appears on every page, so it is dropped here rather than repeated at the top
    of every page's copy."""
    parts = []
    for m in re.finditer(r'<div class="trix-content"[^>]*>', h):
        depth, end = 1, len(h)
        for t in re.finditer(r"<(/?)div\b[^>]*>", h[m.end():]):
            depth += -1 if t.group(1) else 1
            if depth == 0:
                end = m.end() + t.start()
                break
        seg = h[m.end():end]
        if "supporting sustainable living" in seg:
            continue
        parts.append(seg)
    return "\n".join(parts)


def pull(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    doc = urllib.request.urlopen(req, timeout=45).read().decode("utf-8", "replace")
    r = Reader()
    r.feed(content_block(doc))
    r.flush()
    return r.lines


if __name__ == "__main__":
    print(json.dumps(pull(sys.argv[1]), ensure_ascii=False, indent=1))
