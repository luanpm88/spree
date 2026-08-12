module Spree
  # Which customer groups mean something other than "approved".
  #
  # ── the problem ────────────────────────────────────────────────────────────
  #
  # On this shop, approving a trade customer IS putting them in a customer group.
  # Spree has no approval state to read: Spree::User has no approved, status or state
  # column, and Spree::CustomerGroup carries only id, name, description and store_id.
  #
  # The client then asked for three outcomes rather than one, and his words for them:
  #
  #   Approved                 finished, they see trade prices
  #   More Information         we need more from them, not approved
  #   Not Approved             declined. He was explicit: "not approved means Not Approved"
  #
  # All three are customer groups, because that is the only thing the admin can
  # actually do. Which breaks the rule the price gate was written on, that membership
  # of ANY group means approved: a declined customer would be handed the trade list.
  #
  # ── why a mapping keyed by ID, and not a name match ───────────────────────
  #
  # The obvious implementation compares group names. It is also the one that fails
  # silently: rename "Not Approved" in the admin and every declined customer becomes
  # approved, with no error and nothing to notice. That is the worst direction for
  # this particular fault, because the shop cannot see it and the customer will not
  # report it.
  #
  # So names are resolved to ids ONCE, by rake task, and the id is what is stored.
  # A rename afterwards changes nothing, which is what the client was promised.
  #
  # ── why role => id, rather than id => role ────────────────────────────────
  #
  # There is exactly one group per role. Keying by role makes that true by
  # construction, and it is also the direction the mailer reads: given the role, which
  # group is it.
  #
  # ── the default is load-bearing ───────────────────────────────────────────
  #
  # Empty by default, which means NO group has a special role, which means every group
  # approves, which is exactly the behaviour before this file existed. So it deploys
  # to a live shop without changing anything, and starts mattering only once somebody
  # runs the rake task. A design that required configuration to be correct would have
  # taken prices away from every approved customer the moment it shipped.
  module StoreDecorator
    # Roles that do NOT grant trade pricing. `approves` is deliberately absent: it is
    # the default for every group that is not named here, so it never needs storing
    # and cannot drift out of sync with reality.
    NON_APPROVING_ROLES = %w[more_information not_approved].freeze

    def self.prepended(base)
      base.preference :approval_group_roles, :hash, default: {}
    end

    # @return [Hash{String => Integer}] role name to customer group id, cleaned.
    #   Unknown roles and unparseable ids are dropped rather than raising: this is
    #   read on the price path of every product request, and a typo in a preference
    #   must not take the catalogue down.
    def approval_group_roles
      raw = preferred_approval_group_roles
      return {} unless raw.is_a?(Hash)

      raw.each_with_object({}) do |(role, id), memo|
        role = role.to_s
        next unless NON_APPROVING_ROLES.include?(role)

        id = id.to_i
        next if id.zero?

        memo[role] = id
      end
    end

    # @return [Array<Integer>] the group ids that do NOT grant trade pricing
    def non_approving_customer_group_ids
      approval_group_roles.values
    end

    # @param group_id [Integer]
    # @return [Symbol] :more_information, :not_approved, or :approves
    def approval_role_for(group_id)
      approval_group_roles.key(group_id.to_i)&.to_sym || :approves
    end
  end

  Store.prepend StoreDecorator
end
