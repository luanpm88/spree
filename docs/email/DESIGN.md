# Email template builder — design

> Level: **shape, not detail.** Enough to agree the approach and start.
> Measured facts are in `RESEARCH.md`. Everything below marked **[probed]** was
> checked by running Rails 8.1.3 with a real resolver, or by reading BuilderJS
> source, on 22 Sep. Four things in the first draft of this file were wrong and
> are corrected here.

---

## 1. What the merchant sees

```
Admin ▸ Emails
┌──────────────────────────────────────────────┐
│  Order confirmation      [edit]  [templates] │   21 emails, discovered at
│  Shipment shipped        [edit]  [templates] │   runtime from view paths,
│  Welcome                 [edit]  [templates] │   never a hardcoded list
└──────────────────────────────────────────────┘
        │                        │
   opens BuilderJS          gallery of 2-3 samples
   on this shop's saved     for THIS email type
   template
        │
        ▼
┌──────────────────────────────────────────────┐
│  BuilderJS   ·  drag, drop, type             │
│  palette shows only the Spree Blocks THIS    │
│  email supports (see §5)                     │
│  [ Send me a test ]            [ Save ]      │
└──────────────────────────────────────────────┘
```

Three properties that matter more than any feature:

- **Fallback is free.** No saved row means Rails renders the stock ERB exactly
  as today. "Put it back" is a delete.
- **Per shop.** 7 shops, 7 brands. Getting this wrong is how a payment-link
  email once carried another company's bank details.
- **Test send before save is trusted.** This project has already mailed raw
  `**` and an unfilled `%{...}` to real customers.

---

## 2. The data

One table. Spree ships none of its own, so this is additive and reversible.

```
spree_email_templates
  id
  shop_key    → one key per shop, from ENV. NOT store_id  [probed]
  view_path   → 'spree/order_mailer/confirm_email'
  locale      → 'en', 'en-CA', 'en-business'
  json  jsonb → the builder tree. Source of truth
  html  text  → derived. Produced in a browser, never on the server
  text  text  → the plain-text part. NOT optional  [probed]
  subject     → nullable. Subjects are built in Ruby, not in views
  updated_at, created_at
  unique (shop_key, view_path, locale)
```

**Why `shop_key` and not `store_id`** [probed]. 7 shops are 7 databases and 7
processes; the tenant is `ENV['SHOP_KEY']`, which `config/initializers/shop_locale.rb`
already keys on. A resolver is handed only `(name, prefix, partial, details)` —
no mailer, no store. The only global available is `Spree::Current.store`, and
`spree_core-5.6.1/app/models/spree/current.rb` falls back to `Store.default`
without ever raising. It is right today by luck, one store per database, and
becomes silently wrong the day any database holds two.

**Why `text` is a column** [probed]. `ActionMailer::Base#each_template` calls
`find_all` **once for all formats**, and `ActionView::PathSet#find_all` returns
on the first resolver that answers. So html and text must come from the *same*
resolver. A resolver serving html only produces a **single-part text/html
email** and the stock `.text.erb` is never looked for. Worse, `lib/tasks/email_smoke.rake`
reads `mail.html_part ? … : mail.body`, so on a single-part message it reports
green while every email on every shop has silently lost its plain-text
alternative.

---

## 3. From JSON to a sent email

```
  JSON  ← source of truth, stored
    │
    │  export in the BROWSER. There is no headless renderer  [probed]
    │  EmailExportPipeline: flex/grid → tables, inline styles, MSO, 600px
    ▼
  HTML + TEXT  ← stored. The server cannot regenerate these from the JSON
    │
    │  AT SEND TIME, no ERB compilation  [probed, corrected]
    │  Nokogiri walks the stored HTML:
    │    <div data-spree-block="order_summary">  →  the RENDERED output of
    │                                               the partial, locals bound
    │                                               in Ruby by a registry
    │    {{ order.number }}                      →  looked up in a whitelist map
    │    everything else                         →  left exactly as it is
    ▼
  the email
```

**The stored HTML is never compiled as a template.** The first draft of this
design turned it into ERB and injected `<%= render … %>`. That is remote code
execution: a merchant typing `<%= File.read('/srv/…/.env') %>` into any text box
runs with the application's full rights, on a box also serving ~28 other sites.
Escaping `<%` does not save it, because a BuilderJS tree has many text-bearing
fields — alt, href, custom HTML, style values — and missing one is enough. An
ERB `SyntaxError` would also raise at **send** time, inside a job, for a real
customer, rather than at save.

Replacing nodes with already-rendered output costs about the same one class and
executes nothing.

**Authors never write `<table>`.** They build modern HTML and the serializer
does the email downgrade. Hand-writing table markup fights the pipeline.

---

## 4. The seam

A **prepended** view resolver on `Spree::BaseMailer`. Not appended [probed]:
`PathSet#find_all` returns on the first resolver that answers, and this app
already has 25 mailer ERB files, plus `config/initializers/shop_views.rb`
already prepends `app/views/shops/<shop>`. Appended, the resolver would never be
called for the one shop that already has 7 email designs of its own on disk,
which is also the shop most certain to use the builder. The merchant would press Save and nothing
would happen, with no error and no log.

Prepended, a database row silently overrides a file a developer committed. So
**the precedence between file-on-disk and row-in-database is a decision, written
here and logged at boot**, not an accident of which initializer sorts first.
Decision: **a saved template wins**, because it is the thing a merchant edited
most recently, and the boot log says so.

Two things the resolver has to handle that are not obvious [probed]:

- It is consulted for layouts and for **every partial**, twice each. It must
  return `[]` cheaply and never answer a partial lookup by accident.
- `app/mailers/concerns/spree/full_document_templates.rb` decides whether to
  apply Spree's layout with `File.exist?`. A resolver template has no file, so
  that check always says false and the layout is always applied — wrapping a
  full `<html>` export inside another `<html>`, which Gmail and Outlook strip,
  discarding the design. That concern needs to learn about saved templates.

---

## 5. Blocks are per email, not per name

The first draft wrote `render 'spree/shared/order_summary'`. **That partial does
not exist** [probed]. What exists is `spree/shared/_order_summary_section`,
called from four views with *different* locals:

```erb
confirm_email:  heading: …, line_items: @order.line_items,               order: @order
shipped_email:  heading: …, line_items: @shipment.manifest.map(&:line_item),
                order: @shipment.order, totals: false
```

So a merchant dragging "Order summary" into the shipped email would get
`totals: true` and print **the whole order's total beside a partial list of
items**. Wrong money, in front of a customer, produced by a drag.

Therefore a registry in our own code, not a name the author types:

```ruby
{ 'spree/order_mailer/confirm_email' => {
    'order_summary' => ->(a) { ['spree/shared/order_summary_section',
                                heading: …, line_items: a[:order].line_items,
                                order: a[:order]] } } }
```

The palette only offers the blocks that email supports.

**The anchor must originate in the builder's element tree**, never be
post-processed into the HTML. BuilderJS's cycle is `json → canvas → content`,
and on save it writes back whatever the element tree holds — a placeholder that
exists only in the exported HTML is destroyed by the merchant's first save,
silently. Acelle hit exactly this.

The element is a real, supported extension [probed]: `Builder.registerElement`
before `load()`, `widgetsBox.addWidget` inside the load callback, and
`beforeExport(outputMode)` to render a styled preview on the canvas and a bare
anchor on export. Twelve stock elements already do this.

---

## 6. Where the code lives

```
app/models/spree/email_template.rb          the row
lib/spree/email_template_resolver.rb        the seam, serves html AND text
lib/spree/email_block_registry.rb           view_path → blocks → partial + locals
lib/spree/email_html_renderer.rb            Nokogiri replacement. Compiles nothing
app/controllers/spree/admin/email_templates_controller.rb
db/email_templates/<view_path>/<name>/{ template.json, thumb.png }
script/check_email_templates                a gate, like everything risky here
```

---

## 7. Still open

1. **Regeneration needs a browser.** HTML can only be produced by BuilderJS in a
   browser [probed], so a Spree-side change cannot be back-filled across 21
   emails × 7 shops by a migration. It is a headless-Chromium job, or re-opening
   each template. `EmailExportPipeline.prepareForEmail` is server-runnable but
   **returns its input untransformed when there is no DOM**, with no error, so
   calling it without jsdom ships flex layout into Outlook silently.
2. **Other locales.** The builder edits one locale's rendered copy.
3. **Block CSS.** `confirm_email` renders `purchased_items_styles` into
   `content_for :head`. A block dropped into a builder page has no such channel.
4. **`emails:smoke` must cover saved templates**, and must stop reporting green
   on a single-part message.
