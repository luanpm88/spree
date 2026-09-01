# Spree Commerce Backend

This is a Rails application powered by [Spree Commerce](https://spreecommerce.org).

## Spree Documentation

If `@spree/docs` is installed (via the parent project's `package.json`), full developer docs are at:
`../node_modules/@spree/docs/dist/`

Key resources:
- `dist/developer/core-concepts/` — Products, orders, payments, inventory, etc.
- `dist/developer/customization/` — Decorators, extensions, configuration, dependencies
- `dist/api-reference/store.yaml` — OpenAPI 3.0 spec with all Store API endpoints, parameters, and response schemas. Read this when working on API integrations or building against the Store API.

Otherwise, refer to:
- https://spreecommerce.org/docs/llms.txt - links to all documentation pages in markdown
- https://spreecommerce.org/docs/api-reference/store.yaml - Store API OpenAPI 3.0 spec

## Architecture

- Rails app with Spree engines mounted at `/`
- Admin dashboard at `/admin`
- Store API v3 at `/api/v3/store/`
- Admin API v3 at `/api/v3/admin/`
- Background jobs via Solid Queue (in Postgres, runs inside Puma by default) — dashboard at `/jobs`
- Product search runs on the database by default; optional Meilisearch provider activates when `MEILISEARCH_URL` is set (compose service ships commented out)

## Key Files

| File | Purpose |
|------|---------|
| `config/initializers/spree.rb` | Spree configuration, dependencies, permissions |
| `config/routes.rb` | Route mounting and authentication |
| `Gemfile` | Spree gem versions and extensions |
| `.env` | Environment variables (`SPREE_PATH` for local dev) |

## Customization Patterns

MUST use this in this order — decorators should be a last resort as they couple your code to Spree internals and make upgrades harder.

### 1. Events & Subscribers (preferred for side effects)

React to model changes without touching Spree source. Use for syncing to external services, sending notifications, updating caches, etc.

```ruby
# app/subscribers/spree/my_order_subscriber.rb
module MyApp
  class OrderSubscriber < Spree::Subscriber
    subscribes_to 'order.complete'

    def handle(event)
      order = Spree::Order.find_by_prefix_id(event.payload['id'])
      ExternalService.notify(order)
    end
  end
end
```

Register in `config/initializers/spree.rb`:

```ruby
Rails.application.config.after_initialize do
  Spree.subscribers << MyApp::OrderSubscriber
end
```

### 2. Swapping Services (Dependencies)

Create a new service inheritting from Spree service, eg.

```ruby
module MyApp
  module Cart
    class AddItem < Spree::Cart::AddItem
      def call(order:, variant:, quantity: nil, metadata: {}, public_metadata: {}, private_metadata: {}, options: {})
        ApplicationRecord.transaction do
          run :add_to_line_item
          run :my_app_custom_logic_here
          run Spree.cart_recalculate_service
        end
      end
      
      def my_app_custom_logic_here
        # ...
      end
    end
  end
end
```

Regiser in `config/initializers/spree.rb`:

```ruby
Spree.dependencies do |dependencies|
  dependencies.cart_add_item_service = 'MyApp::Cart::AddItem'
end
```

### 3. Adding Extensions

Add to `Gemfile`

```ruby
gem 'spree_stripe'
```

Run `bundle install`

Run extension installator. eg `bin/rails g spree_stripe:install`
Convention is `bin/rails g <extension_name>:install`

### 4. Decorators (last resort)

Only use for structural changes (adding associations, validations, scopes). Avoid for callbacks and side effects — use subscribers instead.

```ruby
# app/models/spree/product_decorator.rb
module Spree
  module ProductDecorator
    def self.prepended(base)
      base.has_many :reviews, class_name: 'MyApp::Review', dependent: :destroy
      base.validates :custom_field, presence: true
    end
  end

  Product.prepend ProductDecorator
end
```

## Where this project is right now

**Read `docs/PLAN.md` first, before anything else.** It answers: what is the next
action, what are we blocked on, what did we promise the client and when. When the
user says "continue" with no other context, that file is the context.

`docs/plan.json` is the single source of truth. `docs/PLAN.md` and the dashboard are
both generated from it, so never edit the markdown by hand.

```bash
script/plan status     # one screen: doing / waiting / risks / last contact
script/plan validate   # schema + referential integrity
script/plan render     # regenerate docs/PLAN.md after editing plan.json
script/plan check      # validate + fail if PLAN.md is stale
```

Update `plan.json` as work happens: a new client message goes in `timeline`, a new
ask goes in `waiting_on_client`, a finished task moves to `done`. Then run
`script/plan render`. Bump `meta.updated` and `meta.revision`.

Dashboard: `http://admin.spree.local` (nginx vhost, re-reads the JSON every 10s).
Verify it with `node script/check_dashboard.mjs`.

> `docs/plan.json`, `docs/PLAN.md` and `tmp/client/` are gitignored on purpose. This
> repo is public, and they name the client's shop domains and the Spree version each
> shop runs. Never commit client material here.

## Is the estate healthy

```bash
script/health              # every shop: containers, pages, images, data, mail, payments
script/health ca           # one shop
script/health --quick      # no browser, fast enough to repeat
script/health --explain    # what each check is for, and the fault behind it
```

One command, seven shops, and every failure class this project has actually had.
Run it after touching anything and on any morning somebody asks whether the shops
are fine. `docs/MAINTENANCE.md` explains each line and what to run when one is red.

**Suspect the check before the shop.** On 28 Aug four red lines out of seven were
the measurement being wrong, so every message names the command that reproduces it.

## Before you call anything done

```bash
script/check_all                          # the static gates
script/check_all https://<host> ca en     # those, plus a browser walk of that shop
```

It exits non-zero when a gate fails. Do not report a change as finished until it
passes, and do not report a shop as working until the browser walk passes: on
17 Aug a shop rendered perfectly, answered 200 everywhere, and could not take an
order, because every check up to then read HTML instead of clicking.

The gates it runs, and the failure each one already caught here:

| Gate | It catches |
|---|---|
| `check_no_client_data` | This repo is public. Reads new files too, because a file is most dangerous in the minutes before it is committed |
| `check_deploy_assets` | A gitignored file the app loads that the deploy leaves behind. Took the backend down once |
| `check_storefront_args.sh` | An undeclared Docker `ARG`, which is dropped silently and builds a storefront with the value missing |
| `check_copy_markup` | A bold run or link the copy never closes, which prints `[text](url)` to a customer. His pages are pulled off his live site, so a paragraph break inside a link label splits the marker in two |
| `check_shop_content` | A shop with no copy of its own. It does not render an empty page, it renders another shop's page, wording and all |
| `check_shop_locales` | The same thing in email. A shop with no wording of its own sends the shared file, which is another of his brands, down to the support address. Four shops were telling customers to write to a different country |
| `check_untracked_source` | A new `.rb`/`.erb`/`.rake` the deploy leaves behind, because it sends `git ls-files`. Three times in one afternoon |
| `script/plan check` | A stale `PLAN.md`, so the next person reads yesterday |
| `check_storefront_e2e.mjs` | A shop that renders and cannot sell. It clicks: images decoded, row links, add to cart, the cart, formatting, old addresses |
| `bin/rails emails:smoke` | Per shop, on the box. Every transactional email is built, and the rendered body is checked for raw `**` and for an unfilled `%{...}`, which I18n does not raise on and prints to the customer |

**Measure, never infer.** Every claim in a message to the client is something that
was run, not something the code implies. Twice on 17 Aug a measurement was wrong
and the conclusion drawn from it was wrong with it: two different categories were
compared and read as "the slugs changed", and the client was told his data had been
edited when the rows were a year old and sat in his own pre-upgrade dump.

**A probe must not set up the thing it is measuring.** On 19 Aug a mailer fix was
reported as working on the strength of a script that opened with

```ruby
I18n.locale = Spree::Store.default.default_locale
```

The mailer never does that, and the missing locale switch was the entire bug. The
probe had quietly repaired it, then measured the repair. Every line in a probe
that arranges state is a line that can hide the fault: set only what the caller
sets, and if you are unsure whether the real path sets something, print it rather
than assign it. Three shops shipped in that state and the same script called them
green.

## Where a lesson goes, so it is never lost again

Four files, one kind of knowledge each. Anything learned goes in one of them the
day it is learned, not "later".

| | |
|---|---|
| `docs/DISCOVERIES.md` | A technical finding about Spree, Next or the API. Numbered, with the measurement that proved it. **Check here first when something behaves oddly** |
| `docs/CUTOVER.md` | A gate that must hold on changeover day. Gitignored: it names his shops |
| `docs/plan.json` → `learnings` | How we work: a habit that failed, a check that should exist. Rendered into `PLAN.md` |
| `docs/VOICE.md` | How to write to him. Gitignored: it quotes him |

Write it as **what happened**, not as advice. "A checklist that says it verified
nothing is worse than no checklist, and it happened four times in one day" carries
more than "verify carefully".

## How the client hands work over

He reviews by screenshotting a page, drawing a box on it, and writing what is wrong
beside the box. Those notes are the specification, and they arrive as images in
chat rather than as text.

```bash
script/read_annotations --notes "shot.png"    # every note, with its position
script/read_annotations --zoom  "shot.png"    # again tile by tile, catches small writing
script/read_annotations "a/directory"         # every image in it
```

Run **both** passes and take the union: each has found a note the other missed, and
a missed note is a missed requirement.

Three things about this that have already cost a round trip:

**He re-annotates and resends.** On 17 Aug four of six screenshots were replaced
with versions carrying three more notes. Compare checksums against what you already
read rather than trusting the filename.

**It reads words, not arrows.** Which element a note points at is inferred from its
coordinates. State the mapping out loud — "the note at x37 y78, which I read as
pointing at the shipping notice" — so he can correct it in one line.

**Matching his words is not matching his page.** Every sentence on three pages was
verified present and he still said it was not right, because the notes were about
boxes, weights, spacing and colour. Text parity and visual parity are separate
claims and only one of them was measured.

To take a shop's page copy off his live site with its formatting intact, rather than
retyping it:

```bash
python3 script/pull_page_copy.py https://<his-shop>/pages/about
```

## Building a shop's storefront

```bash
script/shop_host storefront <shop>    # override file, both vhosts, certificates, build, start
script/shop_host admin_image <shop>   # his picture on the admin sign-in screen
```

One command per shop, because doing it by hand five times is five chances to
diverge. It reads that shop's own publishable key, store name and collection ids
from its own database and API, and it refuses to build when the collection ids come
back empty: an empty build arg renders a home page row as nothing at all and says
nothing about it.

## Project documentation

Read these before making assumptions — they record what was verified against the
running system, not what the upstream docs claim. Index: `docs/README.md`.

| | |
|---|---|
| `docs/PLAN.md` | **Start here.** Where the engagement is, what is blocked, what is next |
| `docs/VOICE.md` | **Read before writing to the client.** How messages and tracker comments are written here, built from the real corpus. Gitignored, it quotes him |
| `docs/DESIGN.md` | Architecture, data model, B2B mechanism, extension points |
| `docs/LOCAL.md` | Docker dev setup + the failures already hit, with root causes |
| `docs/DEPLOY.md` | `script/deploy`, server survey, the memory situation |
| `docs/DISCOVERIES.md` | Every non-obvious finding. **Check here first when something behaves oddly.** |
| `docs/TOOLING.md` | The automation scripts (screenshots, PDFs, permission audit) |
| `docs/HANDOVER.md` | Client-facing handover (English, standalone) |
| `docs/USER_GUIDE.md` | Beginner → advanced guide |

## Development

Everything runs in Docker — no host Ruby needed. `make help` lists every target.

```bash
make setup             # first time: build, boot, create DB, seed, sample data, admin
make up / make down    # start / stop
make console           # Rails console
make logs              # tail web logs
make css               # build admin Tailwind (REQUIRED — /admin 500s without it)
make test              # rspec
```

Native equivalents (`bin/setup`, `bin/dev`, `bin/rails …`) still work if you have
Ruby 4.0.1 locally.

> Database commands use `run --rm`, not `exec`: on an empty database Puma boots Solid
> Queue in-process, the supervisor raises on missing tables and takes Puma down, so
> there is no container to exec into. See `docs/LOCAL.md §5.4`.

## Deployment

**No CI.** Deployment is a script you run and watch:

```bash
script/deploy help
script/deploy ship backend    # build for amd64 → stream over SSH → release
script/deploy status
```

The server never builds images (shared 1.9GB box also serving ~28 other sites).
Details and rationale in `docs/DEPLOY.md`.

## Coding Conventions

- All custom code goes in `app/` — never modify gem source
- Use decorators in `app/models/spree/` for model extensions
- Use `Spree.user_class` / `Spree.admin_user_class` — never reference `Spree::User` directly
- All Spree models are namespaced under `Spree::` (e.g., `Spree::Product`, `Spree::Order`)
- Use `Spree::Current.store`, `Spree::Current.currency`, `Spree::Current.locale` for request context
- Prefixed IDs in API (e.g., `prod_86Rf07xd4z`) — never expose raw database IDs
- Events system for side effects: `order.publish_event('order.completed')`
- CanCanCan for authorization, Ransack for filtering, Pagy for pagination

## Testing

Native (host Ruby):

```bash
bundle exec rspec                           # Full test suite
bundle exec rspec spec/models/              # Model specs only
bundle exec rspec spec/models/my_model.rb   # Single file
```

Docker (via `@spree/cli`): `spree rspec …` runs the same commands inside the web container with `RAILS_ENV=test`, against the `spree_test` database. First run: `spree rails db:test:prepare`.
