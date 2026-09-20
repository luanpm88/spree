# Research plan: admin-selectable themes

> **Superseded in part, 13 September 2026.** `MECHANISM.md` in this directory
> measured the mechanism against real gem source and a local Spree, and corrected
> several claims below. Read it first. The corrections that touch THIS file are
> listed in its final table.

Written 11 September 2026. Nothing here is decided. Read `FINDINGS.md` first.

---

## The idea as it was put

An admin picks a theme and the storefront changes completely. A theme declares
what it exposes in a JSON meta file: which fields, of what type, with what label.
The admin renders a form from that meta, the answers are saved as data, and the
theme reads them. Something like:

```json
[
  { "name": "page-title",  "type": "text",      "label": "Page title" },
  { "name": "banner-top",  "type": "image-url", "label": "Top bar banner" },
  { "name": "testimonial", "type": "list",      "label": "Testimonials",
    "child_meta": {
      "title":       { "type": "text",      "label": "Title" },
      "description": { "type": "textarea",  "label": "Description" },
      "image":       { "type": "image-url", "label": "Image" }
    }}
]
```

That is a sound design. It is also, almost exactly, what Spree already ships.

## So the question changed

It is not "how do we build a meta-driven theme system". It is:

> Given that Spree has one, that the client has a year of content in it, and that
> his storefront no longer reads any of it, which route do we take?

## The three routes

### A. Run Spree's storefront, use Spree's page builder

Install `spree_storefront` and `spree_page_builder`. The admin gets the theme
library and the editor. The client already knows this interface because he used
it for a year.

What it costs: the customer-facing site becomes Rails again. Everything built in
the Next storefront over this engagement, and every measurement behind it, is set
aside. This is not a small trade and it should not be described as one.

### B. Keep Next, read Spree's theme data over the API

The page builder stays the editing surface. The Next storefront reads
`spree_themes` and `spree_page_blocks` and renders them itself.

What it costs: writing a renderer for somebody else's block format, and tracking
it as that format changes. The editor's preview would also be showing a Rails
render of a page that Next draws differently, so the preview would be a
approximation rather than the thing itself.

**Blocked on a measurement**, not an opinion: whether that data is reachable
through the Store API at all. See FINDINGS §4.

### C. Build the meta system as sketched, for the Next storefront

A meta file per theme, a form rendered from it in the admin, answers saved as
data, Next reads the data.

What it costs: building and maintaining it. What it buys: it fits the storefront
that actually serves his customers, and the meta shape is ours to keep simple.

Worth noting honestly: this is the route that duplicates something Spree already
has. That is not automatically wrong, because Spree's version targets a storefront
this system does not run, but it needs saying out loud rather than discovered
later.

---

## Answered, 11 September

These came back from the four questions below, and they narrow the work a lot.

| question | answer |
|---|---|
| Who is it for | **The merchants he hosts and sells to**, not his own seven shops |
| The year of existing page-builder content | **Drop it.** The Next storefront has replaced that layout |
| What changes | **All three**: layout, content and identity |
| How free is the editor | **Pick one of N prepared themes, then edit a few fields.** Not free composition |

### What that settles

**Route B is out.** Its entire argument was reusing the existing content, and the
content is not wanted. No need to measure whether the block data is reachable
over the API.

**Route A is out, for two separate reasons.** It gives free-form section
composition, which is more freedom than was asked for and therefore more ways to
publish something broken. And it requires the customer-facing site to become
Rails again, discarding the storefront this engagement built.

**Route C is the one.** But the answers also make it much smaller than it looked:

The fourth answer is the important one. "Pick one of N prepared themes and edit a
few fields" is a theme picker and a settings form. It is not a page builder. That
distinction removes preview, undo, draft-versus-published and every other hard
part of composition, because a prepared theme cannot be composed into an invalid
state.

And "layout changes" has to be read against it: layout changes by **switching to a
different prepared theme**, not by dragging sections. Each theme owns its own
layout; the admin chooses between them.

The storefront already does a version of this. Identity is already per shop, and
content already comes from a per-shop module. So much of the work is not inventing
a theme system, it is **moving what a developer edits in a file into something an
admin edits in a form**, and the meta file is how a theme declares which of its
fields are safe to expose.

### What is still open

- Whether Spree's own theme-selection machinery, `spree_themes` and the Themes
  admin screen, can be reused for picking a theme WITHOUT taking on the page
  builder's block composition. Worth one measurement on the local site, because
  reusing an admin screen the client already knows is worth something.
- Where the answers are stored so the Next storefront can read them per request
  without a deploy.
- Whether a merchant gets their own themes or picks from a shared set.

---

## Questions that were asked before any of it

Answering these in order is the plan. Each one can change which route is
possible, so they come before design, not after.

### Q1. Who is the customer for this?

The client's own seven shops, or the merchants he is starting to host and sell to?

It matters because his own shops are configured by us and a deploy is cheap. A
merchant he hosts cannot be asked to wait for a developer, which is the entire
argument for a theme system and changes the answer to everything below.

### Q2. Is the existing content an asset or a distraction?

He has 19,000 to 21,000 page blocks per shop and was still editing them in
August. Is any of it content he wants back, or was it the old site's layout that
the new storefront has already replaced?

If it is wanted, route B gains a lot. If it is not, it stops being a factor and
routes A and C are judged on their own.

### Q3. Change what, exactly?

"The storefront changes completely" covers three very different jobs:

- **Content**: the words and images in a section that already exists.
- **Layout**: which sections appear, in what order.
- **Identity**: colours, fonts, logo, spacing.

The current storefront already does identity per shop, and content through a
config file. Layout is the part it does least. Knowing which of the three is
actually wanted decides how much of this is new work at all.

### Q4. Who edits, and how much can they break?

An admin choosing between three finished themes is a different product from an
admin composing sections freely. The first is a dropdown. The second is a page
builder and needs preview, undo, and a way to not publish a broken page.

---

## What gets measured next, once Q1 to Q4 are answered

In this order, and each one is cheap:

1. **Stand up a local Spree with admin and storefront in Docker**, so this is
   tried rather than reasoned about. Nothing touches a live shop, same as the
   1 September test.
2. **Ask whether the theme data is reachable over the Store API.** One request.
   It decides whether route B exists.
3. **Read one real page block** from the client's own data and see whether its
   shape could be rendered by anything other than Spree's own storefront.
4. **Install the page builder on the local site** and see what the admin gets in
   5.6.1, rather than in the 5.4.6 pair that was tested before.

Only then is there enough to design against.

---

## The rule for this piece of work

The same one the rest of the project runs on. Every claim in here gets a
measurement beside it, and where something has not been measured it says so. The
1 September test is the model: "installs" and "works" and "empty or broken" are
three different questions, and only the third one was worth the effort.
