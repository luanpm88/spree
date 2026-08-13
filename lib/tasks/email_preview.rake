# Builds a stable, rich order used only for previewing email templates.
#
#   bin/rails email:preview_order      # prints the order number, creating it once
#
# Why a dedicated order rather than reusing the sample data: the seeded orders each
# have a single line item, and one of the two has no ship_address at all. A one-line
# order hides every bug in the product table, and the address-less one crashes any
# template that reads ship_address without a nil guard — which is exactly the bug we
# want to find in a design, not the bug we want to trip over while previewing it.
#
# Idempotent. Running it twice returns the same order.
namespace :email do
  PREVIEW_NUMBER = 'R-EMAIL-PREVIEW'.freeze

  desc 'Find or build the order used for email previews'
  task preview_order: :environment do
    order = Spree::Order.find_by(number: PREVIEW_NUMBER)

    # Self-healing. If a previous run created the order and then failed partway, a
    # plain find_by would return that wreck forever and every preview would render an
    # empty, address-less order without ever saying why. Rebuild anything incomplete.
    if order && (order.line_items.empty? || order.ship_address.nil? || order.inventory_units.empty?)
      warn "preview order #{order.number} is incomplete (items=#{order.line_items.size} " \
           "ship_address=#{!order.ship_address.nil?} units=#{order.inventory_units.size}) — rebuilding"
      order.destroy
      order = nil
    end

    if order.nil?
      store = Spree::Store.default
      currency = store.default_currency

      # One variant from each of three DIFFERENT products, one at quantity > 1 so the
      # qty column is not always "1". Taking the first three
      # variants returns three colours of the same product, so every row of the
      # rendered table reads identically and a broken loop looks correct.
      #
      # `variants` EXCLUDES the master, so a shop whose products carry no options has
      # none at all and this used to raise "run: make setup" on a database that was
      # perfectly fine. That is the normal shape for a simple catalogue, and it is the
      # shape of the client shops, so fall back to the master rather than refuse.
      variants = Spree::Product.joins(variants: :prices).distinct.limit(3)
                               .filter_map { |prod| prod.variants.joins(:prices).first }
      if variants.empty?
        variants = Spree::Product.joins(master: :prices).distinct.limit(3)
                                 .filter_map(&:master)
        puts 'no option variants in this catalogue, using master variants' if variants.any?
      end
      raise 'no variants with prices at all — run: make setup' if variants.empty?

      # Build it as a cart, not as a completed order. Adding a line item to an order
      # that is already `complete` fires the inventory hook, which unstocks through
      # `shipment.stock_location` — and at that point there is no shipment, so it
      # raises NoMethodError on nil. Complete it at the end instead.
      order = Spree::Order.create!(
        number: PREVIEW_NUMBER,
        store: store,
        currency: currency,
        email: 'preview@example.com'
      )

      variants.each_with_index do |variant, i|
        order.line_items.create!(variant: variant, quantity: i.zero? ? 2 : 1, currency: currency)
      end

      address_attrs = {
        firstname: 'Ariana', lastname: 'Whitcombe',
        address1: '14 Marine Parade', address2: 'Mount Maunganui',
        city: 'Tauranga', zipcode: '3116',
        phone: '+64 21 555 0134',
        country: Spree::Country.find_by(iso: 'NZ') || Spree::Country.first
      }
      address_attrs[:state] = address_attrs[:country].states.first if address_attrs[:country].states.any?

      order.update!(
        ship_address: Spree::Address.create!(address_attrs),
        bill_address: Spree::Address.create!(address_attrs)
      )

      # A shipment so shipments.first.stock_location resolves, and a payment so
      # payments.first.number and .payment_method.name do.
      if (location = Spree::StockLocation.first)
        # A shipping method too. Without one, shipment.shipping_method is nil and
        # shipped_email dies on `.name` — again a fixture gap wearing a template bug's
        # clothes. Reuse a live method if the shop has one so the preview reads like the
        # real thing, otherwise make a plain free one.
        ship_method = Spree::ShippingMethod.where(deleted_at: nil).first
        ship_method ||= Spree::ShippingMethod.create!(
          name: 'Preview delivery',
          calculator: Spree::Calculator::Shipping::FlatRate.new(preferred_amount: 0),
          shipping_categories: [Spree::ShippingCategory.first || Spree::ShippingCategory.create!(name: 'Default')]
        )
        shipment = order.shipments.create!(stock_location: location, state: 'shipped')
        shipment.shipping_rates.create!(shipping_method: ship_method, cost: 0, selected: true)

        # Inventory units do not appear just because a shipment exists. Spree creates
        # them while allocating stock during a real checkout, and this order skips
        # that. Without them a customer return cannot be built at all, which is what
        # reimbursement_email needs, so create one per unit of each line item.
        order.line_items.each do |line_item|
          line_item.quantity.times do
            Spree::InventoryUnit.create!(
              variant: line_item.variant, order: order, line_item: line_item,
              shipment: shipment, state: 'shipped'
            )
          end
        end
      end
      # Must be a method with source_required? == false. The seeded StoreCredit and
      # Bogus gateway both demand a payment source, and creating one just to render an
      # email would mean faking card data. Check needs nothing.
      #
      # And build one if the shop has none. A database whose only method is StoreCredit
      # used to leave the order with no payment at all, silently, because of the `if
      # method` guard. store_owner_notification_email then died on
      # `payments.first.payment_method` and the failure looked like a template bug rather
      # than a missing fixture. A preview task should make what it needs.
      method = Spree::PaymentMethod.unscoped.find { |m| !m.source_required? }
      method ||= Spree::PaymentMethod::Check.create!(
        name: 'Preview offline payment', active: true, display_on: 'both'
      )
      order.payments.create!(payment_method: method, amount: order.total, state: 'completed')

      # `update_totals` only sums what is already on the record; it does not run the
      # adjustments and shipment totals, so the order stays at 0.00. `update_with_updater!`
      # drives Spree::OrderUpdater, which is what actually produces item_total and total.
      order.update_with_updater!

      # `update!(state: 'complete')` does not stick — Order carries a state machine, and
      # assigning the attribute directly is ignored, silently leaving the order in `cart`.
      # Driving the real checkout transitions would mean supplying a delivery method and
      # a payment source for a fixture that only ever gets rendered, so set the columns
      # directly and skip the machine.
      order.update_columns(state: 'complete', completed_at: Time.current)
    end

    puts order.number
  end

  # payment_link_email refuses a completed order by design — it exists to chase an
  # unpaid one. So it needs its own fixture rather than the shared preview order.
  desc 'Find or build the incomplete order used for payment-link previews'
  task preview_cart: :environment do
    number = 'R-EMAIL-CART'
    cart = Spree::Order.find_by(number: number)

    if cart.nil? || cart.line_items.empty?
      cart&.destroy
      store = Spree::Store.default
      cart = Spree::Order.create!(
        number: number, store: store, currency: store.default_currency,
        email: 'preview@example.com', locale: store.default_locale
      )
      variant = Spree::Variant.joins(:prices).first
      cart.line_items.create!(variant: variant, quantity: 1, currency: cart.currency) if variant
      cart.update_with_updater!
    end

    puts cart.number
  end

  # reimbursement_email needs a Spree::Reimbursement, which hangs off a customer return
  # and its return items. Nothing in the sample data creates one.
  desc 'Find or build a reimbursement used for previews'
  task preview_reimbursement: :environment do
    order = Spree::Order.find_by(number: PREVIEW_NUMBER)
    raise 'run email:preview_order first' if order.nil?

    # Scoped to the preview order, not "the newest reimbursement anywhere". The
    # sample data ships one against a seeded order, and that order carries locale
    # "en" while the preview order carries the client's "en-CA". Reusing it made
    # reimbursement_email render with 12 keys missing and pointed the blame at the
    # template, which was fine. The fixture has to match the order the other
    # previews use, or the locale silently differs from every other email.
    existing = Spree::Reimbursement.find_by(order_id: order.id)
    if existing
      puts existing.number
      next
    end

    inventory_unit = order.inventory_units.first
    raise 'preview order has no inventory units, so no return can be built' if inventory_unit.nil?

    stock_location = Spree::StockLocation.first

    # A CustomerReturn validates that every item it carries is already covered by a
    # ReturnAuthorization. Building the return on its own fails with "Missing Return
    # Authorization for <product>", which reads like a data problem but is really the
    # normal Spree flow: the merchant authorises a return, then the goods arrive.
    reason = Spree::ReturnAuthorizationReason.first ||
             Spree::ReturnAuthorizationReason.create!(name: 'Preview')
    authorization = Spree::ReturnAuthorization.create!(
      order: order, stock_location: stock_location, reason: reason
    )
    return_item = Spree::ReturnItem.create!(
      inventory_unit: inventory_unit, return_authorization: authorization
    )

    customer_return = Spree::CustomerReturn.new(
      stock_location: stock_location, store: order.store
    )
    customer_return.return_items = [return_item]
    customer_return.save!

    reimbursement = Spree::Reimbursement.create!(
      order: order,
      customer_return: customer_return,
      return_items: [return_item]
    )

    # A reimbursement only gets a total once it is performed, and performing one needs
    # real payments to refund against. The templates compare total against the order
    # total to decide "partial refund" or "full refund", so a nil total raises. Set it
    # directly: this fixture exists to render an email, not to move money.
    reimbursement.update_columns(total: (order.total / 2).round(2)) if reimbursement.total.nil?

    puts "#{reimbursement.number} total=#{reimbursement.reload.total}"
  end
end
