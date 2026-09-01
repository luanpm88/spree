# Can this shop actually ship what it sells?
#
#     bin/rails shipping:smoke
#
# Run per shop, on the box, the same way emails:smoke is.
#
# ── the failure this exists for ──────────────────────────────────────────────
#
# On 24 August one shop rendered perfectly, answered 200 everywhere, passed a
# 28 assertion browser walk including add to cart, and could not take an order.
# Its 8 products were all in the "Default" shipping category and it had exactly
# one shipping method, "Digital Delivery", serving the "Digital" category. So a
# customer reaching checkout is offered no delivery option at all and stops.
#
# Nothing about that is visible from outside. The catalogue renders, prices show,
# the cart works. The shop is simply a dead end one step further on than any
# check was looking, which is the same shape as the failure that made
# check_storefront_e2e.mjs click instead of read HTML: every gate up to then
# stopped just short of the thing that mattered.
#
# ── what it checks ───────────────────────────────────────────────────────────
#
#   1  every shipping category that has products in it is served by at least one
#      shipping method. A category with no products is not a fault: two shops
#      carry a "Digital" category with nothing in it.
#   2  every shipping method has at least one zone, because a method with no zone
#      matches no address and is invisible at checkout while looking complete in
#      the admin.
#   3  every shipping method has a calculator that still resolves. A method whose
#      calculator class was renamed or removed raises at checkout rather than
#      quoting, and the admin list keeps showing the old description.
#
# Exits non-zero on any of the three, so it can sit in a deploy check.

namespace :shipping do
  desc 'Check this shop can quote delivery for everything it sells'
  task smoke: :environment do
    failures = []

    puts "  shop: #{ENV['SHOP'].presence || '(SHOP unset)'}   store: #{Spree::Store.default&.name}"
    puts

    # 1. Products with no way to be delivered.
    Spree::ShippingCategory.order(:name).each do |category|
      products = Spree::Product.where(shipping_category_id: category.id).count
      next if products.zero?

      methods = Spree::ShippingMethod.joins(:shipping_categories)
                                     .where(spree_shipping_categories: { id: category.id })
      if methods.empty?
        # ACTIVE products, because a draft nobody can buy is not a dead end. On
        # five shops the gapped category held 1 to 3 products and every one of
        # them was active, so every one of them is a cart a customer cannot
        # check out.
        active = Spree::Product.where(shipping_category_id: category.id)
                               .where(status: 'active').where(deleted_at: nil).count
        failures << "#{category.name}: #{products} product(s), #{active} of them buyable, and no " \
                    'shipping method serves them, so checkout offers nothing'
        puts format('  FAIL  %-16s %4d product(s), %d active, 0 methods', category.name, products, active)
      else
        puts format('  ok    %-16s %4d product(s), %d method(s): %s',
                    category.name, products, methods.count, methods.map(&:name).join(', '))
      end
    end

    # A category holding nothing is worth a line but not a failure: it is a
    # leftover, not a dead end.
    empty = Spree::ShippingCategory.order(:name).reject do |c|
      Spree::Product.where(shipping_category_id: c.id).exists?
    end
    empty.each { |c| puts format('  note  %-16s no products in it', c.name) }

    puts

    # 2 and 3. A method that cannot match or cannot quote.
    Spree::ShippingMethod.order(:name).each do |method|
      zones = method.zones.count
      calculator = begin
        method.calculator
      rescue StandardError => e
        failures << "#{method.name}: its calculator will not load (#{e.class})"
        nil
      end

      # A method the customer never sees is a smaller fault than one they do, and
      # saying so is the difference between a gate people act on and a gate
      # people learn to skip. Measured across the estate: "Free Post" is
      # display_on back_end on all five retail shops, and has no zone on three of
      # them. Nobody at the checkout is affected; an admin writing an order by
      # hand is. So it is reported, and it is not a failure.
      customer_facing = method.display_on.to_s != 'back_end'

      problems = []
      problems << 'no zone, so it matches no address' if zones.zero?
      problems << 'no calculator' if calculator.nil?

      if problems.any? && !customer_facing
        puts format('  note  %-20s %s (admin only, so no customer is affected)',
                    method.name, problems.join('; '))
      elsif problems.any?
        failures << "#{method.name}: #{problems.join('; ')}"
        puts format('  FAIL  %-20s %s', method.name, problems.join('; '))
      else
        puts format('  ok    %-20s %d zone(s), %s', method.name, zones,
                    calculator.class.name.sub('Spree::Calculator::Shipping::', ''))
      end
    end

    # A zone whose kind disagrees with what is in it.
    #
    # Invisible everywhere except the one page a person opens. Spree::Zone.match
    # reads zone_members and never looks at kind, so every console measurement
    # passes; the admin's edit form branches on kind and calls .country on each
    # member, which raises for a country. 34 zones were in that state on one
    # shop and the client found it by clicking Edit.
    Spree::Zone.order(:name).each do |zone|
      types = zone.zone_members.map(&:zoneable_type).uniq
      next if types.empty?

      want = types == ['Spree::Country'] ? 'country' : (types == ['Spree::State'] ? 'state' : nil)
      next if want.nil? || zone.kind == want

      failures << "zone #{zone.name}: kind is #{zone.kind} but its members are #{types.join(', ')}, " \
                  'so the admin edit page for it raises'
      puts format('  FAIL  %-20s kind=%s, members are %s', zone.name, zone.kind, types.join(', '))
    end

    puts
    if failures.any?
      puts "  #{failures.size} problem(s):"
      failures.each { |f| puts "    #{f}" }
      abort
    end
    puts '  ok — everything this shop sells has a delivery option that can quote'
  end
end
