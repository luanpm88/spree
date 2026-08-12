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

    by_status = Spree::Product.reorder(nil).group(:status).count

    puts
    puts "  #{store&.name} — #{Spree::Product.count} products, #{Spree::Variant.count} variants"
    puts "  by status: #{by_status.map { |k, v| "#{k} #{v}" }.join(', ')}"
    puts "  store unit system: #{store&.preferred_unit_system.inspect}, " \
         "weight: #{store&.preferred_weight_unit.inspect}"
    puts

    # ── what counts as shippable, and why archived is excluded ────────────────
    #
    # Filtering on deleted_at alone was wrong, and the client is the one who caught
    # it. This task reported his "600ml miniTANKA with ScrewTOP Lid" as unsizeable
    # and unweighable, and he answered: "had a double up and I could not remove the
    # bad one so it got archived, that is why it has no info with it."
    #
    # He was right. Spree carries BOTH a paranoia column and a status enum, and they
    # are not the same thing: that product has deleted_at nil and status "archived".
    # So the one finding on his live catalogue was a false positive, on a row nobody
    # can ever order. A tool that cries wolf once gets ignored the second time, which
    # is the real damage.
    #
    # draft is kept but reported separately. A draft product is not orderable today
    # and its blank dimensions are not breaking anything yet, but it becomes live the
    # moment somebody publishes it, so it is a warning rather than a fault.
    #
    # Master variants of products with no own variants ship on their own; a master
    # that has children never ships, so its blank dimensions are not a fault.
    shippable = Spree::Variant.joins(:product)
                              .where(spree_products: { deleted_at: nil })
                              .where.not(spree_products: { status: 'archived' })
                              .where("spree_variants.is_master = false OR NOT EXISTS (
                                        SELECT 1 FROM spree_variants v2
                                        WHERE v2.product_id = spree_variants.product_id
                                          AND v2.is_master = false
                                          AND v2.deleted_at IS NULL)")
                              .where(deleted_at: nil)

    problems = Hash.new { |h, k| h[k] = [] }
    drafts = Hash.new { |h, k| h[k] = [] }

    shippable.find_each do |v|
      label = "#{v.sku.presence || "variant #{v.id}"} (#{v.product&.name})"
      # A draft cannot be ordered yet, so its gaps are a warning and not a fault.
      # Separated rather than dropped: it is live the moment somebody publishes it.
      bucket = v.product&.status.to_s == 'draft' ? drafts : problems

      missing = %i[width height depth].select { |d| v.public_send(d).to_f <= 0 }
      bucket['no width, height or depth'] << "#{label}: missing #{missing.join(', ')}" if missing.any?

      bucket['no weight'] << label if v.weight.to_f <= 0

      # The reader falls back, so this reads the column. A fallback is a guess, and
      # a guess is exactly what this task exists to surface.
      bucket['unit not recorded, falling back to the store default'] << label if v.read_attribute(:dimensions_unit).blank?
    end

    # Mixed units across the catalogue. Any one of them may be correct; together
    # they cannot be, because nothing converts between them.
    units = shippable.where.not(dimensions_unit: nil).distinct.pluck(:dimensions_unit).compact
    weight_units = shippable.where.not(weight_unit: nil).distinct.pluck(:weight_unit).compact
    problems['more than one dimension unit in the catalogue'] << units.sort.join(', ') if units.size > 1
    problems['more than one weight unit in the catalogue'] << weight_units.sort.join(', ') if weight_units.size > 1

    report = lambda do |title, set|
      set.each do |name, items|
        puts "  #{title}#{name}  (#{items.size})"
        items.first(15).each { |i| puts "      #{i}" }
        puts "      ... and #{items.size - 15} more" if items.size > 15
        puts
      end
    end

    if problems.empty?
      puts "  nothing wrong. Every orderable variant has dimensions, a weight and a unit."
      puts
    else
      report.call('', problems)
    end

    if drafts.any?
      puts "  NOT URGENT, these products are drafts and cannot be ordered yet:"
      puts
      report.call('draft: ', drafts)
    end

    total = problems.values.sum(&:size)
    puts "  #{total} problem(s) across #{shippable.count} orderable variants" \
         "#{drafts.any? ? ", plus #{drafts.values.sum(&:size)} on drafts" : ''}."
    puts

    # strict fails only on the orderable ones. A draft holding up a deploy would make
    # the gate something people disable.
    abort('catalogue:audit failed') if strict && problems.any?
  end
end
