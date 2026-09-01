# Move products out of a shipping category that no shipping method serves.
#
#     bin/rails shipping:category_report
#     DUMP_TAKEN=1 FROM=Digital TO=Physical bin/rails shipping:category_move
#
# ── why ──────────────────────────────────────────────────────────────────────
#
# A product in a shipping category no method serves cannot be bought. The
# customer adds it to the cart, reaches checkout, is offered no delivery option
# and stops. Nothing errors, the catalogue renders, and the only sign is an
# order that never arrives.
#
# On 25 August that was nine products across five shops, and reading their names
# is what settled what to do with them: every one is a bottle. They were not
# digital goods missing a delivery method, they were physical goods in the wrong
# category. The client's instruction was to move them, and moving them is also
# the only change that leaves the catalogue honest.
#
# ── the names ────────────────────────────────────────────────────────────────
#
# TO is matched case-insensitively and the task refuses to run if the target
# category does not exist or is served by no shipping method. Both refusals
# matter: he asked for them to go to "Default", those shops have no category by
# that name, and moving nine products into a category that does not exist or
# that nothing serves would leave them exactly as unbuyable as they are now.

namespace :shipping do
  def category(name)
    Spree::ShippingCategory.where('lower(name) = ?', name.to_s.downcase).first
  end

  def methods_for(cat)
    Spree::ShippingMethod.joins(:shipping_categories)
                         .where(spree_shipping_categories: { id: cat.id })
  end

  desc 'Show every shipping category, what is in it and what serves it'
  task category_report: :environment do
    puts "  shop: #{ENV['SHOP'].presence || '(SHOP unset)'}"
    Spree::ShippingCategory.order(:name).each do |cat|
      products = Spree::Product.where(shipping_category_id: cat.id, deleted_at: nil)
      ms = methods_for(cat)
      puts format('  %-16s %3d product(s)  %d method(s)  %s',
                  cat.name, products.count, ms.count, ms.map(&:name).join(', '))
      next unless ms.empty?

      products.order(:name).each do |p|
        puts format('      %-64s %s', p.name.to_s[0, 64], p.status)
      end
    end
  end

  desc 'Move every product from one shipping category to another'
  task category_move: :environment do
    from_name = ENV['FROM'].to_s
    to_name   = ENV['TO'].to_s
    abort '  FROM= and TO= are both required' if from_name.empty? || to_name.empty?

    unless ENV['DUMP_TAKEN'] == '1'
      abort <<~MSG
        Refusing to run without DUMP_TAKEN=1.

        This moves products in the client's database. Take a dump first and prove
        it reads back, then re-run. `bin/rails shipping:category_report` shows
        the current state and needs no guard.
      MSG
    end

    from = category(from_name)
    to   = category(to_name)
    abort "  no shipping category named #{from_name.inspect} on this shop" if from.nil?
    if to.nil?
      abort <<~MSG
        No shipping category named #{to_name.inspect} on this shop.

        It has: #{Spree::ShippingCategory.order(:name).pluck(:name).join(', ')}

        Moving products into a category that does not exist is not possible, and
        creating one would leave them exactly as unbuyable as they are now,
        because nothing would serve it either.
      MSG
    end

    if methods_for(to).empty?
      abort <<~MSG
        #{to.name} is served by no shipping method on this shop, so moving
        products into it would not make them buyable. Nothing has been changed.
      MSG
    end

    products = Spree::Product.where(shipping_category_id: from.id, deleted_at: nil).order(:name)
    if products.empty?
      puts "  nothing in #{from.name} to move"
      next
    end

    puts "  #{from.name} -> #{to.name}, served by #{methods_for(to).map(&:name).join(', ')}"
    moved = 0
    ActiveRecord::Base.transaction do
      products.each do |p|
        p.update_columns(shipping_category_id: to.id)
        moved += 1
        puts format('    moved  %-64s %s', p.name.to_s[0, 64], p.status)
      end
    end

    left = Spree::Product.where(shipping_category_id: from.id, deleted_at: nil).count
    puts "  #{moved} moved, #{left} left in #{from.name}"
  end
end
