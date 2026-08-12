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

Spree.user_class = 'Spree::User'
Spree.admin_user_class = 'Spree::AdminUser'

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
end

# Tell the shop when somebody signs up and is waiting to be approved.
#
# Registered rather than switched by an env var, because it needs no switch: it does
# nothing at all unless the store has an address in "New Order Notifications Email",
# and it skips anyone who already belongs to a customer group. A seed or a bulk import
# of already-approved trade customers is silent by construction.
Rails.application.config.after_initialize do
  Spree.subscribers << SpreeStarter::SignupNotificationSubscriber
end
