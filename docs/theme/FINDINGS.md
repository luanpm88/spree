# What has been measured

> **Superseded in part, 13 September 2026.** `MECHANISM.md` in this directory
> measured the mechanism against real gem source and a local Spree, and corrected
> several claims below. Read it first. The corrections that touch THIS file are
> listed in its final table.

Every claim here has the measurement beside it. Nothing in this file is inferred
from documentation or from what a gem name suggests.

---

## 1. Spree already has this feature, and it works

Measured 1 September on a local test site, never against a live shop.

```
spree_page_builder  v5.4.6   28/07/2026   by the company that makes Spree
  requires: spree >= 5.4.0, spree_admin >= 5.4.0, spree_posts >= 0
```

The constraints are `>=` rather than `~>`, so 5.6.1 satisfies them. `bundle
install` was clean, the app booted, and the installer created `spree_themes`,
`spree_page_links`, `spree_page_blocks`, `spree_posts`, `spree_post_categories`.

The admin gained **Storefront → Pages / Settings**, **Posts**, and a **Themes**
page with a theme library, preview images, an Add button, and a workflow that
copies a theme and publishes the copy.

The editor at `/admin/themes/1/edit` is real: a Page sections panel (Announcement
Bar, Header, Image With Text, Newsletter, Footer), **Add Page Block** per section,
**ADD SECTION**, a page selector, a mobile/desktop toggle, **Preview** and
**Publish**.

**It renders.** The preview iframe looked empty at first, and the temptation was
to call that broken. Installing `spree_storefront` v5.4.6 alongside it, and
running `tailwindcss:build`, produced:

```
Rails /            500  "asset tailwind.css not found"   <- a missing build step
bin/rails tailwindcss:build                570ms
Rails /            200  "Shop"  58 KB
iframe src   /?page_preview_id=17&theme_id=1&theme_preview_id=4&page_builder=true
             600 characters, headings: Shop, Heading Default, About us
```

So the empty frame was the correct state of an editor with no storefront to draw,
not a fault. The distinction between "installs" and "works" and "empty or broken"
is the whole value of that test.

The test left five migrations and a modified `schema.rb` behind, which were
removed afterwards. Live shops were confirmed untouched.

---

## 2. The client has been using it for over a year, and the content is still there

Re-measured 11 September, against the live databases:

| shop | themes | page blocks | pages | last theme edit |
|---|---|---|---|---|
| A | 1,499 | 21,535 | 1,659 | 2026-08-28 |
| B | 1,394 | 19,753 | 1,481 | 2026-08-26 |
| C | 1,377 | 19,536 | 1,466 | 2026-08-27 |
| D | 1,347 | 19,267 | 1,456 | 2026-08-10 |
| E | 1,373 | 19,491 | 1,462 | 2026-06-30 |
| F | 203 | 2,623 | 243 | 2026-06-08 |
| G | tables not present | | | |

The earliest theme dates from 30 May 2025. The most recent edits are 26, 27 and
28 August 2026, which is **on and after changeover**. So this is real use up to
the day the shops moved, not a stray install.

The one shop with no tables is the one built new from scratch, which is exactly
what would be expected.

The thousand-plus themes per shop are not a thousand designs. The page builder's
workflow is copy-then-publish, so every edit leaves a copy behind.

**All of it is dormant.** The shops now serve customers from a Next.js
application that reads Spree over the API, and nothing in that application reads
`spree_themes` or `spree_page_blocks`.

---

## 3. What the current storefront does instead

Not measured for this question specifically; known from building it. Recorded
here so the comparison is honest rather than flattering to either side.

The Next storefront already has a form of the same idea, arrived at
independently: per-shop content lives in a configuration module, the layout
chooses components from it, and a shop's identity, palette, footer shape and
announcement strip are selected by a shop key. It is edited by a developer in a
file, not by an admin in a form.

So the gap is not "we have no theming". The gap is **who can change it without a
deploy**.

---

## 4. What is NOT yet measured

Listed so nobody mistakes an absence for a finding.

- Whether `spree_page_blocks` and `spree_themes` are readable through the Store
  API, or only through the Rails storefront. This decides whether route B below
  is even available.
- What a page block row actually contains, and whether its shape is stable enough
  to render from.
- Whether the client's existing thousand-plus themes per shop are of any use, or
  whether only the currently published one matters.
- How the page builder behaves with a headless storefront in 5.6.1 rather than
  5.4.6, which is the version pair that was tested.

---

## 5. What the Next storefront already does, measured 11 September

This matters because route C builds on it rather than starting from nothing.

**Theme selection exists.** `shopTheme()` in `src/lib/blocks/theme.ts` is three
lines: it returns `THEME_BY_SHOP[shopKey()]`. The value is a string such as
`black`, `green-blue` or `business-green`.

**It drives two things, not one.** It is written to `data-theme` on `<html>` in
`DocumentShell`, which selects the CSS palette, and it is also branched on in
TypeScript: `footerLivery.ts` picks a livery from it, and the storefront layout
uses it to choose between two entirely different footers and two different top
strips. So a theme today already changes both paint and structure, in a small way.

**The content is already per shop and already typed.** `content.ts`, which is
gitignored because its keys are the client's shop names, carries at least:

```
HOME_BY_SHOP   PAGES_BY_SHOP   SITE_LINKS        SCRIPTS_BY_SHOP
BRAND_BY_SHOP  FOOTER_BY_SHOP  THEME_BY_SHOP     ANNOUNCEMENT_BY_SHOP
UTILITY_BAR_BY_SHOP            BUSINESS_FOOTER
```

That is the same idea as the proposed meta system, one layer down: a declared set
of fields per shop, consumed by components. The difference is who writes it and
when.

### So the gap is exactly three things

1. **Selection is at build time, not request time.** `shopKey()` comes from an
   environment variable baked into the image. A merchant changing their theme
   must not require a rebuild, so the choice has to be read per request.
2. **The values live in a file a developer edits.** Moving them to something an
   admin edits is the actual work, and the meta file is how a theme declares
   which of its fields are safe to expose.
3. **Layout variation is minimal.** One shop swaps its footer and top strip. A
   theme that changes which sections appear, and in what order, does not exist
   yet.

Point 1 is the one with architectural weight. Everything else is moving values;
that one changes when the answer is known, and therefore how it is cached.
