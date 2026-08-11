# Re-price historical orders with the client's own shipping calculator on 5.6.1, and
# compare against what each order actually charged.
#
#   DATABASE_URL=postgres://…/nz_migrate bin/rails shipping:regression
#
# "The class loads" is not the question. The question is whether it still produces the
# same number after the upgrade, and the only honest way to answer it is to run it
# against real orders with real weights and real addresses and diff the results.
#
# Read-only apart from the calculator's own store_metadata side effect, which writes
# selected_ctn onto the shipment. Run on a copy.
namespace :shipping do
  desc 'Re-price completed orders and compare against what was charged'
  task regression: :environment do
    abort 'refusing to run without DATABASE_URL set explicitly' if ENV['DATABASE_URL'].blank?

    calc_class = Spree::Calculator::Shipping::UbiNzShippingCalculator
    # The live preferences, not the class defaults. Defaults would answer a question
    # nobody asked: this shop runs its own numbers.
    live = Spree::Calculator.where(type: calc_class.name).order(:id).last
    abort "no #{calc_class.name} row in this database" if live.nil?
    puts "preferences in use: #{live.preferences.map { |k, v| "#{k}=#{v}" }.join(' ')}"
    puts ''

    location = Spree::StockLocation.first
    orders = Spree::Order.complete.includes(:line_items, :shipments, :ship_address).order(:id)
    puts "#{orders.size} completed orders"
    puts ''

    same = []
    diff = []
    skipped = []
    errors = []

    orders.each do |order|
      charged = order.shipments.sum { |s| s.cost.to_f }
      items = order.line_items.select { |li| li.variant.present? }
      if items.empty?
        skipped << [order.number, 'no line items with a variant']
        next
      end

      contents = items.map do |li|
        Spree::Stock::ContentItem.new(Spree::InventoryUnit.new(variant: li.variant, line_item: li, order: order),
                                      li.quantity)
      end
      package = Spree::Stock::Package.new(location, contents)
      package.instance_variable_set(:@order, order) if package.respond_to?(:order)

      computed = live.compute_package(package).to_f
      if (computed - charged).abs < 0.005
        same << [order.number, order.completed_at&.to_date]
      else
        diff << [order.number, charged, computed, computed - charged, order.completed_at&.to_date]
      end
    rescue StandardError => e
      errors << [order.number, "#{e.class}: #{e.message.lines.first.to_s.strip[0, 90]}"]
    end

    puts "identical      #{same.size}"
    puts "different      #{diff.size}"
    puts "skipped        #{skipped.size}"
    puts "errored        #{errors.size}"

    # The calculator names its own date: "UBI NZ shipping 20260211 12:18". Orders older
    # than that were priced by a DIFFERENT calculator, so comparing them measures the
    # client changing their rates, not the upgrade breaking anything. SINCE is the only
    # window where a mismatch means something.
    since = Date.parse(ENV.fetch('SINCE', '2026-02-11'))
    recent_same = same.count { |_, on| on && on >= since }
    recent_diff = diff.count { |d| d[4] && d[4] >= since }
    recent_total = recent_same + recent_diff
    puts ''
    puts "SINCE #{since} (when this calculator was written)"
    puts format('  %d of %d match, %.0f%%', recent_same, recent_total,
                recent_total.zero? ? 0 : recent_same * 100.0 / recent_total)

    puts ''
    puts 'BY MONTH  (a calculator changed 11 times shows up here, not as a 5.6 fault)'
    by_month = Hash.new { |h, k| h[k] = [0, 0] }
    same.each { |_, on| by_month[on&.strftime('%Y-%m') || '?'][0] += 1 }
    diff.each { |d| by_month[d[4]&.strftime('%Y-%m') || '?'][1] += 1 }
    by_month.sort.each do |month, (m, x)|
      total = m + x
      bar = '#' * ((m * 30.0 / [total, 1].max).round)
      puts format('  %-8s match %3d / %3d  %s', month, m, total, bar)
    end

    unless diff.empty?
      deltas = diff.map { |d| d[3] }
      puts ''
      puts format('delta: min %+.2f  max %+.2f  mean %+.2f  total %+.2f',
                  deltas.min, deltas.max, deltas.sum / deltas.size, deltas.sum)
      puts ''
      # A cluster at exactly one value is a missing input, not a broken formula. The
      # rural surcharge is 5.70 and config/rural_postcodes.txt is not in this checkout,
      # so rural_postcodes returns [] and no order is ever charged it.
      recent = diff.select { |d| d[4] && d[4] >= since }
      buckets = recent.group_by { |d| d[3].round(2) }.transform_values(&:size)
      puts ''
      puts "MOST COMMON DELTAS since #{since} (#{recent.size} mismatches)"
      buckets.sort_by { |_, n| -n }.first(6).each do |delta, n|
        note = (delta.abs - 5.70).abs < 0.005 ? '  <- exactly the rural surcharge' : ''
        puts format('  %+8.2f  x%-4d%s', delta, n, note)
      end

      puts ''
      puts format('  %-14s %10s %10s %10s %12s', 'order', 'charged', 'computed', 'delta', 'completed')
      diff.sort_by { |d| -d[3].abs }.first(15).each do |num, was, now, d, on|
        puts format('  %-14s %10.2f %10.2f %+10.2f %12s', num, was, now, d, on)
      end
    end

    unless errors.empty?
      puts ''
      puts "ERRORS (#{errors.size})"
      errors.first(8).each { |num, msg| puts "  #{num}  #{msg}" }
    end
  end
end
