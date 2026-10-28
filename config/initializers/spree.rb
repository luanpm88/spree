# frozen_string_literal: true

# Spree settings are configured with environment variables, see
# https://spreecommerce.org/docs/developer/customization/configuration
# Anything that shapes how a shop sells (currency, taxes, when customers are
# charged, order number prefix) belongs to the store and is edited in the
# dashboard, not here.
Spree.config do |config|
  # Six, not Spree 6.0's default of eight, and in code rather than per shop.
  #
  # Every storefront form that takes a password checks for six characters: the
  # wholesale application, registration and password reset. With the backend at
  # eight, a password of six or seven passes the form and is refused by the API,
  # and the applicant sees an error the page told them they had avoided. The
  # forms are the same code on every shop, so the floor they promise is set for
  # every shop here, not in seven .env files that can drift.
  #
  # Raising it to eight is a change customers see, which is the client's call.
  config.minimum_password_length = 6
end

Spree.dependencies do |dependencies|
end

# Roles: none are set up here on Spree 6.0.
#
# 5.6 gave a role its meaning in this file (Spree.permissions.assign with
# permission sets). 6.0 removed permission sets; a role's permissions are data on
# the role, edited in the dashboard. The two shops on 6.0 so far have only the
# built-in admin role, which has every permission. A shop with custom roles
# (manager, catalog, fulfillment, sales_b2b, Sales, support) needs them seeded as
# data before it moves, see docs/PLAN_6-0.md section 9.1.2.

# Order numbers (EB…, ENZW… plus nine random digits) are store preferences on 6.0,
# order_number_prefix and document_number_format, set once on each store when it
# moves. 5.6 set the prefix here from ORDER_NUMBER_PREFIX; 6.0 ignores that
# variable.

# Spree 6.0's own models. Until 6.0 these were Devise models of ours,
# Spree::User and Spree::AdminUser; spree:upgrade copies both tables over, ids and
# password hashes included.
Spree.customer_class = 'Spree::Customer'
Spree.admin_user_class = 'Spree::AdminUser'

# Make the Store API's customer_groups mean "the groups that approve you".
#
# The storefront decides wholesale approval by counting that array, which was right while
# every group meant approved and became wrong the moment More Information and Not Approved
# existed: a declined customer had one group, counted as approved, and was shown the full
# portal the API then refused to price. See
# Spree::Api::V3::ApprovalScopedCustomerSerializer for the whole argument.
#
# STORE only. admin_customer_serializer is a separate dependency and stays unfiltered, so
# an admin can still see that somebody is in Not Approved, which is how they explain why
# that customer has no prices.
Spree.api.customer_serializer = 'Spree::Api::V3::ApprovalScopedCustomerSerializer'

# Serve Active Storage attachment URLs (product images, logos, etc.) from a CDN
# host instead of the application host. Host only, no protocol — the scheme
# comes from routes.default_url_options (see config/environments/production.rb).
Spree.cdn_host = ENV['CDN_HOST'] if ENV['CDN_HOST'].present?

# Background job queue configuration. Every queue named here is also listed in
# config/queue.yml, or its jobs never run.
Spree.queues.default = :default
Spree.queues.addresses = :spree_addresses
Spree.queues.api_keys = :spree_api_keys
Spree.queues.categories = :spree_categories
Spree.queues.collections = :spree_collections
Spree.queues.coupon_codes = :spree_coupon_codes
Spree.queues.data_requests = :spree_data_requests
Spree.queues.events = :spree_events
Spree.queues.exports = :spree_exports
Spree.queues.gift_cards = :spree_gift_cards
Spree.queues.images = :spree_images
Spree.queues.imports = :spree_imports
Spree.queues.payment_webhooks = :spree_payment_webhooks
Spree.queues.payouts = :spree_payouts
Spree.queues.products = :spree_products
Spree.queues.search = :spree_search
Spree.queues.stock_location_stock_levels = :spree_stock_location_stock_levels
Spree.queues.stock_reservations = :spree_stock_reservations
Spree.queues.tax_identifiers = :spree_tax_identifiers
Spree.queues.variants = :spree_variants
Spree.queues.webhooks = :spree_webhooks

# Search provider
if ENV['MEILISEARCH_URL'].present?
  Spree.search_provider = 'SpreeMeilisearch::SearchProvider'
end

# Customer emails that Spree does not ship.
#
# to_prepare rather than after_initialize: the flag lives on Spree::Customer, which is
# reloadable in development, and an after_initialize assignment is lost on the first
# code reload. The symptom is an email that works until you edit a file.
Rails.application.config.to_prepare do
  # Off unless the store asks for it. It fires on after_create_commit for EVERY user
  # row, which includes seeds, sample data and a bulk customer import. A CSV import
  # that silently emails five thousand people is not a sensible default.
  Spree.customer_class.send_welcome_emails = ENV['SEND_WELCOME_EMAILS'] == 'true'

  # No set-your-password link in the welcome email on this deployment.
  #
  # Evidence, from the client's own storefront rather than from an opinion:
  # storefront/src/app/[country]/[locale]/(wholesale)/wholesale/apply/page.tsx collects a
  # password on the application form. An `apply-password` field, minimum six characters,
  # autoComplete="new-password", posted as both password and password_confirmation. So an
  # applicant has chosen a password before this email is sent.
  #
  # His own wording agrees: "Your business account has been created successfully. You can
  # now sign in and browse our product range." Handing that customer a link to set a
  # password thirty seconds after they set one reads as a broken email.
  #
  # Left as true by default in the mailer, because a shop whose ADMIN creates customer
  # accounts has no other way to let them in. Flip this back if that day comes.
  Spree::CustomerMailer.welcome_includes_password_link = false
end

# Tell the shop when somebody signs up and is waiting to be approved.
#
# Registered rather than switched by an env var, because it needs no switch: it does
# nothing at all unless the store has an address in "New Order Notifications Email",
# and it skips anyone who already belongs to a customer group. A seed or a bulk import
# of already-approved trade customers is silent by construction.
Rails.application.config.after_initialize do
  Spree.subscribers << SpreeStarter::SignupNotificationSubscriber
  Spree.subscribers << SpreeStarter::ApprovalNotificationSubscriber
end

# Emails this shop does not send.
#
# The client's B2B shops hand fulfilment and refunds to his own invoicing system, so a
# shipment or a refund never happens inside Spree and an email about one is a customer
# being told something untrue by a system that does not know.
#
# ── why this is not a setting he can reach ──────────────────────────────────
#
# Spree has exactly one switch, Store#preferred_send_consumer_transactional_emails,
# default TRUE, and it gates order confirm, shipped, refund, customer and newsletter
# together. There is no per-email switch anywhere in 5.6.1 or 6.0.0. Turning it off
# to stop the shipped email would take the order confirmation with it, which is the one
# email he most wants.
#
# ── why deleting his wording is not the same as turning it off ──────────────
#
# The obvious move looks like removing the section from his en.yml. That does not stop
# anything: Spree carries its own English for every one of these, so the email still
# goes out, in Spree's default voice, about a shipment his own system is handling. Worse
# than either sending his copy or sending nothing.
#
# ── env var, not hardcoded ─────────────────────────────────────────────────
#
# Four of the seven shops being migrated onto this codebase are retail (nz, au, us, ca).
# They ship real parcels and they want the shipped email. Only the B2B shops move
# fulfilment out. So this belongs in the environment of the shop that wants it, and the
# retail shops simply do not set it.
#
#   DISABLED_EMAILS=shipment,reimbursement
#
# Absent from the map on purpose: order (confirm is wanted) and customer (that one
# carries password reset, which must never be switchable off by a typo).
#
# after_initialize, and the ordering is load-bearing in both directions.
#
# spree_emails registers its concat inside its own engine's config.after_initialize,
# which is added when the engine class loads at Bundler.require time. This block is
# added later, during load_config_initializers, so the concat has already run and there
# is something to delete. Spree::Events.activate! is added later still, by an
# initializer declared `after: :load_config_initializers`, so it reads the array after
# this has pruned it. Move any of the three and the switch silently stops working.
#
# Code reloads are covered too: Spree's to_prepare calls Events.reset! then activate!,
# and both read Spree.subscribers fresh, so a class removed here stays removed.
Rails.application.config.after_initialize do
  # Local, not a top level constant: an initializer that defines one puts it on Object
  # for the life of the process, and this is read exactly once.
  #
  # Referencing the classes is safe in this phase for the plainest possible reason:
  # spree_emails' own engine names the same constants in its own after_initialize block
  # to register them.
  #
  # The names are the 5.6 ones on purpose, because they are what each shop's .env
  # already says. 6.0 renamed the things behind them: a shipment is a fulfilment
  # and a reimbursement is a refund on a return. The old subscriber classes are
  # gone, and naming them here would stop the boot of every shop, not only the
  # ones that set the variable.
  optional = {
    'shipment' => Spree::FulfillmentEmailSubscriber,
    'reimbursement' => Spree::ReturnEmailSubscriber,
    'newsletter' => Spree::NewsletterSubscriberEmailSubscriber
  }

  requested = ENV.fetch('DISABLED_EMAILS', '').split(',').map { |name| name.strip.downcase }.reject(&:empty?)

  # A typo raises instead of being ignored. A silent no-op here means a customer
  # receives an email the shop believes is switched off, and nobody finds out until
  # they reply to it. Failing at boot means finding out during a deploy.
  unknown = requested - optional.keys
  if unknown.any?
    raise "DISABLED_EMAILS: no such email #{unknown.join(', ')}. Valid: #{optional.keys.join(', ')}"
  end

  requested.each { |name| Spree.subscribers.delete(optional.fetch(name)) }
end

# The approval note is written through Spree::CustomerDecorator#approval_note=,
# which merges one key into the customer's metadata. 5.6 put it on the Rails admin
# customer form through Spree::PermittedAttributes; 6.0 has neither, and where the
# shop types it on 6.0 is the dashboard (docs/MIGRATION_6-0.md).

# Make joining a customer group publish an event.
#
# Spree::CustomerGroupUser has publish_events true but lifecycle_events_enabled
# false, so approving a customer, which is exactly this row being created, fires
# nothing at all. This is the only moment the shop has to tell an applicant they
# can now see prices, and without this line it passes silently.
#
# Create only. An update on a join table carries no meaning worth an event, and a
# delete would mean somebody was un-approved, which is not something to email
# about.
#
# to_prepare, because publishes_lifecycle_events guards against double
# registration with its own lifecycle_events_enabled flag and is safe to re-run,
# and because the class is reloadable in development.
Rails.application.config.to_prepare do
  Spree::CustomerGroupUser.publishes_lifecycle_events only: [:create]
end

# Make editing a category publish an event, for the same reason and by the same
# mechanism.
#
# The storefront caches its category tree under Next's `hours` profile, which
# revalidates after an hour and holds an idle entry for a day. Nothing cleared it,
# so a category change took between one hour and a day to reach the shop. The
# client hit both ends of that on 2 September. First:
#
#   "category pages become 404 error pages"
#
# He had just restructured the tree: 37 of 42 taxons on that shop were modified
# within the hour. The cached MENU still held the old tree, so every link in it
# pointed at a permalink that no longer existed. The 404s were real and the pages
# were fine; the menu pointing at them was a day old.
#
# Then the next morning:
#
#   "All the menu changes on [that shop] are now live. Is this due to the cache?"
#
# Yes. The entry had aged out overnight. Measured after he asked: 0 of 40 menu
# links 404 by then.
#
# Products already publish and the storefront already purges on them. Taxons do
# not: Spree::Taxon, Taxonomy and Classification all carry publish_events true and
# lifecycle_events_enabled FALSE, so the change with the LONGEST cache life was the
# one nothing could see. That asymmetry is worth stating plainly, because a fix
# that covered products and missed categories would have looked complete and would
# have left his slowest case exactly as it was.
#
# All three, and all events on each:
#
#   Category         a category renamed, moved, added or removed
#   ProductCategory  a product joining or leaving a category, and reordering within
#                    one, which changes what the category page shows
#
# On 6.0 a taxon is a Spree::Category and a classification a Spree::ProductCategory,
# and taxonomies are folded into categories. The event names follow the class:
# category.*, product_category.*. The storefront's revalidation has to listen for
# those names on 6.0.
Rails.application.config.to_prepare do
  Spree::Category.publishes_lifecycle_events
  Spree::ProductCategory.publishes_lifecycle_events
end
