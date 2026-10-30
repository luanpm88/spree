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
# ── what it checks, on Spree 6 ───────────────────────────────────────────────
#
# 5.6's shipping categories are delivery profiles here, and a product with no
# profile falls back to the store's default one (Product#resolved_delivery_profile).
#
#   1  every delivery profile that has products in it has at least one method a
#      customer can see. A profile with no products is not a fault: the upgrade
#      leaves an empty "General" behind on both shops moved so far.
#   2  every method can match an address. On 6 a method with NO zone matches every
#      address (DeliveryMethod#include?), the opposite of 5.6, so that is fine. A
#      zone with no members is the dead one: it matches nothing and looks complete.
#   3  every method has a calculator that still resolves. After the upgrade a
#      calculator row still naming Spree::ShippingMethod leaves the method with
#      none (fault 3 of the 6.0 move), and it raises at checkout rather than quoting.
#
# The 5.6 check for a zone whose kind disagrees with its members is gone: it guarded
# the Rails admin's zone edit form, and 6 has no Rails admin.
#
# Exits non-zero on any of the three, so it can sit in a deploy check.

namespace :shipping do
  desc 'Check this shop can quote delivery for everything it sells'
  task smoke: :environment do
    failures = []
    store = Spree::Store.default
    default_profile = Spree::DeliveryProfile.default_for(store)

    puts "  shop: #{ENV['SHOP'].presence || '(SHOP unset)'}   store: #{store&.name}"
    puts

    products_in = lambda do |profile|
      scope = Spree::Product.where(deleted_at: nil)
      if profile == default_profile
        scope.where(delivery_profile_id: [profile.id, nil])
      else
        scope.where(delivery_profile_id: profile.id)
      end
    end

    # 1. Products with no way to be delivered.
    Spree::DeliveryProfile.order(:name).each do |profile|
      products = products_in.call(profile).count
      if products.zero?
        # A profile holding nothing is worth a line but not a failure: it is a
        # leftover, not a dead end.
        puts format('  note  %-16s no products in it', profile.name)
        next
      end

      methods = Spree::DeliveryMethod.where(delivery_profile_id: profile.id, deleted_at: nil, storefront_visible: true)
      if methods.empty?
        # ACTIVE products, because a draft nobody can buy is not a dead end.
        active = products_in.call(profile).where(status: 'active').count
        failures << "#{profile.name}: #{products} product(s), #{active} of them buyable, and no " \
                    'method a customer can see serves them, so checkout offers nothing'
        puts format('  FAIL  %-16s %4d product(s), %d active, 0 methods', profile.name, products, active)
      else
        puts format('  ok    %-16s %4d product(s), %d method(s): %s',
                    profile.name, products, methods.count, methods.map(&:name).join(', '))
      end
    end

    puts

    # 2 and 3. A method that cannot match or cannot quote.
    Spree::DeliveryMethod.where(deleted_at: nil).order(:name).each do |method|
      zone = method.delivery_zone
      members = zone&.members&.count
      calculator = begin
        method.calculator
      rescue StandardError => e
        failures << "#{method.name}: its calculator will not load (#{e.class})"
        nil
      end

      # A method the customer never sees is a smaller fault than one they do, and
      # saying so is the difference between a gate people act on and a gate
      # people learn to skip.
      customer_facing = method.storefront_visible

      problems = []
      problems << 'a zone with no members, so it matches no address' if zone && members.zero?
      problems << 'no calculator' if calculator.nil?

      where = zone ? "#{zone.name} (#{members})" : 'every address'
      if problems.any? && !customer_facing
        puts format('  note  %-20s %s (admin only, so no customer is affected)',
                    method.name, problems.join('; '))
      elsif problems.any?
        failures << "#{method.name}: #{problems.join('; ')}"
        puts format('  FAIL  %-20s %s', method.name, problems.join('; '))
      else
        puts format('  ok    %-20s %s, %s', method.name, where,
                    calculator.class.name.sub('Spree::Calculator::Shipping::', ''))
      end
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
