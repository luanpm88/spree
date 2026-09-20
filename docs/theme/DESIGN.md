# Design: admin-selectable themes, one storefront, many merchants

> **Superseded in part, 13 September 2026.** `MECHANISM.md` in this directory
> measured the mechanism against real gem source and a local Spree, and corrected
> several claims below. Read it first. The corrections that touch THIS file are
> listed in its final table.

Written 12 September 2026, after the four scope questions and two architecture
questions were answered. Read `FINDINGS.md` for the measurements behind it.

Status: **design, not built.** Feasibility assessed and the answer is yes, with
one real cost named at the end.

---

## What was decided

| | |
|---|---|
| Who it is for | the merchants he hosts and sells to |
| His existing page-builder content | dropped, the Next storefront replaced it |
| What a theme changes | layout, content and identity |
| How free the editor is | pick one of N prepared themes, then edit a few fields |
| Build model | one build serving many merchants, resolved by hostname |
| Where the data lives | in Spree, a small extension, exposed on the Store API |

The fourth line is the one that keeps this small. **This is a theme picker and a
settings form, not a page builder.** A prepared theme cannot be composed into an
invalid state, which removes preview, undo, draft-versus-published and every
other hard part. Layout changes by switching theme, not by dragging sections.

---

## The mechanism this rests on, measured, and corrected twice

This section was wrong twice before it was right. Both wrong versions are kept
because the second one was wrong in the dangerous direction.

**First draft, wrong:** "the publishable key identifies the tenant". It does not.
`api_key_authentication.rb:19` is:

```ruby
@current_api_key = current_store.api_keys.active.publishable.find_by(token: extract_api_key)
```

The store is resolved FIRST and the key is looked up inside it. The key is
checked against the store, it does not choose it. The concern that talks about
key binding is resolving the **channel**, which is a different thing.

**Second draft, also wrong:** "the store is resolved from the hostname". The call
looks exactly like that:

```ruby
def current_store
  @current_store ||= current_store_finder.new(url: request.env['SERVER_NAME']).execute
end
```

But the finder Spree actually ships, and which is the configured default, is:

```ruby
class FindDefault
  def initialize(scope: nil, url: nil)   # url is accepted
    @scope = scope || Spree::Store       # and never stored
  end

  def execute
    store = @scope.where(default: true).first || @scope.first
```

**It takes the hostname and ignores it.** Every request resolves to the default
store whatever host it arrives on.

### Proved with a four-way test on a local Spree with two stores

| Host | key belongs to | result |
|---|---|---|
| store A's host | store A | 200, A's 36 products |
| store B's host | store B | **401** |
| store A's host | store B | 401 |
| **store B's host** | **store A** | **200, A's 36 products** |

The last row is the one that matters. A request arriving on **B's hostname**,
carrying **A's key**, was served **A's data**. The hostname did nothing; the
request fell through to the default store, and A's key was then valid for it.

### What this means for the design

Hostname tenancy is **possible but not free**. Spree gives the seam and not the
implementation: `Spree.current_store_finder` is swappable and `current_store`
already passes the URL, so a finder that resolves `Spree::Store` by `url` is a
small object. It is simply not what ships.

And the trap is now concrete rather than theoretical. If merchants were added as
stores and their hostnames pointed at one Spree **without** replacing the finder,
every one of them would be served the default store's catalogue, orders and
customers. That is not a subtle degradation, it is one merchant seeing another's
shop, and nothing in the default configuration prevents it.

So the first thing built is the store finder, and the first test written is the
mismatched row of that table.

## The shape

```
browser  ──►  one Next build
              │  resolve Host ──► { api_url, publishable_key }   ← the only registry
              ▼
           Spree  ──► key identifies the store
                  ──► GET /api/v3/store/theme  ──► { theme: "...", settings: {...} }
```

Three pieces.

### 1. A host registry in the storefront

The one new thing the storefront needs. Host in, API base and publishable key
out. Small, cached, and the only place that knows a merchant exists.

This replaces `shopKey()`, which is read from an environment variable baked into
the image at build time. That is the single change with architectural weight:
every per-shop lookup in the storefront currently keys off a build-time constant,
and they would key off a per-request value instead.

### 2. A theme record in Spree, per store

A small extension. One row per store: which theme is selected, and the values for
that theme's declared fields. Exposed on the Store API as one endpoint, so the
storefront fetches it the same way it already fetches everything else.

It is deliberately not `spree_themes`. That table is shaped for the page
builder's copy-then-publish model, which is what produced 1,400 rows per shop for
what a merchant would think of as one design.

### 3. A meta file per theme, in the storefront

A theme declares which of its fields are editable, their types and labels. The
admin renders the form from it; the storefront reads the saved values.

The meta lives with the theme, in the storefront repository, because a field only
exists if a component reads it. Keeping the declaration next to the component
that consumes it is what stops the two drifting apart.

---

## Why the storefront is already most of the way there

Measured, not assumed. `shopTheme()` already returns a theme string; it already
drives `data-theme` on `<html>` for the palette, and it is already branched on in
TypeScript to choose between entirely different footers and top strips. Content
already lives in typed per-shop maps.

So identity and content are largely a matter of moving values from a file to a
record. Layout is the genuinely new part, and the decision to ship N prepared
themes rather than free composition means each theme owns its own component tree
rather than assembling one at runtime.

---

## The cost that has to be said out loud

**Every per-shop lookup in the storefront is currently build-time.** The shop key
comes from an environment variable, and the content maps are module constants
read at import. Moving to one build for many merchants means those become
per-request values, and anything that closed over them at module load has to
change.

That is not a reason against it. It is the actual work, and it is larger than the
theme form itself. Anyone estimating this from the meta file alone will be wrong.

Two smaller ones worth naming now rather than discovering later:

- **Caching is per merchant, not global.** Today one build serves one shop so any
  cached value is safely shared. With many merchants in one process, every cache
  key needs the tenant in it. This is the classic way a multi-tenant conversion
  leaks one customer's data to another, and it is worth a test that proves it
  rather than a review that hopes.
- **A merchant with a broken setting must not break the page.** Every declared
  field needs a default in the theme, so an empty or malformed value renders the
  theme's own fallback rather than nothing.

---

## What would be measured next

Nothing here is built yet. In order:

1. Whether a second store can be created on the local Spree, given its own
   publishable key, and whether requests with that key come back scoped to it.
   This proves the tenancy mechanism end to end before anything is built on it.
2. ~~How much of the storefront actually closes over the build-time shop key~~
   **Measured 12 September:**

   ```
   files importing shopKey      16
   call sites of shopKey()      18
   *_BY_SHOP lookups            17
   NEXT_PUBLIC_ env reads       29   (not all shop-scoped; needs sorting)
   ```

   So the conversion is roughly 16 files for the shop key itself, plus sorting
   which of the 29 environment reads are per-merchant and which are per-build.
   That is a real number and it is bigger than the theme form. It is not
   frightening, but it is the estimate, and it is where the time goes.
3. Whether a theme's fields can be declared in a way the admin can render without
   the admin needing to know anything about the storefront.
