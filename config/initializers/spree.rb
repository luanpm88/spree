# frozen_string_literal: true

# Configure Spree Preferences
#
# Note: Initializing preferences available within the Admin will overwrite any changes that were made through the user interface when you restart.
#       If you would like users to be able to update a setting with the Admin it should NOT be set here.
#
# Note: If a preference is set here it will be stored within the cache & database upon initialization.
#       Just removing an entry from this initializer will not make the preference value go away.
#       Instead you must either set a new value or remove entry, clear cache, and remove database entry.
#
# In order to initialize a setting do:
# config.setting_name = 'new value'
#
# More on configuring Spree preferences can be found at:
# https://docs.spreecommerce.org/developer/customization
Spree.config do |config|
  # Example:
  # Uncomment to stop tracking inventory levels in the application
  # config.track_inventory_levels = false
end

# Configure Spree Dependencies
#
# Note: If a dependency is set here it will NOT be stored within the cache & database upon initialization.
#       Just removing an entry from this initializer will make the dependency value go away.
#
# More on how to use Spree dependencies can be found at:
# https://docs.spreecommerce.org/customization/dependencies
Spree.dependencies do |dependencies|
  # Example:
  # Uncomment to change the default Service handling adding Items to Cart
  # dependencies.cart_add_item_service = 'MyNewAwesomeService'
end

Rails.application.config.after_initialize do
  # Spree.shipping_methods << Spree::ShippingMethods::SuperExpensiveNotVeryFastShipping
  # Spree.payment_methods << Spree::PaymentMethods::VerySafeAndReliablePaymentMethod

  # Spree.calculators.tax_rates << Spree::TaxRates::FinanceTeamForcedMeToCodeThis

  # Spree.stock_splitters << Spree::Stock::Splitters::SecretLogicSplitter

  # Spree.adjusters << Spree::Adjustable::Adjuster::TaxTheRich

  # Custom promotions
  # Spree.calculators.promotion_actions_create_adjustments << Spree::Calculators::PromotionActions::CreateAdjustments::AddDiscountForFriends
  # Spree.calculators.promotion_actions_create_item_adjustments << Spree::Calculators::PromotionActions::CreateItemAdjustments::FinanceTeamForcedMeToCodeThis
  # Spree.promotions.rules << Spree::Promotions::Rules::OnlyForVIPCustomers
  # Spree.promotions.actions << Spree::Promotions::Actions::GiftWithPurchase

  # Spree.taxon_rules << Spree::TaxonRules::ProductsWithColor

  # Spree.exports << Spree::Exports::Payments
  # Spree.reports << Spree::Reports::MassivelyOvercomplexReportForCfo

  # ── Role-based permissions ────────────────────────────────────────────────
  # Spree ships two roles (:default for customers, :admin for staff) and 14
  # permission sets. Assigning sets here is what makes a role mean anything —
  # creating a Spree::Role row alone grants nothing.
  #
  # A role with no permission sets can sign in and see nothing, so every staff
  # role below includes DashboardDisplay.
  #
  # Create the matching users with:  bin/rails demo:seed_users
  # Full list: Spree::PermissionSets::Base.descendants
  Spree.permissions.assign(:default, [Spree::PermissionSets::DefaultCustomer])
  Spree.permissions.assign(:admin, [Spree::PermissionSets::SuperUser])

  # Quản lý — thấy hết, làm được gần hết, nhưng không sửa cấu hình hệ thống
  # và không tự cấp quyền cho người khác.
  Spree.permissions.assign(:manager, [
    Spree::PermissionSets::DashboardDisplay,
    Spree::PermissionSets::OrderManagement,
    Spree::PermissionSets::ProductManagement,
    Spree::PermissionSets::PromotionManagement,
    Spree::PermissionSets::StockManagement,
    Spree::PermissionSets::UserDisplay
  ])

  # Nhân viên sản phẩm — chỉ catalog và tồn kho. Không xem được đơn/khách.
  Spree.permissions.assign(:catalog, [
    Spree::PermissionSets::DashboardDisplay,
    Spree::PermissionSets::ProductManagement,
    Spree::PermissionSets::StockManagement
  ])

  # Nhân viên xử lý đơn — xử lý đơn, xem hàng và tồn kho, không sửa giá.
  Spree.permissions.assign(:fulfillment, [
    Spree::PermissionSets::DashboardDisplay,
    Spree::PermissionSets::OrderManagement,
    Spree::PermissionSets::ProductDisplay,
    Spree::PermissionSets::StockDisplay,
    Spree::PermissionSets::UserDisplay
  ])

  # Nhân viên bán sỉ (B2B) — cần quản lý khách để gán customer group, cần xem
  # giá, và cần xử lý đơn sỉ. UserManagement là thứ cho phép gán nhóm khách.
  # StockDisplay thêm vào sau khi audit (script/audit_roles.mjs) cho thấy thiếu
  # nó thì không xem được tồn kho — mà bán sỉ thì luôn phải trả lời "còn hàng
  # không". ProductManagement KHÔNG tự bao gồm quyền xem tồn kho.
  Spree.permissions.assign(:sales_b2b, [
    Spree::PermissionSets::DashboardDisplay,
    Spree::PermissionSets::OrderManagement,
    Spree::PermissionSets::ProductManagement,
    Spree::PermissionSets::StockDisplay,
    Spree::PermissionSets::UserManagement
  ])

  # CSKH — chỉ đọc. Trả lời khách mà không sửa được gì.
  Spree.permissions.assign(:support, [
    Spree::PermissionSets::DashboardDisplay,
    Spree::PermissionSets::OrderDisplay,
    Spree::PermissionSets::ProductDisplay,
    Spree::PermissionSets::UserDisplay
  ])
end

# Put "Print invoice" in the order page's action menu.
#
# Spree.admin.partials.order_page_dropdown is a hook spree_admin renders on the order page,
# so nothing in the gem is overridden or decorated to get the link there. The controller,
# route and view are ours; this is the only line that has to know about the admin UI.
#
# after_initialize, NOT to_prepare, and the reason is the same one that governs
# Spree.subscribers a few lines below: the registry does not exist yet during
# load_config_initializers. Measured the hard way — to_prepare gave
#
#   NoMethodError: undefined method 'include?' for nil
#
# and took the container down on boot. Probing it from `rails runner` earlier showed [],
# because that runs after a completed boot, which is exactly the sort of check that
# confirms the wrong thing.
#
# Guarded against a duplicate, and tolerant of a nil list, so a future Spree that builds
# the registry later still works.
Rails.application.config.after_initialize do
  partial = 'spree/admin/orders/invoice_link'
  list = Spree.admin.partials.order_page_dropdown
  if list.nil?
    Spree.admin.partials.order_page_dropdown = [partial]
  elsif !list.include?(partial)
    list << partial
  end
end

Spree.user_class = 'Spree::User'
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

# Background job queue configuration
Spree.queues.default = :default
Spree.queues.events = :spree_events
Spree.queues.exports = :spree_exports
Spree.queues.images = :spree_images
Spree.queues.imports = :spree_imports
Spree.queues.products = :spree_products
Spree.queues.reports = :spree_reports
Spree.queues.variants = :spree_variants
Spree.queues.taxons = :spree_taxons
Spree.queues.stock_location_stock_items = :spree_stock_location_stock_items
Spree.queues.coupon_codes = :spree_coupon_codes
Spree.queues.addresses = :spree_addresses
Spree.queues.gift_cards = :spree_gift_cards
Spree.queues.webhooks = :spree_webhooks
Spree.queues.payment_webhooks = :spree_payment_webhooks
Spree.queues.api_keys = :spree_api_keys
Spree.queues.search = :spree_search

# Search provider
if ENV['MEILISEARCH_URL'].present?
  Spree.search_provider = 'Spree::SearchProvider::Meilisearch'
end

Rails.application.config.to_prepare do
  require_dependency 'spree/authentication_helpers'
end

Devise.parent_controller = 'Spree::BaseController' if defined?(Devise) && Devise.respond_to?(:parent_controller)

# Customer emails that Spree 5.6 does not ship.
#
# to_prepare rather than after_initialize: the flag lives on Spree::User, which is
# reloadable in development, and an after_initialize assignment is lost on the first
# code reload. The symptom is an email that works until you edit a file.
Rails.application.config.to_prepare do
  # Off unless the store asks for it. It fires on after_create_commit for EVERY user
  # row, which includes seeds, sample data and a bulk customer import. A CSV import
  # that silently emails five thousand people is not a sensible default.
  Spree.user_class.send_welcome_emails = ENV['SEND_WELCOME_EMAILS'] == 'true'

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
# default TRUE, and it gates order confirm, shipped, reimbursement, customer and
# newsletter together. There is no per-email switch anywhere in 5.6.1. Turning it off
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
  optional = {
    'shipment' => Spree::ShipmentEmailSubscriber,
    'reimbursement' => Spree::ReimbursementEmailSubscriber,
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

# Let the admin form save the approval note.
#
# A virtual attribute on Spree::User, not private_metadata straight from the form: that
# attribute's setter replaces the whole hash, so one field would delete every other key
# in it. See Spree::UserDecorator#approval_note.
#
# mattr_reader, so the array is read-only as an accessor but mutable in place, which is
# the pattern Spree's own docs use. Guarded because to_prepare runs again on every code
# reload in development and would otherwise append a duplicate each time.
Rails.application.config.to_prepare do
  attrs = Spree::PermittedAttributes.user_attributes
  attrs << :approval_note unless attrs.include?(:approval_note)
end

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
