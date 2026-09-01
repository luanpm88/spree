# Order numbers carry the shop's own prefix, not Spree's "R".
#
# The client's orders have carried a three letter prefix and nine digits for
# years, and the prefix is per shop: each of the six has its own. Customers quote
# these numbers in emails, so they are not cosmetic.
#
# No real order number appears in this comment on purpose. This repository is
# public, and an order number is a customer's own reference.
#
# ── why this file exists ─────────────────────────────────────────────────────
#
# Spree hard codes the prefix:
#
#   # spree_core 5.6.1, app/models/spree/order.rb
#   include Spree::Core::NumberGenerator.new(prefix: 'R')
#
# The old shop got ECA by EDITING THAT LINE in a local checkout of the gem:
#
#   # /home/eshop/525/spree/core/app/models/spree/order.rb, line 25
#   include Spree::Core::NumberGenerator.new(prefix: Rails.application.config.order_number_prefix)
#
# which is why config/initializers/spree.rb over there sets
# `Rails.application.config.order_number_prefix = 'ECA'` and why that setting
# does nothing on a stock install: no released Spree reads it. Carrying the
# fork forward would mean re-patching the gem on every upgrade, which is the
# thing this migration exists to stop doing.
#
# So the same result, from app/, using Spree's own generator so the format of
# the number stays identical.
#
# ── the prefix comes from the environment ────────────────────────────────────
#
# One image serves all six shops, so the prefix cannot be a constant in the
# code. Each shop's .env carries ORDER_NUMBER_PREFIX; script/shop_host writes it
# from the estate table. Missing means 'R', which is Spree's own default and is
# obviously wrong on sight rather than quietly wrong.
module Spree
  module OrderDecorator
    def self.prepended(base)
      prefix = ENV['ORDER_NUMBER_PREFIX'].presence || 'R'

      # Including a second NumberGenerator puts its generate_number ahead of the
      # gem's in the ancestor chain, so the prefix changes without touching how
      # the rest of the number is built: same length, same alphabet, same
      # collision handling.
      base.include Spree::Core::NumberGenerator.new(prefix: prefix)
    end
  end

  Order.prepend OrderDecorator
end
