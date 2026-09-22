# Email template builder for Spree — research notes

> **Status: PAUSED mid-research, 20 Sep.** No code written beyond one symlink
> experiment that was reverted. Two architecture questions are still open and
> are recorded at the bottom — they need answering before a plan can be
> written. Everything above them is measured fact, not proposal.

This file is the research record. The design doc (`DESIGN.md`) and the plan
(`PLAN.md`) do not exist yet and should not be written until the two open
questions are settled.

---

## 1. What was asked for

Replace Spree's built-in email templates with BuilderJS, so a merchant edits
emails visually instead of editing ERB.

- Admin gets a new **Email Builder** menu
- It lists every email the system sends, with thumbnails, filter and search
- Each email has **Choose template** (gallery of samples for that email type)
  and **Edit** (opens BuilderJS)
- Saving stores both the builder's JSON and its rendered HTML
- Sending uses that HTML
- Ship 2–3 sample templates per email type, seeded from a folder in the
  builderjs repo (`spree/**` holding `json` + `html` + `thumb.png`)

Constraint the user restated mid-session: **do not copy Acelle's schema.**
Acelle is a reference for mechanism only. The table design here has to be
clean and minimal on its own terms.

---

## 2. Spree's email system, measured

### 2.1 There is no template table. Emails are ERB views.

`spree_emails-5.6.1` ships mailers and views and **no models**:

```
spree_emails-5.6.1/app/
  mailers/spree/{customer,newsletter,order,reimbursement,shipment}_mailer.rb
  views/spree/…/*.html.erb + *.text.erb
  helpers/, assets/, subscribers/          ← no app/models
```

So there is nothing to "swap out" at the data layer. Any builder integration
has to intercept the **render**, not edit a row Spree already reads.

### 2.2 There are 21 emails, not 8

The gem ships 8 views. This app adds more (approval workflow, welcome,
invitations), and other Spree gems add their own. Counted by finding actual
`*.html.erb` views under every registered view path — a mailer method with no
template renders nothing, so the view is the honest unit:

```
admin_user_mailer#confirmation_email       newsletter_mailer#email_confirmation
admin_user_mailer#password_reset_email     order_mailer#cancel_email
customer_mailer#approval_email             order_mailer#confirm_email
customer_mailer#more_information_email     order_mailer#payment_link_email
customer_mailer#not_approved_email         order_mailer#store_owner_notification_email
customer_mailer#password_reset_email       reimbursement_mailer#reimbursement_email
customer_mailer#store_signup_notification  report_mailer#report_done
customer_mailer#welcome_email              shipment_mailer#shipped_email
export_mailer#export_done                  webhook_mailer#endpoint_disabled
import_mailer#import_done                  invitation_mailer#invitation_accepted
invitation_mailer#invitation_email

TOTAL: 21
```

Do NOT hardcode this list. It is discovered from view paths, and a gem
upgrade or a new extension changes it. Whatever ships must enumerate the same
way, at runtime.

### 2.3 Each email is a composition of partials, not a flat page

`order_mailer/confirm_email.html.erb` in full — 12 lines:

```erb
<%= render 'spree/shared/purchased_items_styles' %>

<%= render layout: 'spree/shared/mailer_hero' do %>
  <h1><%= Spree.t('order_mailer.confirm_email.subject') %></h1>
  <p class="greeting"><%= Spree.t('order_mailer.confirm_email.dear_customer', name: name_for(@order)) %></p>
  <p><%= Spree.t('order_mailer.confirm_email.instructions') %></p>
<% end %>

<%= render 'spree/shared/order_summary_section',
           heading: Spree.t('order_mailer.confirm_email.order_summary', number: @order.number),
           line_items: @order.line_items,
           order: @order %>
```

Three things to notice, all of which constrain the design:

1. The wording is **i18n keys**, not literals. A merchant editing in a builder
   is editing one locale's copy; the other locales still come from YAML.
2. `mailer_hero` is rendered **as a layout** with a block, and the shared
   partials are reused across emails. Emails are not independent documents.
3. `order_summary_section` renders line items, totals, taxes and currency
   through Ruby. No static HTML can reproduce it.

### 2.4 The split that decides the architecture: 15 static, 6 dynamic

Measured across all 21 views — counting `.each`, collection renders, and the
`purchased_items` / `order_summary` partials:

| email | lines | erb tags | renders | dynamic blocks |
|---|---:|---:|---:|---:|
| order_mailer#store_owner_notification_email | 11 | 6 | 3 | **3** |
| order_mailer#confirm_email | 12 | 7 | 3 | **3** |
| order_mailer#cancel_email | 12 | 7 | 3 | **3** |
| shipment_mailer#shipped_email | 20 | 14 | 3 | **2** |
| reimbursement_mailer#reimbursement_email | 47 | 24 | 3 | **2** |
| webhook_mailer#endpoint_disabled | 51 | 16 | 2 | **1** |
| newsletter_mailer#email_confirmation | 12 | 9 | 2 | 0 |
| customer_mailer#password_reset_email | 10 | 10 | 2 | 0 |
| customer_mailer#welcome_email | 53 | 29 | 3 | 0 |
| order_mailer#payment_link_email | 11 | 8 | 2 | 0 |
| customer_mailer#store_signup_notification | 45 | 18 | 2 | 0 |
| customer_mailer#not_approved_email | 3 | 2 | 1 | 0 |
| customer_mailer#more_information_email | 3 | 2 | 1 | 0 |
| admin_user_mailer#confirmation_email | 7 | 7 | 2 | 0 |
| admin_user_mailer#password_reset_email | 8 | 8 | 2 | 0 |
| export_mailer#export_done | 7 | 7 | 2 | 0 |
| import_mailer#import_done | 12 | 12 | 2 | 0 |
| invitation_mailer#invitation_accepted | 4 | 4 | 1 | 0 |
| invitation_mailer#invitation_email | 12 | 8 | 2 | 0 |
| report_mailer#report_done | 7 | 7 | 2 | 0 |
| customer_mailer#approval_email | 3 | 2 | 1 | 0 |

**15 of 21 are completely static** — hero, copy, a button, a footer. A builder
handles those with nothing extra.

**6 of 21 carry a dynamic block** — and they are the six that matter most
commercially (order confirmed, cancelled, shipped, refunded, store owner
notification, webhook alert). They need line items, prices, taxes, currency,
addresses. This is the whole design problem. See open question A.

### 2.5 The dynamic data each email reads

Instance variables across all views, by frequency:

```
14 @order      12 @user       9 @shipment    9 @reset_url
 9 @copy_scope  6 @note       6 @current_store  4 @contact_url
 3 @reimbursement  3 @confirm_email_url  3 @checkout_payment_url  2 @storefront_url
```

### 2.6 The mailers set variables and call `mail` — nothing else

```ruby
def confirm_email(order, resend = false)
  @order = order.respond_to?(:id) ? order : Spree::Order.find(order)
  current_store = @order.store
  with_store_locale(current_store, @order.locale) do
    subject = order_email_subject(current_store, Spree.t('…subject'), @order.number, resend: resend)
    mail(to: @order.email, subject: subject, store_url: current_store.storefront_url)
  end
end
```

`mail` is owned by `Spree::BaseMailer`. `with_store_locale` sets the locale
and restores it. Subjects are built in Ruby, not in the view — so a builder
that edits the body does **not** edit the subject line. That is a gap to
decide on later (probably a plain text field beside the builder).

### 2.7 Seams available, none of which patch the gem

Verified in the running app:

```
ActionMailer::Base.register_interceptor → true
ActionMailer::Base.register_observer    → true
Spree::BaseMailer ancestors: [Spree::BaseMailer, <anon>, <anon>, ActionMailer::Base, …]
```

and `CLAUDE.md` in this repo already ranks the options: events/subscribers →
swapping services → extensions → decorators last, because decorators couple
to Spree internals and make upgrades harder.

This app already overrides views (`app/views/spree/customer_mailer/*.erb`) and
already uses mailer decorators (`app/mailers/spree/*_decorator.rb`), so both
patterns are established here. See open question B.

---

## 3. BuilderJS, what the integration contract actually is

Source: `~/apps/builderjs/docs/BUILDER.md` (6065 lines) and
`~/apps/acelle/docs/builderjs-integration/BUILDER_CONNECT.md` (1104 lines).

### 3.1 Email is a downgrade of PAGE, not a template type

Straight from the product mental model, and it changes how templates should be
authored:

> BuilderJS is a **full HTML5 page builder**… **Email is a
> DOWNGRADE-CONSUMER, not a peer.** Email output is a **serializer-level
> transform** on a PAGE tree: strip flex/grid → table layout, inline styles,
> MSO conditionals, ~600px frame… Authors do not "build emails"; they build
> pages that can be emitted as email.

Consequences for us:

- Template type is `Page`. There is no "Email" type.
- Sample JSON authors **modern HTML** (flex/grid/div). `EmailExportPipeline`
  rewrites to tables at emit time when `Builder.getOutputMode() === 'email'`.
  Hand-writing `<table>` markup in a template is explicitly called out as the
  wrong instinct (BUILDER.md Trap 3).
- So the Spree bucket must set output mode to email, and author templates the
  modern way.

### 3.2 Loading — four named globals, never a wrapper (RULE I, hard rule)

```js
window.THEME_JSON        = { … };   // page tree
window.THEME_TEMPLATES   = { … };   // 39 EJS template strings
window.THEME_CONFIG_DATA = { … };   // fonts / colors / sizes
window.MEDIA_URL         = "…";     // base URL for image src

builder.load(THEME_JSON, THEME_TEMPLATES, THEME_CONFIG_DATA, MEDIA_URL);
```

A `BUILDER_BUNDLE` wrapper is a documented regression with a CI grep gate
against it. Whatever the Spree admin emits must use these four names.

### 3.3 Saving — two calls, both synchronous

From `demo/assets/js/builder-chrome.js`:

```js
var html = builder.getHtmlWithRelativeLinks?.() ?? builder.getHtml();
payload.append('html', html);
payload.append('data', JSON.stringify(builder.getData()));
```

So the save contract is exactly the pair the user described: **JSON is the
source of truth, HTML is the rendered artefact.** Acelle's docs state the same
rule explicitly ("the JSON is the source of truth… on first save the canvas
exports fresh HTML which overwrites the stub").

### 3.4 Sample layout on disk

`demo/themes/default/master/sample/email/` — every template is a triple:

```
AboutOurServices.json     ← the tree (source of truth)
AboutOurServices.html     ← rendered, regenerated, never hand-edited
AboutOurServices.png      ← thumbnail
```

Existing buckets: `ads compat email form funnel internal page system`. A
`spree/` bucket alongside them is consistent with how the repo is already
organised, which matches what the user asked for.

Rules when authoring samples (BUILDER.md "Before adding a new SAMPLE JSON"):
cell widths need explicit units, `%` rows must sum ≤ 100, HTML is regenerated
via `node scripts/core/gen-html.cjs`, images resolve through `themeMediaUrl`
with **no absolute URLs**, and the sample must load with zero page errors.

### 3.5 Build and ship flow

```
cd builderjs && npm run build        # MUST build before copying
./copy.sh --target=<app> --type=master
```

`dist/` currently holds `builder.js` (5.4 MB), `builder.css` (277 KB) and
`fonts/`. Version 7.0.1.

---

## 4. The symlink — what was tried, and why it failed

The user asked for `ln -s dist` into the spreetheme demo admin for
development. Tried:

```bash
mkdir -p public/builder
ln -sfn ~/apps/builderjs/dist public/builder/dist
```

On the host it resolves. **Inside the container it does not:**

```
/rails/public/builder/dist -> /Users/luan/apps/builderjs/dist
ls: cannot access '/rails/public/builder/dist/': No such file or directory
```

Because `docker-compose.dev.yml` bind-mounts only the project:

```yaml
volumes:
  - .:/rails
  - bundle_cache:/usr/local/bundle
  - storage_data:/rails/storage
```

A symlink pointing outside the mount has no target inside the container. The
experiment was reverted (`rm -f public/builder/dist`); nothing is left behind.

**The fix belongs in the plan, not in a symlink:** add a read-only bind mount
for the builder dist, so the path exists on both sides.

```yaml
# docker-compose.dev.yml, web service
- ~/apps/builderjs/dist:/rails/public/builder/dist:ro
```

Host path is developer-specific, so it should be a variable with a default and
the mount should tolerate being absent. Also note `public/` currently holds
only `assets/`, so serving from `public/builder/` needs checking against how
this app serves static files in dev.

---

## 5. Acelle, as a reference only

Read to understand mechanism. **Its schema is explicitly not the model to
copy** (user instruction, mid-session).

What Acelle does, for context:

- `templates` table carries `content` (html) + `json` + `path` + `thumbnail`
- `system_email_templates` is a thin mapping table: `name` + `template_id`
- `php artisan template:reset` re-seeds system templates from the copied theme
  folder; the seeder writes thumbnails into storage at seed time
- Builder routes look like `/rui/email-templates/{uid}/builder`

The useful ideas are the **separation** (a template library, and a mapping
from a system email to a chosen template) and the **JSON-is-truth** rule.
The table shapes themselves are Acelle-specific and carry legacy columns.

---

## 6. Open questions — ANSWER THESE BEFORE WRITING A PLAN

### A. How do the 6 dynamic emails keep their line-item tables?

A builder exports static HTML. `order_summary_section` renders line items,
prices, taxes and currency through Ruby. Options put to the user:

1. **Slot / anchor element.** A "Spree Block" element the author drags in; it
   previews statically while editing and exports as an anchor
   (`<div data-spree-block="order_summary">`). At send time Spree renders the
   real partial into it. Author controls placement; Spree stays the source of
   truth for money.
2. **Phase 1 = the 15 static emails only.** Lowest risk, fastest, but leaves
   the six commercially important emails on ERB.
3. **Merge tags** (`{{order.number}}`). Solves scalar values, does **not**
   solve the tables — the six would still need mechanism from option 1.

### B. Which seam renders the stored HTML?

1. **View resolver** (`append_view_path` / custom resolver). A DB-backed
   resolver sits in front of the gem's views; falls through to the original
   ERB when no template is saved. Rails-native, keeps layouts, partials and
   i18n ordering, touches no mailer. Free fallback.
2. **ActionMailer interceptor.** One registration point, sees the built
   `Mail::Message`, swaps the HTML part. Very small, but the view has already
   rendered (wasted work) and `@order` context is gone by then.
3. **Per-mailer decorators.** Most control, keeps context, but one file per
   mailer and a standing obligation to notice when Spree adds an email — the
   pattern `CLAUDE.md` says to use last.

---

## 7. Things already learned that any plan must respect

1. **Enumerate emails from view paths at runtime.** 8 in the gem, 21 in this
   app. A hardcoded list is wrong the day a gem is upgraded.
2. **Subjects are built in Ruby**, not in views. Editing the body does not
   edit the subject.
3. **Wording is i18n keys.** Builder editing produces one locale's copy;
   decide what happens to the others rather than discovering it later.
4. **JSON is the source of truth, HTML is derived.** Both stored; HTML
   regenerated on every save.
5. **Author modern HTML in samples**, never hand-written tables — the email
   downgrade is the serializer's job.
6. **Four globals, never a wrapper** (`builder.load()` RULE I).
7. **The container cannot follow a symlink out of its bind mount.** Use a
   compose mount.
8. **`text` parts exist too.** Every email has a `.text.erb` sibling. A
   builder that only produces HTML leaves the text part unanswered — decide
   whether to keep the ERB text part, auto-derive text from HTML, or drop it
   (dropping hurts deliverability).
