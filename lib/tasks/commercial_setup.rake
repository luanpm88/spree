# Configure a freshly built shop. Idempotent: safe to run on every deploy.
#
#   bin/rails commercial:setup
#
# Everything is driven by environment so the same task serves every shop:
#
#   SHOP_NAME             display name, e.g. "acme business"
#   RAILS_HOST            the API and admin host, also the store url
#   STOREFRONT_URL        where customers go. Defaults to https://<RAILS_HOST>
#   STORE_CURRENCY        default USD
#   STORE_LOCALE          default en
#   STOREFRONT_ACCESS     public | prices_hidden | login_required
#   ADMIN_EMAIL           creates or updates this admin
#   ADMIN_PASSWORD        required only when the admin does not exist yet
#
# Why a task and not seeds: seeds run once on an empty database and are the wrong
# place for settings that must be re-asserted after every deploy. This can run a
# hundred times and converge to the same state.
namespace :commercial do
  desc 'Create or update the store, its channel and an admin user'
  task setup: :environment do
    name = ENV.fetch('SHOP_NAME') { ENV.fetch('SHOP', 'Shop') }
    host = ENV.fetch('RAILS_HOST')
    storefront = ENV.fetch('STOREFRONT_URL', "https://#{host}")
    access = ENV.fetch('STOREFRONT_ACCESS', 'public')

    valid = Spree::Channel::STOREFRONT_ACCESS
    unless valid.include?(access)
      abort "STOREFRONT_ACCESS=#{access.inspect} is not one of #{valid.inspect}"
    end

    # Keyed on `code`, not on `url`. The url is the value most likely to be
    # corrected later (http to https, apex to www) and keying on it would silently
    # create a second store the first time it changed.
    #
    # But a fresh Spree is not empty: db:prepare seeds a default store, and simply
    # creating ours next to it left TWO stores answering to the same hostname.
    # Spree resolves the current store BY URL, so which one a request got was down
    # to row order. Adopt the seeded one instead of racing it.
    code = name.parameterize
    store = Spree::Store.find_by(code: code)
    if store.nil? && Spree::Store.count == 1
      store = Spree::Store.first
      puts "store    adopting the seeded default (#{store.code}) rather than adding a second"
      store.code = code
    end
    store ||= Spree::Store.new(code: code)
    store.assign_attributes(
      name: name,
      url: host,
      mail_from_address: ENV.fetch('SMTP_FROM_ADDRESS', "noreply@#{host}").presence || "noreply@#{host}",
      default_currency: ENV.fetch('STORE_CURRENCY', 'USD'),
      default_locale: ENV.fetch('STORE_LOCALE', 'en'),
      supported_currencies: ENV.fetch('STORE_CURRENCY', 'USD'),
      supported_locales: ENV.fetch('STORE_LOCALE', 'en')
    )
    store.preferred_storefront_url = storefront if store.respond_to?(:preferred_storefront_url=)
    created_store = store.new_record?
    store.save!
    puts "store    #{created_store ? 'created' : 'updated'}  #{store.name} (#{store.code}) url=#{store.url}"

    # ── the market, which is what actually decides currency and locale ──────────
    #
    # Spree::Store#default_currency and #default_locale look like plain columns and
    # are not: Spree::Stores::Markets overrides both readers to answer from the
    # default MARKET. Setting the columns alone leaves the store reading USD from a
    # seeded "United States" market while the column says NZD, and nothing warns.
    # Verified on 5.6.1 by comparing read_attribute against the method.
    country_iso = ENV['STORE_COUNTRY'].presence
    if country_iso
      country = Spree::Country.find_by(iso: country_iso) or abort "no country with iso #{country_iso}"
      market = store.markets.find_by(default: true) || store.markets.build(default: true)
      market.assign_attributes(
        name: country.name,
        currency: ENV.fetch('STORE_CURRENCY', 'USD'),
        default_locale: ENV.fetch('STORE_LOCALE', 'en'),
        supported_locales: ENV.fetch('STORE_LOCALE', 'en')
      )
      market.save!
      # The market's countries decide who it serves. A market named New Zealand that
      # still lists only the US serves nobody correctly.
      unless market.market_countries.exists?(country_id: country.id)
        market.market_countries.where.not(country_id: country.id).destroy_all
        market.market_countries.create!(country: country)
      end
      store.reload
      puts "market   #{market.name} (#{market.currency}) covering #{country.iso}"
    end

    puts "currency #{store.default_currency} effective, #{store.read_attribute(:default_currency)} on the column"

    # The channel carries the access rule. Setting it on the store as well means a
    # channel added later inherits the right posture instead of defaulting to
    # public, which on a trade shop would put prices in front of the world.
    channel = store.channels.find_or_initialize_by(code: 'online')
    channel.name = 'Online Store' if channel.name.blank?
    channel.preferred_storefront_access = access
    created_channel = channel.new_record?
    channel.save!
    store.preferred_storefront_access = access
    store.save!

    puts "channel  #{created_channel ? 'created' : 'updated'}  #{channel.name} (#{channel.code})"
    puts "access   #{channel.resolved_storefront_access}  " \
         "prices_hidden=#{channel.storefront_prices_hidden?} " \
         "login_required=#{channel.storefront_login_required?}"

    if (email = ENV['ADMIN_EMAIL'].presence)
      klass = Spree.admin_user_class
      admin = klass.find_or_initialize_by(email: email)
      if admin.new_record?
        password = ENV['ADMIN_PASSWORD'].presence or abort 'ADMIN_PASSWORD is required to create a new admin'
        admin.password = password
        admin.password_confirmation = password
        admin.save!
        puts "admin    created  #{email}"
      else
        puts "admin    exists   #{email}"
      end
      # Spree scopes admins per store, and the join carries a ROLE. Pushing onto
      # admin.stores directly raises "Role can't be blank", because Spree::RoleUser
      # is not a plain join table: it decides what the person can actually do.
      # Roles shipped by 5.6: admin, manager, catalog, fulfillment, sales_b2b, support.
      role_name = ENV.fetch('ADMIN_ROLE', 'admin')
      role = Spree::Role.find_by(name: role_name) or abort "no such role: #{role_name}"
      link = Spree::RoleUser.find_or_initialize_by(user: admin, store: store)
      if link.new_record?
        link.role = role
        link.save!
        puts "admin    granted #{role.name} on #{store.code}"
      else
        puts "admin    already has #{link.role&.name} on #{store.code}"
      end
    end

    puts "done     #{Spree::Store.count} store(s), #{store.channels.count} channel(s) on this one"
  end
end
