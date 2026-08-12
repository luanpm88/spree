# Checks that the catalogue can actually be shipped, before a customer finds out.
#
#   bin/rails catalogue:audit          every problem, grouped, with counts
#   bin/rails catalogue:audit[strict]  also fail the command, for a deploy gate
#
# The freight tier on this shop is computed from width x height x depth and real
# weight. Every one of those is a nullable column with no default, and Spree's
# Variant#volume is
#
#   (width || 0) * (height || 0) * (depth || 0)
#
# so a missing dimension does not raise, it silently contributes zero. A carton
# with no depth makes an order look smaller than it is, and the shop quotes
# cartons for something that needs a pallet.
#
# Mixed units are worse than missing ones, because the number looks right. 400 x
# 300 x 250 is 0.03 CBM in millimetres and 30 CBM in centimetres, and 30 is past
# the 12.1 boundary, so one carton would quote a 20ft container.
#
# Run it after every import. The whole point is to find this in a list rather
# than in an order.

namespace :catalogue do
  desc 'Report products that cannot be sized, weighed or shipped'
  task :audit, [:mode] => :environment do |_t, args|
    strict = args[:mode].to_s == 'strict'
    store = Spree::Store.default

    puts
    puts "  #{store&.name} — #{Spree::Product.count} products, #{Spree::Variant.count} variants"
    puts "  store unit system: #{store&.preferred_unit_system.inspect}, " \
         "weight: #{store&.preferred_weight_unit.inspect}"
    puts

    # Master variants of products with no own variants ship on their own; a master
    # that has children never ships, so its blank dimensions are not a fault.
    shippable = Spree::Variant.joins(:product)
                              .where(spree_products: { deleted_at: nil })
                              .where("spree_variants.is_master = false OR NOT EXISTS (
                                        SELECT 1 FROM spree_variants v2
                                        WHERE v2.product_id = spree_variants.product_id
                                          AND v2.is_master = false
                                          AND v2.deleted_at IS NULL)")
                              .where(deleted_at: nil)

    problems = Hash.new { |h, k| h[k] = [] }

    shippable.find_each do |v|
      label = "#{v.sku.presence || "variant #{v.id}"} (#{v.product&.name})"

      missing = %i[width height depth].select { |d| v.public_send(d).to_f <= 0 }
      problems['no width, height or depth'] << "#{label}: missing #{missing.join(', ')}" if missing.any?

      problems['no weight'] << label if v.weight.to_f <= 0

      # The reader falls back, so this reads the column. A fallback is a guess, and
      # a guess is exactly what this task exists to surface.
      problems['unit not recorded, falling back to the store default'] << label if v.read_attribute(:dimensions_unit).blank?
    end

    # Mixed units across the catalogue. Any one of them may be correct; together
    # they cannot be, because nothing converts between them.
    units = shippable.where.not(dimensions_unit: nil).distinct.pluck(:dimensions_unit).compact
    weight_units = shippable.where.not(weight_unit: nil).distinct.pluck(:weight_unit).compact
    problems['more than one dimension unit in the catalogue'] << units.sort.join(', ') if units.size > 1
    problems['more than one weight unit in the catalogue'] << weight_units.sort.join(', ') if weight_units.size > 1

    if problems.empty?
      puts "  nothing wrong. Every shippable variant has dimensions, a weight and a unit."
      puts
      next
    end

    problems.each do |title, items|
      puts "  #{title}  (#{items.size})"
      items.first(15).each { |i| puts "      #{i}" }
      puts "      ... and #{items.size - 15} more" if items.size > 15
      puts
    end

    total = problems.values.sum(&:size)
    puts "  #{total} problem(s) across #{shippable.count} shippable variants."
    puts

    abort('catalogue:audit failed') if strict
  end
end
