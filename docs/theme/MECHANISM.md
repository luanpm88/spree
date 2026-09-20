# Spree's theme mechanism, measured, and whether the meta idea fits

Written 13 September 2026. This file supersedes parts of `README.md`, `PLAN.md`,
`FINDINGS.md` and `DESIGN.md` in this directory; the corrections are listed at the
bottom and each names the line it replaces.

Produced by a measured fan-out: five areas, each measured against a local Spree
5.6.1 in Docker or against real unpacked gem source, each area then put to two
independent verifiers told to refute it, then three independent fit assessments
from opposed angles, then this synthesis. 19 agents, 0 errors. 89 findings stood,
4 were knocked out by the verifiers, 21 corrections to the prior docs came back,
32 items are recorded as not measured.

Nothing here was run against a live shop.

---


Everything below traces to the measurement dossier. Where the dossier says something was not verified, I say so instead of filling the gap.

---

## 1. How Spree's theme mechanism actually works

### It is not in Spree core

The first thing to get straight: there is no theme system in the Spree we run. Core 5.6.1 is BSD-3-Clause and ships no theme models at all. On the local install, `Spree::Theme`, `Spree::Page`, `Spree::PageSection` and `Spree::PageBlock` all raise `NameError`.

The theme system lives in `spree_page_builder`, a separate opt-in gem, AGPL-3.0-or-later, whose newest release is 5.4.6 (28 July 2026, about five hours after core 5.6.1 shipped the same day). It was extracted out of the `spree/spree` repository into `spree/spree-rails-storefront` on 7 February 2026.

Core does keep the seams. `lib/spree/core/engine.rb:22-26` reserves five registry slots (`:themes`, `:theme_layout_sections`, `:pages`, `:page_sections`, `:page_blocks`, all nil in a stock app), `permitted_attributes` defines `theme_attributes`, and `app/services/spree/themes/duplicator.rb` ships in core and loads fine even though it references `Spree::Theme` and enqueues `Spree::Themes::DuplicateComponentsJob`, neither of which core defines. That is dangling scaffolding, not a feature. It is easy to grep core for "theme", find hits, and conclude wrongly.

Note also: the leftover `spree_themes` / `spree_pages` / `spree_page_sections` / `spree_page_blocks` / `spree_page_links` tables in our local `spree_development` database are residue from an earlier local test of the page builder. They are not evidence that core ships one.

### The data model: five tables, four of them single-table inheritance

| Table | Shape |
|---|---|
| `spree_themes` | id, name, store_id, `default` bool, `ready` bool, `type` varchar NOT NULL default `'Spree::Themes::Default'`, parent_id, `preferences` text, deleted_at |
| `spree_pages` | + pageable_type/pageable_id, slug, meta_title/description/keywords, parent_id, NOT NULL `name` |
| `spree_page_sections` | + pageable_type/pageable_id, position, page_links_count, NOT NULL `name` |
| `spree_page_blocks` | section_id, position, page_links_count, NOT NULL `name` |
| `spree_page_links` | parent_type/parent_id, linkable_type/linkable_id, label, url, open_in_new_tab, position. No `type`, no STI, no deleted_at |

Every row's meaning is a Ruby class name held in a `type` string column. A non-Ruby reader needs a hand-maintained map of roughly sixty class names before it can interpret a single row.

Two of the parent links are deliberately dual-purpose:

- `PageSection#pageable` is either a Page or a Theme. Theme-level sections are the shared chrome: announcement bar, header, newsletter, footer.
- `Page#pageable` is either a Theme (the fourteen standard pages) or a Store (custom pages, which therefore survive a theme switch).

So "switch theme" does not mean "switch everything". Custom pages hang off the Store and are untouched; the standard pages and all layout chrome hang off the Theme and are replaced.

### Selection and publishing

A store has many themes. Exactly one is live, marked by the `default` boolean. Uniqueness is enforced by a `before_save :ensure_default_exists_and_is_unique` callback that mass-updates every non-preview sibling with `update_all`, not by a database constraint: the index is a plain btree on `(store_id, default)`, so nothing in the schema stops two rows having `default = true`, and `update_all` writes past validations while bumping `updated_at`.

The editing workflow is where the surprise is. Opening the editor produces a copy, not saving or publishing. `ThemesController#edit` calls `@theme.create_preview` whenever `params[:theme_preview_id]` is absent, and `create_preview` deep-clones every layout section, block, link and ActiveStorage attachment, plus a `Page#create_preview` for the page being viewed. The themes index links straight to `edit_admin_theme_path(theme)` with no preview id. A merchant who opens the theme editor, looks, and closes the tab has written a full copy of the theme.

Publishing then either flips `default` on a theme (`themes_controller.rb:40`) or runs `Theme#promote`, which reparents pages onto the preview and then destroys the old theme. But `Theme`, `Page`, `PageSection` and `PageBlock` are all `acts_as_paranoid`, so "destroy" writes `deleted_at`. `PageLink` is the only one not paranoid, so links are the only rows genuinely removed. The tables only grow.

The local leftovers show the arithmetic exactly: one published theme plus four previews, each carrying an identical clone of four layout sections and seven blocks, plus four Homepage previews with two sections each. Seventy-one page blocks in total. The client's shops carry 1,300 to 1,500 theme rows each. **Not measured:** the live split between previews (`parent_id IS NOT NULL`) and tombstones (`deleted_at IS NOT NULL`) on his shops. The mechanism is proven locally; the live numbers are an inference. One read-only query per shop settles it.

One naming correction worth carrying: there is no `is_preview` column. A preview is `parent_id IS NOT NULL`, via the `Previewable` concern.

### Sections, blocks, and what "a theme" actually is

The available types are fixed arrays of Ruby classes, assigned on `Rails.application.config.spree` in the engine's `after_initialize` (`engine.rb:12-88`): 1 theme class, 4 theme layout sections, 15 pages, 25 page sections, 16 registered page blocks. There are 19 block files on disk; three are unregistered (`Metafields`, `Products::Brand`, `Products::Description`) and whether they are deprecated, pre-release, or registered by another gem was not established.

That single theme class is `Spree::Themes::Default`. `config.spree.themes` is a one-element array and `app/models/spree/themes/` contains only `default.rb`. The "Add a new theme" card is fed by a helper that rejects any class the store already owns, while the Store decorator auto-creates a Default on store creation, so on a stock install that card is empty and the only route to a second theme row is Clone, which copies the same class. **The Themes screen is a clone manager over one design, not a picker over N designs.**

A section is a row whose parent is a Page or a Theme. A block is a row whose only parent is a section.

### How fields are declared

In Ruby, with a DSL that carries only name, type and default:

```ruby
preference :desktop_image_alignment, :string, default: 'right'
```

The DSL literally rejects anything else: `options.assert_valid_keys(:default, :deprecated, :nullable, :parse_on_set)`. No label, no widget, no allowed values, no list or nested type. Allowed values, where they exist, are enforced later in `before_validation` callbacks (`featured_taxon.rb:80-87` clamps heading alignment to left/center/right).

`Themes::Default` declares about 57 such preferences (an earlier count in the dossier said roughly 60), all identity: colours, fonts, border widths, shadow offsets, product image sizes.

The values land in the `preferences` text column as a **YAML-serialized Ruby hash with symbol keys**, not JSON (`serialize :preferences, type: Hash, coder: YAML`). A real row reads `---\n:primary_color: "#000000"\n:accent_color: "#F0EFE9"`. Spree's own code queries into it with SQL `LIKE` against the serialized text, which tells you what kind of data it considers this to be.

And a section's content is not all in `preferences`. It is spread across four stores with no rule for which field goes where: the YAML column, ActionText rows in `action_text_rich_texts` (`has_rich_text :text`, `has_rich_text :description`), an ActiveStorage attachment (`has_one_attached :asset`), and `spree_page_links`. Measured locally: `heading` and `title` live in YAML while `text` and `description` are ActionText HTML.

### The admin form is not generated from the declaration

This is the crux for question 2. `page_sections/edit.html.erb:27` does:

```erb
render "spree/admin/page_sections/forms/#{@page_section.type.demodulize.underscore}", f: f
```

Dispatch by class name, with no fallback, into one hand-written ERB partial per section type (26 partials for 25 classes, plus one orphan `_brand_story.html.erb` with no Ruby class), plus seven shared design-field partials. Labels come from I18n keys written into the ERB; widgets are hard-coded (`options_for_select(['left','right'])`). The theme identity panel is the same: 14 individually named colour fields in `_sidebar_colors.html.erb`, and a bespoke fonts panel with a Google-fonts picker, sliders, a checkbox and a textarea.

Searching the entire gem for anything that iterates a preference definition list (`defined_preferences`, `preferences.each`, `preference_type`, `each_preference`, `preference_definitions`) returns nothing. Adding one field to a Spree section means editing Ruby **and** an ERB partial **and** `en.yml`.

### How it renders, and where

`spree_page_builder` ships no customer-facing views at all. 113 of its 114 views sit under `app/views/spree/admin`; the 114th is the editor's own layout.

Rendering lives in the separate `spree_storefront` gem, as Rails ERB partials under `app/views/themes/<theme_name>/`, selected at request time by `prepend_view_path` in `theme_concern.rb:22-26`. `PageSection#to_partial_path` resolves to `spree/page_sections/#{type.demodulize.underscore}`. There are 24 such partials in `themes/default`.

Blocks have no partial of their own. Ten section partials touch blocks; six switch on the block's class inside themselves (`case block.type`, or `case block.class.name` in one), and four hard-code a single shape with no switch at all. `_footer.html.erb` iterates `section.blocks` and renders every one as a nav from `block.preferred_label` and `block.links`, whatever type it actually is. There is no such thing as "the way a Heading block looks"; there are N of them, one per host section.

The failure mode of this design is visible inside Spree itself. `Spree::PageSections::CollectionBanner` is registered and has an admin form partial, but no render partial exists in the matching `spree_storefront` 5.4.6. `page_helper.rb:68` is `raise e unless Rails.env.production?`, so in production that section renders as an empty string and reports nothing to the page, while in development or test it raises `ActionView::MissingTemplate` and takes the page down.

### None of it is reachable headlessly

Measured on the wire, not argued. Every route the gem declares sits inside one `namespace :admin` block, and the gem has no `app/serializers` directory. `spree_api` 5.6.1 ships 70 v3 serializers and 65 admin ones, and not one is a theme, page, section or block serializer. Zero of the 91 Store API v3 routes and zero of the 394 Admin API routes match theme, page_section, page_block or page_link. With a valid publishable key, `/api/v3/store/themes|theme|pages|page_sections|page_blocks` all return 404 while `channel`, `policies`, `locales` and `currencies` return 200; with a deliberately wrong auth header the real endpoints return 401 and the theme paths still return 404, so the absence is routing, not authorization.

One measurement trap for whoever repeats this: `Rails.application.routes.routes` returns 67 routes and zero matches for `api/v3`, because Spree is a mounted engine. The real list is on `Spree::Core::Engine.routes.routes` (1,017 routes, 91 of them Store API v3). Run as originally suggested, the probe produces an empty list and the honest-looking wrong conclusion "there is no Store API at all".

### Upstream direction, briefly

The page builder is keeping pace with core, not trailing it: 5.4.6 is explicitly the Spree 5.6 compatibility release (PR #32, 9 files, +76/-11, fixing a route-helper name collision), and the repo's head commit switched to the 5-6-stable branch. But Spree's own documentation steers new projects away from the storefront it serves, verbatim: "We recommend using [Next.js Storefront] for new projects, as it offers better performance and a more modern developer experience." The rails docs are unlisted (885 sitemap URLs with zero containing "theme" or "page-builder"; `llms.txt`, which our CLAUDE.md points at, has 468 lines with zero mentions). Spree's own Next.js storefront contains zero references to `page_builder`. Neither the v6.0 nor the v6.1 milestone contains a single theme or page-builder item.

**Not verified:** whether `spree_page_builder` 5.4.6 actually boots on core 5.6.1. A static probe found that of 103 `Spree::` constants it references, everything missing is either shipped by the gem itself, by its declared dependency `spree_posts`, or guarded with `defined?`. But that probe is blind to method renames, moved partials and route-helper collisions, which is precisely the class of breakage PR #32 had to fix. Proving it needs a throwaway container.

---

## 2. Does the meta-driven theme idea fit?

### Verdict

**Yes, and it fits better than the prior docs claim, but it must be split from the multi-tenant conversion it has been bundled with.**

Three separate things have been travelling under one name:

1. A meta file that declares a theme's fields, and an admin form rendered from it.
2. An endpoint so a headless storefront can read the answers.
3. One Next build serving many merchants, resolved by hostname.

Items 1 and 2 are small and largely already solved by BSD-licensed Spree core. Item 3 is roughly four times the size the design doc records, is charged to the hosting business model rather than to themes, and is the only reason the project looks expensive.

My call: build items 1 and 2 now, per shop, against each shop's own build. Cost item 3 separately, as its own decision, when a hosted merchant is real.

### What Spree already solves

**The typed, declared, admin-editable, storefront-visible field system, in core, under BSD, with no page builder.** This is the strongest finding in the dossier and it is absent from `docs/theme/DESIGN.md`:

- `Spree::MetafieldDefinition` carries key, `name` (the label), namespace, `resource_type`, `metafield_type`, `display_on`, searchable, sortable. Six types: ShortText, LongText, RichText, Number, Boolean, Json. `DISPLAY = [:both, :back_end]` is the storefront-visibility gate.
- `Spree::Store` is already in `Spree.metafields.enabled_resources` (`engine.rb:321`), and `Spree::Store.new.respond_to?(:metafields)` returns true.
- The admin CRUD already exists: `spree_admin` routes `resources :metafield_definitions`, with one form widget partial per type under `views/spree/admin/metafields/types/`, and "Store" is selectable in the `resource_type` select.
- The Store API already serializes the `display_on: both` subset as `custom_fields`, gated on `expand=custom_fields`, on the product, variant and category serializers. Proven live: `GET /api/v3/store/products?expand=custom_fields` returns `custom_fields":[{"id":"cf_UkLWZg9DAJ"...`.

So "a declaration with a label and a type, an admin form generated from it, values saved as data, read by a headless storefront" is a working end-to-end path in core today, with 260 metafield rows already in use locally.

**Storage with no migration.** `Spree::Store` and `Spree::Channel` both carry `metafields` / `public_metafields` / `private_metafields` associations and `public_metadata` / `private_metadata` jsonb columns.

**The tenancy seam, as a seam.** `Spree.current_store_finder` is a declared injection point (default `'Spree::Stores::FindDefault'`) whose override is recorded with the caller's file and line, so "did anyone forget to swap the finder" is assertable in a test.

**The endpoint pattern.** Adding a Store API v3 endpoint is proven twice in this repo already: one routes stanza via `Spree::Core::Engine.add_routes`, one controller inheriting `Spree::Api::V3::Store::BaseController`, one serializer. Both examples appear in the mounted 91 routes.

### What Spree does not solve

**The meta itself.** This is the correction that matters most for how the work is described. The `preference` DSL rejects label, widget, allowed values, lists and nesting outright. The form is hand-written ERB per class. Nothing in the gem reads a field declaration to build a form. The client's sketch (name, type, label, child_meta) carries **strictly more** than Spree's declaration does. "Spree already ships this" is true about the outcome and false about the mechanism, and our version would be simpler than theirs.

**Choosing between N themes.** One theme class, a clone manager, an empty Add card on a stock install. And the Themes screen cannot be unbundled: `Spree::Theme`, its controller and all five of its views ship in the same gemspec file list as all 25 sections and all 19 block classes, registered together in one `after_initialize`. There is no `spree_themes` gem. Taking the picker means taking the page builder and the AGPL licence.

**Any headless read of theme data.** Zero routes, zero serializers, 404 on the wire. `docs/theme/PLAN.md` dropped route B on scope without measuring; the measurement now closes it on mechanism too.

**Any store-level read at all.** `/api/v3/store/store` and `/api/v3/store/custom_field_definitions` both return 404. `custom_field` appears zero times in the store namespace of `spree_api`'s routes; `resource :store, only: [:show, :update]` is admin-only and carries no `custom_fieldable` concern. The one store-level endpoint that exists, `/api/v3/store/channel`, returns six flat attributes with no metadata, no store name, no logo and no palette. A headless storefront cannot read basic store identity over Store API v3 today. That is a bigger gap than "themes are missing", and it is the gap our endpoint closes.

**Renderer-agnostic theme data.** Content split across four stores with no rule, blocks with no standalone shape, rendering that is ERB in a different gem. The data and the templates are one artefact.

**Hostname tenancy.** `Spree::Stores::FindDefault` accepts a `url:` keyword and never stores it. Measured: a request on `tenant-b.local` carrying store 1's key returned `/api/v3/store/channel` as `ch_UkLWZg9DAJ`, which is channel id 1, store_id 1, with a 36-product payload byte-identical to the same call on `spree.local`.

### The honest costs

**Small, and well understood:**

- The store settings endpoint: one routes stanza, one controller, one serializer. It **must** call `allow_guest_storefront_access!` or the wholesale shop breaks: measured, on a `login_required` channel, guest reads of policies, products and categories return 401 while channel and locales return 200. A theme endpoint without the opt-out would 401 for exactly the visitors who need it, the ones looking at the sign-in wall that has to be painted in the merchant's theme.
- A url-resolving store finder: about ten lines, and it works locally. The one trap is measured and named: a finder that returns the right store but omits `Spree::Current.store = store` leaves 29 read sites across `spree_core` and `spree_api` silently reading the default store, because `Spree::Current#store` is `super || Spree::Store.default`.

**Large, and previously under-counted by about four times.** `docs/theme/DESIGN.md` prices the Next conversion at "roughly 16 files for the shop key itself, plus sorting which of the 29 environment reads are per-merchant". Measured: 72 production files in the union, 58 of them touching a build-time per-merchant value, about 113 mechanical edit sites (17 `shopKey()` calls in 15 files, 17 `*_BY_SHOP` lookups, 79 `lib/store` accessor sites across 39 files, 17 cached functions), plus roughly 28 files of genuine design work and `next.config.ts` on top. The fifth of the surface the doc named is the mechanical fifth. Inside the remainder:

- `src/lib/spree/config.ts:5-7` holds the SDK client in a process-global `let _client`, with exactly one `initSpreeNext` call site reading env. A process is pinned to one merchant's publishable key for its life. That has to be replaced before any cache key is touched, because even a cache miss is fetched with the wrong credentials.
- Next keys a `use cache` entry on `[buildId, id, args]` and nothing about the request. None of the 17 cached functions takes a tenant. `getPolicies()` is `"use cache: remote"` with **zero arguments**, so it has no key to add a tenant to; it needs a signature. It feeds the footer and the checkout layout.
- Next 16.2.11 substitutes `process.env.NEXT_PUBLIC_*` into client, edge and nodejs bundles as literal text, so all 24 to 25 per-merchant names must be renamed before they can vary at all, and each rename cascades to its call sites.
- `next.config.ts` is evaluated once per build. `images.remotePatterns` derives exactly one allowed image hostname from `SPREE_IMAGES_URL || SPREE_API_URL`, and the per-shop retired-URL redirects are selected by `NEXT_PUBLIC_DEFAULT_COUNTRY`.
- `cacheComponents` is on, and the whole chrome (utility bar, announcement bar, header, both footers) renders outside any Suspense boundary, so it sits in the prerendered static shell. Per-request tenancy forces that chrome dynamic for all seven existing shops, none of which needs tenancy.
- 24 per-merchant reads sit in or behind client components, including the Stripe publishable key, PayPal client id and Adyen client key. Threading those per request is a checkout redesign, not a rename.

**Licensing.** Every ready-made shortcut is AGPL-3.0-or-later against core's BSD-3-Clause: `spree_page_builder`; `spree_storefront`, which is MIT but declares a runtime dependency on the page builder so `bundle add spree_storefront` puts AGPL in the served backend; and `spree_custom_domains` 0.1.0, which ships exactly the host-resolving finder `DESIGN.md` said we would have to write. Real multi-tenancy is not open source at all: `spree_enterprise` and `spree_multi_tenant` are absent from public rubygems and install from a Keygen registry behind a licence key. What AGPL obliges in the client's hosting model is a legal question about combined works and should not be answered from this research.

### Where the three assessments disagree, and my call

**(a) Is the Next conversion part of the theme question?** Assessment 1 charges it to route C and says do it anyway. Assessment 3 says it entered the decided table as a row no scope question produced, and belongs to the hosting business model. Assessment 2 avoids it by tiering.

*My call: assessment 3 is right on the logic.* Nothing in "an admin picks a theme and edits a few fields" requires one build for many merchants. Assessment 3's own admitted weakness is fair too: if hosted merchants are real, that conversion is coming regardless, and doing it with seven shops is easier than with thirty. But that makes it a scheduling argument about a separate project, not a reason to price the two as one.

**(b) Is route A viable if scoped only to the merchant tier?** Assessment 2's best point is that PLAN.md rejected route A for "requiring the customer-facing site to become Rails again" while its own Q1 answer says the customer is the merchants he hosts, not his seven shops. Those are disjoint populations, and route A applied only to new merchants discards nothing.

*My call: the logic holds, the route does not, yet.* It is blocked on two things neither of which is measured. Spree ships no picker over N themes, and the documented seam for a second design (a host-app `app/views/themes/<name>/` directory resolving ahead of the engine's default) was never tested. And the AGPL question is live before the first commit. Assessment 2 lists both in its own collapse conditions.

**(c) Is "Spree already ships this" true?** All three agree: true of the outcome, false of the mechanism. No disagreement.

**(d) The numbers.** All three agree DESIGN.md is roughly 4x low. Assessment 3 adds the fairest caveat: the dossier counts files and call sites, never days. "Bigger than it looked" is proven. "Too big to start" is a judgement laid on top of it.

### What should be settled before any of this is presented

Each of these is cheap, and each was explicitly not measured:

1. Does `next/image` reject an un-listed remote host? If yes, one build can only serve images for merchants enumerated at build time, which reintroduces a build per onboarding, the exact thing the conversion exists to remove.
2. Can the `lib/store` accessors stay synchronous under a request-scoped tenant (AsyncLocalStorage, or React `cache()` over a header read)? This single question moves the estimate more than anything else in it: 79 call sites either stay untouched or become edits, about 30 of them in synchronous render code.
3. Can an admin actually **fill** a Store-level metafield today, or only declare one? The storage and the definition screen are proven; whether the store settings page renders the edit-metafields link was not confirmed. If it does not, the "nearly free" half has an admin cost.
4. Does `/admin` scope its records by `current_store` at all? Only locale, timezone and currency were traced. If a merchant signing in sees every merchant's orders, hosting merchants on one Spree is blocked for reasons unrelated to themes.
5. Does `spree_page_builder` 5.4.6 boot on 5.6.1? Throwaway container, not this one.
6. How much of Spree 6.0 breaks our storefront independent of themes? The v6.0 milestone has closed "Replace Taxons with Categories", "Remove Master Variant" and "Cart/Order Split", all Store API resources the Next storefront reads, and `spree_api` 5.6.1 already ships a categories controller and no taxons controller. Nobody has sized that against our code. It is a larger near-term risk than anything in the theme question.

---

## Corrections to the prior `docs/theme/` files

| File | Said | Actually |
|---|---|---|
| `README.md:20-24`, `PLAN.md:27` | "Spree already ships this, built by the company that makes Spree" | Not in core (separate opt-in gem on its own 5.4.x line), not the same licence (AGPL vs core's BSD), not in current docs (rails pages unlisted, themes page recommends Next.js for new projects), and not the same mechanism (Ruby `preference` calls plus hand-written ERB, no field schema file anywhere in the gem) |
| `FINDINGS.md:72-74` | "copy-then-publish, so every edit leaves a copy behind" | Right conclusion, wrong trigger, rate understated. The copy is made by **opening** the editor. Publishing soft-deletes rather than deletes, so the tables only grow |
| `FINDINGS.md:101-105` (§4 open items) | Whether theme data is readable over the Store API, and whether a block's shape is stable enough to render from, are unmeasured | Both measured. Not readable at any API. Shape not stable: content split across YAML, ActionText, ActiveStorage and page_links, decided per class |
| `FINDINGS.md:24-28` (§1) | "a theme library, preview images, an Add button" | One theme class only. The Add card is empty on a stock install. It is a clone manager, not a library |
| `PLAN.md:92-94` | "Route B is out... no need to measure whether the block data is reachable" | Decision stands, reasoning was one reason short: route B was never *available*. And the same measurement was a precondition for route C, which assumes theme data on the Store API |
| `PLAN.md:119-122` | Open: can Spree's Themes screen be reused without the page builder's block composition? | Answered no, twice over. There is nothing to pick between, and the screen cannot be unbundled from the gem |
| `DESIGN.md` §"the mechanism this rests on" | Quotes `FindDefault` ending at the store selection line | Omits the next line, `Spree::Current.store = store`. That omission is the entire cross-tenant leak: 29 read sites fall back to the default store |
| `DESIGN.md:74` | "the first thing built is the store finder" | Spree publishes one: `spree_custom_domains` 0.1.0 ships it and swaps the dependency itself. Two caveats: AGPL, and one release old |
| `DESIGN.md` §"what this means for the design" | Every merchant "would be served the default store's catalogue, orders and customers" | Only when they share the default store's key. A merchant with their **own** key gets 401 everywhere: loud and safe. Shared key fails silent and open |
| `DESIGN.md:~192` | "call sites of `shopKey()` 18"; "29 NEXT_PUBLIC_ env reads" | 17 call sites (the 18th match is the definition line). 29 is occurrences; there are 25 distinct names, plus 21 distinct server-only names that were never counted |
| `DESIGN.md` §"the cost that has to be said out loud" | "roughly 16 files for the shop key itself" | 72 production files, about 113 mechanical sites, about 28 files of design work. Direction right, magnitude about 4x |
| `DESIGN.md` §"why the storefront is already most of the way there" | Layout is the genuinely new part because themes own component trees | Incomplete. The harder reason is `cacheComponents` with the entire chrome outside Suspense, so the shell is per build by construction and tenancy costs all seven shops their PPR shell |
| `storefront/src/app/api/markdown/route.ts:63` (code comment) | "this storefront renders per host" | No module resolves content, theme, API base or key from a hostname; the only tenant resolver reads env. The forwarding may still be correct for absolute-URL construction downstream, and one verifier noted that whether the comment's stated *reason* is wrong was not itself measured |
| Research brief's own route-enumeration command | `Rails.application.routes.routes ... grep(%r{/api/v3/store})` | Returns nothing on this app, because Spree is a mounted engine. Use `Spree::Core::Engine.routes.routes`. Also: `spree_page_builder-5.4.6` and `spree_storefront-5.4.6` are already unpacked in the container's gem directory, so no `gem fetch` is needed to read the source |