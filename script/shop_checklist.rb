# One screen per shop, answering "is this shop actually ready", by measuring rather than
# by remembering.
#
#   DATABASE_URL=postgres://…/ca_migrate bin/rails runner script/shop_checklist.rb
#   REFERENCE_DB=spree_production DATABASE_URL=… bin/rails runner script/shop_checklist.rb
#
# ── why a script and not a document ──────────────────────────────────────────
#
# A written checklist goes stale the first time someone ticks a box from memory. Every
# item below was a real failure on a real shop this week, and every one of them was
# invisible until measured:
#
#   - a calculator row whose class is gone 500s the whole admin Shipping Methods page,
#     while COUNT(*) on the same table succeeds, so a row-count health check reads green
#   - product properties survive the upgrade in the old table and silently do not all
#     become metafields
#   - the bank transfer wording lives in a column 5.6 no longer has, so it stops being
#     shown without any error
#   - auto_capture defaults to true, so an offline method marks orders PAID with no money
#
# Exit code is non-zero if anything FAILS, so it can gate a release.
#
# Safe on a live database: every check is a read.
REFERENCE_DB = ENV['REFERENCE_DB'].presence

rows = []
def status(label, state, detail = nil) = [label, state, detail]

# Every check runs inside this. A checklist that dies on the first surprise reports
# nothing about the twenty items after it, which is worse than a checklist that says
# ERROR on one line and carries on. Learned the hard way: one wrong column name took
# the whole run down and hid every other result.
def safely(rows, label)
  rows << yield
rescue => e
  rows << [label, :fail, "check itself failed: #{e.class.name.split('::').last}"]
end

conn = ActiveRecord::Base.connection
db   = conn.current_database
table = ->(name) { conn.table_exists?(name) }

# ── 1. shape of the install ──────────────────────────────────────────────────
migrations = conn.select_value('SELECT count(*) FROM schema_migrations').to_i
pending =
  begin
    ActiveRecord::Migration.check_all_pending!
    0
  rescue ActiveRecord::PendingMigrationError => e
    e.message.scan(/\d{14}/).size.nonzero? || 1
  end
rows << status('migrations applied', :info, migrations)
rows << status('no pending migrations', pending.zero? ? :pass : :fail,
               pending.zero? ? nil : "#{pending} pending")

# ── 2. STI classes that no longer exist ──────────────────────────────────────
# Split by whether the BASE class exists. If it does, an orphan subclass raises on
# Base.all and on includes(:assoc), which is what takes an admin page down. If the whole
# model is absent (page builder without the storefront gem) the rows are inert.
STI = {
  'spree_calculators'     => 'Spree::Calculator',
  'spree_payment_methods' => 'Spree::PaymentMethod',
  'spree_promotion_rules' => 'Spree::PromotionRule',
  'spree_promotion_actions' => 'Spree::PromotionAction'
}.freeze

STI.each do |tbl, base|
  next unless table.call(tbl)

  base_exists = (base.constantize && true) rescue false
  types = conn.select_values("SELECT DISTINCT type FROM #{tbl} WHERE type IS NOT NULL")
  gone  = types.reject { |t| (t.constantize && true) rescue false }
  label = "#{tbl.sub('spree_', '')}: every class resolves"

  if gone.empty?
    rows << status(label, :pass)
  elsif base_exists
    rows << status(label, :fail, "#{gone.size} missing, admin will 500: #{gone.first(2).join(', ')}")
  else
    rows << status(label, :na, "#{gone.size} orphan rows, but #{base} is absent so nothing loads them")
  end
end

# ── 3. the admin queries that actually break ────────────────────────────────
{
  'admin: shipping methods page' => -> { Spree::ShippingMethod.includes(:calculator).to_a.size },
  'admin: payment methods page'  => -> { Spree::PaymentMethod.all.to_a.size },
  'admin: orders with payments'  => -> { Spree::Order.complete.includes(payments: :payment_method).limit(25).to_a.size },
  'admin: products list'         => -> { Spree::Product.includes(:variants).limit(25).to_a.size }
}.each do |label, probe|
  begin
    probe.call
    rows << status(label, :pass)
  rescue => e
    rows << status(label, :fail, e.class.name.split('::').last)
  end
end

# ── 3b. does the shop actually SHOW anything ────────────────────────────────
#
# Section 3 asks whether a query raises. That is not the same question as whether
# the client sees a shop, and on 14 Aug the difference cost most of a day: every
# check above passed, seventeen of seventeen, on a Canada install whose admin
# said "No Product found" with 79 products in the database.
#
# The 5.6 upgrade adds store_id, media_count and primary_media_id and leaves them
# empty. Nothing raises, no count changes, and Spree::Product.limit(25) happily
# returns 25 rows — through a scope the admin does not use. So these checks go
# through the SAME scopes the admin and the API do, and compare against the raw
# count. Fixed by bin/rails backfill:all.
if table.call('spree_products') && Spree::Store.any?
  store = Spree::Store.first

  safely(rows, 'products are visible to the store') do
    raw = Spree::Product.where(deleted_at: nil).count
    visible = Spree::Product.for_store(store).where(deleted_at: nil).count
    if raw.zero?
      status('products are visible to the store', :na, 'no products in this shop')
    elsif visible == raw
      status('products are visible to the store', :pass, "#{visible}")
    else
      status('products are visible to the store', :fail,
             "#{visible} of #{raw} — run bin/rails backfill:store_id")
    end
  end

  safely(rows, 'products with images have a thumbnail') do
    with_images = Spree::Product.where(deleted_at: nil).where('media_count > 0')
    have = with_images.where.not(primary_media_id: nil).count
    total = with_images.count
    if total.zero?
      # media_count itself being zero everywhere is the failure, not an absence
      # of images: it is what makes Spree treat a shop full of photographs as
      # having none.
      any_assets = table.call('spree_assets') ? Spree::Asset.count : 0
      status('products with images have a thumbnail',
             any_assets.zero? ? :na : :fail,
             any_assets.zero? ? 'no images in this shop' :
               "#{any_assets} images but media_count is 0 — run bin/rails backfill:counters")
    elsif have == total
      status('products with images have a thumbnail', :pass, "#{have}")
    else
      # Two different causes, and only one of them is fixable here. A product
      # can have no thumbnail because the column was never filled in, or because
      # none of its image FILES came across and pointing at one would 500. Telling
      # someone to run a backfill that cannot help is how a check stops being read.
      unfixable = conn.select_value(<<~SQL).to_i
        SELECT count(*) FROM spree_products p
        WHERE p.deleted_at IS NULL AND p.media_count > 0 AND p.primary_media_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM spree_variants v
            JOIN spree_assets a ON a.viewable_id = v.id AND a.viewable_type = 'Spree::Asset'
            JOIN active_storage_attachments aa ON aa.record_id = a.id AND aa.record_type = 'Spree::Asset'
            JOIN active_storage_blobs ab ON ab.id = aa.blob_id
            WHERE v.product_id = p.id AND ab.service_name = 'local'
          )
      SQL
      missing = total - have
      if unfixable >= missing
        status('products with images have a thumbnail', :warn,
               "#{have} of #{total}; the other #{missing} have no image file on this server")
      else
        status('products with images have a thumbnail', :fail,
               "#{have} of #{total}, #{missing - unfixable} fixable — run bin/rails backfill:thumbnails")
      end
    end
  end
end

# Every blob must name a storage service this install defines. A blob left
# pointing at the old shop's `minio` or `mirror` raises KeyError mid-render, so a
# thumbnail becomes a 500 on a page that is otherwise fine.
if table.call('active_storage_blobs')
  safely(rows, 'every image names a storage service that exists') do
    configured = Rails.configuration.active_storage.service_configurations&.keys&.map(&:to_s) ||
                 ActiveStorage::Blob.services.send(:configurations).keys.map(&:to_s)
    used = conn.select_values('SELECT DISTINCT service_name FROM active_storage_blobs').compact
    unknown = used - configured
    if unknown.empty?
      status('every image names a storage service that exists', :pass, used.join(', '))
    else
      n = conn.select_value(
        "SELECT count(*) FROM active_storage_blobs WHERE service_name IN (#{unknown.map { |u| conn.quote(u) }.join(',')})"
      )
      status('every image names a storage service that exists', :fail,
             "#{n} blob(s) on #{unknown.join(', ')} — these 500 when rendered")
    end
  end
end

# ── 3c. the category counters, and the categories the API will not serve ─────
#
# Found on 14 Aug while mapping a home page, and it is the sixth thing the 5.6
# upgrade leaves wrong. spree_taxons.products_count is kept by Spree's own
# callbacks rather than a Rails counter_cache, so a restored dump never runs
# them: 72 of 87 categories on one shop said they held no products while holding
# up to 37. The Store API filters on that number, so most of a shop's navigation
# reads as empty while the admin looks perfectly normal.
#
# Fixed by bin/rails backfill:counters, which calls Spree's own
# recalculate_products_count. Never a plain COUNT(*): the stored number counts
# descendants too, so a naive count is wrong on every category with children.
if table.call('spree_taxons')
  safely(rows, 'category product counts are right') do
    wrong = conn.select_value(<<~SQL).to_i
      SELECT count(*) FROM spree_taxons t
      WHERE t.products_count = 0
        AND EXISTS (SELECT 1 FROM spree_products_taxons pt WHERE pt.taxon_id = t.id)
    SQL
    total = conn.select_value('SELECT count(*) FROM spree_taxons').to_i
    if wrong.zero?
      status('category product counts are right', :pass, "#{total} categories")
    else
      status('category product counts are right', :fail,
             "#{wrong} of #{total} say empty but hold products — run bin/rails backfill:counters")
    end
  end

  # Not a fault and not fixable by a backfill: the 5.6 Store API does not return
  # rule based categories at all. It matters because a shop can be using one on
  # its home page and only find out when the storefront renders nothing there.
  # Reported as a note so it is seen before the storefront is built, not after.
  safely(rows, 'rule based categories the storefront cannot see') do
    autos = conn.select_all(<<~SQL).to_a
      SELECT permalink FROM spree_taxons WHERE automatic = true ORDER BY permalink
    SQL
    if autos.empty?
      status('rule based categories the storefront cannot see', :pass, 'none')
    else
      status('rule based categories the storefront cannot see', :warn,
             "#{autos.size}: #{autos.map { |a| a['permalink'] }.first(3).join(', ')}")
    end
  end
end

# ── 4. can this shop quote shipping at all ──────────────────────────────────
if table.call('spree_shipping_methods')
  live = Spree::ShippingMethod.where(deleted_at: nil)
  quoting = live.count do |sm|
    sm.calculator.present?
  rescue StandardError
    false
  end
  rows << status('shipping: a live method can quote', quoting.positive? ? :pass : :fail,
                 "#{quoting} of #{live.count} live methods")
end

# ── 5. the paid-with-no-money trap ──────────────────────────────────────────
if table.call('spree_payment_methods')
  offline = Spree::PaymentMethod.where(active: true, deleted_at: nil).select do |pm|
    pm.is_a?(Spree::PaymentMethod::Check)
  rescue StandardError
    false
  end
  auto = offline.select { |pm| pm.auto_capture.nil? ? Spree::Config[:auto_capture] : pm.auto_capture }
  rows << status('offline payment does not auto capture',
                 auto.empty? ? :pass : :fail,
                 auto.empty? ? nil : "#{auto.map(&:name).join(', ')} marks orders PAID with no money")
end

# ── 6. bank transfer wording survived the upgrade ───────────────────────────
if table.call('spree_payment_methods') && conn.column_exists?(:spree_payment_methods, :instructions)
  stranded = conn.select_all(<<~SQL).to_a
    SELECT name FROM spree_payment_methods
    WHERE instructions IS NOT NULL AND instructions <> ''
      AND (description IS NULL OR description = '')
  SQL
  rows << status('payment instructions carried to description',
                 stranded.empty? ? :pass : :fail,
                 stranded.empty? ? nil : "#{stranded.map { |r| r['name'] }.join(', ')} — run rehearsal:carry_payment_instructions")
else
  rows << status('payment instructions carried to description', :pass, 'no legacy instructions column')
end

# ── 7. product properties became metafields ─────────────────────────────────
if table.call('spree_product_properties') && table.call('spree_metafields')
  safely(rows, 'product properties present as metafields') do
    # LIVE products only. The export deliberately skips properties belonging to deleted
    # products, so counting the raw table against metafields reported a shortfall on a
    # shop with 36 such rows and nothing actually missing. A check that cries wolf is a
    # check nobody reads the next time.
    props = conn.select_value(<<~SQL).to_i
      SELECT count(*) FROM spree_product_properties pp
      JOIN spree_products p ON p.id = pp.product_id
      WHERE p.deleted_at IS NULL
    SQL
    metas = conn.select_value("SELECT count(*) FROM spree_metafields WHERE resource_type = 'Spree::Product'").to_i
    status('product properties present as metafields',
           metas >= props ? :pass : :fail, "#{metas} metafields for #{props} live properties")
  end
end

# ── 8. schema against a clean 5.6.1, if one was named ───────────────────────
if REFERENCE_DB
  q = <<~SQL
    SELECT table_name || ':' || column_name FROM information_schema.columns
    WHERE table_schema = 'public'
  SQL
  here = conn.select_values(q).to_set
  there = conn.select_values("SELECT * FROM dblink('dbname=#{REFERENCE_DB}', $$#{q}$$) AS t(c text)").to_set rescue nil
  if there
    absent = there - here
    rows << status("columns present vs #{REFERENCE_DB}", absent.empty? ? :pass : :fail,
                   absent.empty? ? nil : "#{absent.size} missing")
  else
    rows << status("columns present vs #{REFERENCE_DB}", :na, 'dblink unavailable, compare with psql')
  end
end

# ── 9. things a shop needs before it takes an order ─────────────────────────
safely(rows, 'a store row exists') { status('a store row exists', Spree::Store.any? ? :pass : :fail) }
if Spree::Store.any?
  store = Spree::Store.default
  rows << status('store has a mail from address', store.mail_from_address.present? ? :pass : :fail)
  rows << status('store has a default currency', store.default_currency.present? ? :pass : :fail,
                 store.default_currency)
end
safely(rows, 'an admin user exists') { status('an admin user exists', Spree.admin_user_class.any? ? :pass : :fail) }
rows << status('order number prefix',
               :info, (Spree::Order.number_generator.prefix rescue '?'))

# ── report ──────────────────────────────────────────────────────────────────
# warn is a real thing worth reporting but not a reason to block a release:
# an image whose file is on a server nobody can reach is a fact about the
# world, not a mistake in this install. It prints, it does not fail.
mark = { pass: 'ok  ', fail: 'FAIL', warn: 'note', na: '--  ', info: '    ' }
width = rows.map { |r| r[0].length }.max

puts
puts "shop checklist — #{db}"
puts '=' * (width + 12)
rows.each do |label, state, detail|
  line = format("  %s %-#{width}s", mark[state], label)
  line += "  #{detail}" if detail
  puts line
end
puts '=' * (width + 12)

failed = rows.count { |r| r[1] == :fail }
puts(failed.zero? ? "  ready — #{rows.count { |r| r[1] == :pass }} checks passed" : "  #{failed} FAILING")
exit(failed.zero? ? 0 : 1)
