# Does this shop's store record point customers at this shop?
#
#     bin/rails store:urls              report only, exits non-zero if it does not
#     DUMP_TAKEN=1 bin/rails store:urls_fix
#
# ── the failure this exists for ──────────────────────────────────────────────
#
# Spree::Store#storefront_url is what every customer-facing link in an email is
# built from: the logo at the top, the shop name in the footer, and the payment
# link button, which is built as
#
#     "#{store.storefront_url}/checkout/#{order.to_param}?token=..."
#
# On 25 August, six of seven shops held a storefront_url that was not this shop's
# storefront. Five pointed at their Rails host, which 301s straight to /admin,
# and one pointed at a domain that does the same. Measured on the live hosts:
#
#     four retail shops       301 -> /admin
#     the wholesale shop      302 -> /user/sign_in
#     one retail shop         200          <- the only correct one
#
# So a customer sent a payment request on any of those shops clicks "Complete
# Your Purchase" and lands on an admin sign-in page. The email builds, sends and
# looks finished, which is why nothing had noticed.
#
# The container already knows the right answer: STORE_URL is set per shop by
# script/shop_host and was correct on every one of them. Only the database row
# was stale, left over from the migrated dump.
#
# ── why this is a task and not an initializer ────────────────────────────────
#
# Writing to the client's database at every boot is the wrong shape for a value
# he can legitimately edit in the admin. So it is reported by default, changed
# only when asked, and the report runs in script/check_shop_runtime so a shop
# that drifts is found by a gate rather than by a customer.

namespace :store do
  def expected_storefront
    host = ENV['STORE_URL'].to_s.strip
    return nil if host.empty?

    host.start_with?('http') ? host.chomp('/') : "https://#{host}"
  end

  desc 'Check the store record points customers at this shop'
  task urls: :environment do
    store = Spree::Store.default
    want = expected_storefront

    if want.nil?
      puts '  STORE_URL is not set, so there is nothing to compare against'
      next
    end

    have = store.storefront_url.to_s.chomp('/')
    puts "  shop: #{ENV['SHOP'].presence || '(SHOP unset)'}"
    puts "  STORE_URL       #{want}"
    puts "  storefront_url  #{have.presence || '(blank)'}"

    if have == want
      puts '  ok — a customer link in an email lands on this shop'
      next
    end

    puts
    puts '  MISMATCH. Every customer-facing link in this shop\'s emails is built'
    puts '  from storefront_url: the logo, the shop name in the footer, and the'
    puts '  payment link button. They will send the customer to'
    puts "    #{have.presence || '(blank)'}"
    puts '  rather than to this shop.'
    puts
    puts '  Fix with: DUMP_TAKEN=1 bin/rails store:urls_fix'
    abort
  end

  desc 'Set storefront_url from STORE_URL. Never guesses: it uses what the container was given.'
  task urls_fix: :environment do
    unless ENV['DUMP_TAKEN'] == '1'
      abort <<~MSG
        Refusing to run without DUMP_TAKEN=1.

        This writes to the client's store record. Take a dump first and prove it
        reads back, then re-run. `bin/rails store:urls` reports the change and
        needs no guard.
      MSG
    end

    store = Spree::Store.default
    want = expected_storefront
    abort '  STORE_URL is not set, so there is nothing to set it to' if want.nil?

    before = store.storefront_url
    if before.to_s.chomp('/') == want
      puts "  already correct: #{want}"
      next
    end

    # The PREFERENCE, not a column. storefront_url is not an attribute at all on
    # Spree 5.6.1, it is derived:
    #
    #   preferred_storefront_url.presence ||
    #     allowed_origins.order(:created_at).reject(&:loopback?).first&.origin ||
    #     formatted_url
    #
    # so update!(storefront_url:) raises UnknownAttributeError, which is what
    # this task did every time it was asked to fix anything. It was written on
    # 25 August, its own header says six shops were repaired with it, and it had
    # never once run to completion: nobody read the output.
    #
    # The preference is the field Spree provides for this and it leaves the `url`
    # column alone. That column is what multi store host matching resolves on, so
    # editing it to fix an email link would be repairing a link by changing which
    # requests the shop answers.
    store.preferred_storefront_url = want
    store.save!
    store.reload
    got = store.storefront_url.to_s.chomp('/')
    puts "  storefront_url  #{before.inspect}  ->  #{got.inspect}"
    abort "  it did not take: still #{got.inspect}" unless got == want
    puts '  ok — read back from the store after saving'
  end
end
