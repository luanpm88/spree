module Spree
  # A customer group's part in the approval workflow.
  #
  # The mapping itself lives on the store, see Spree::StoreDecorator for why it is
  # keyed by id rather than by name. This is only the reader, so that callers ask a
  # group what it means instead of each one reaching for the preference and reasoning
  # about it again.
  module CustomerGroupDecorator
    # @return [Symbol] :more_information, :not_approved, or :approves
    def approval_role
      owning = store || Spree::Store.default
      return :approves if owning.nil?

      owning.approval_role_for(id)
    end

    # @return [Boolean] whether membership of this group means the customer may see
    #   trade prices. True for every group the shop has not marked otherwise, which is
    #   what keeps an unconfigured shop behaving as it did before.
    def approves_pricing?
      approval_role == :approves
    end
  end

  CustomerGroup.prepend CustomerGroupDecorator
end
