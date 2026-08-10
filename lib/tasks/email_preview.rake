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
    if order && (order.line_items.empty? || order.ship_address.nil?)
      warn "preview order #{order.number} is incomplete (items=#{order.line_items.size} " \
           "ship_address=#{!order.ship_address.nil?}) — rebuilding"
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
      variants = Spree::Product.joins(variants: :prices).distinct.limit(3)
                               .filter_map { |prod| prod.variants.joins(:prices).first }
      raise 'no variants with prices — run: make setup' if variants.empty?

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
        order.shipments.create!(stock_location: location, state: 'shipped')
      end
      # Must be a method with source_required? == false. The seeded StoreCredit and
      # Bogus gateway both demand a payment source, and creating one just to render an
      # email would mean faking card data. Check needs nothing.
      method = Spree::PaymentMethod.unscoped.find { |m| !m.source_required? }
      order.payments.create!(payment_method: method, amount: order.total, state: 'completed') if method

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
end
