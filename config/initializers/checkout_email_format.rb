# frozen_string_literal: true

# A checkout cannot reach Pay now with an email Spree will refuse at the end.
#
# Spree 5.6.1 checks the format of an order's email only once the order leaves
# delivery: `require_email` is false in cart, address and delivery, so an address
# like "name.example.com" is saved without complaint through every step before
# payment. The storefront takes the card (or the PayPal capture) and only then
# calls complete, which fails with "Email is invalid". The customer has paid, the
# order sits unfinished in Draft Orders, and no confirmation goes out. That
# happened on a live shop on 11 Nov 2026 (docs/DISCOVERIES.md §88). Spree 6.0
# checks the format on every cart save, so this is a 5.6.1 gap.
#
# The fix uses Spree's own extension point rather than a decorator: a requirement
# registered here is listed in the cart's `requirements` next to Spree's own, and
# the storefront refuses Pay now while any non-payment requirement is listed. It
# shows the message in the address section and takes no money. No storefront
# rebuild is needed.
#
# Blank is left to Spree's "Email address is required", so a blank email is not
# reported twice. The pattern is the one EmailValidator uses at complete, so the
# check here and the check that used to fail after payment cannot disagree.
#
# after_initialize, not to_prepare: see the note in spree.rb about registries
# that do not exist yet during load_config_initializers.
Rails.application.config.after_initialize do
  registry = Spree::Checkout::Registry
  registry.remove_requirement(step: :address, field: :email)
  registry.add_requirement(
    step: :address,
    field: :email,
    message: 'Please enter a valid email address',
    satisfied: ->(order) { order.email.blank? || EmailValidator::EMAIL_REGEX.match?(order.email.to_s) }
  )
end
