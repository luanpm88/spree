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
    props = conn.select_value('SELECT count(*) FROM spree_product_properties').to_i
    metas = conn.select_value("SELECT count(*) FROM spree_metafields WHERE resource_type = 'Spree::Product'").to_i
    status('product properties present as metafields',
           metas >= props ? :pass : :fail, "#{metas} metafields for #{props} properties")
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
mark = { pass: 'ok  ', fail: 'FAIL', na: '--  ', info: '    ' }
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
