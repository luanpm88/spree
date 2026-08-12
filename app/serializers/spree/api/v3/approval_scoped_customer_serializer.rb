module Spree
  module Api
    module V3
      # Makes `customer_groups` in the STORE API mean "the groups that approve you".
      #
      # ── the invariant this restores ────────────────────────────────────────────
      #
      # storefront/src/lib/wholesale.ts#isWholesaleApproved is
      #
      #     Boolean(customer?.customer_groups?.length)
      #
      # and its own docblock states the rule: it mirrors the server, "and the two must
      # agree... Disagreement produces the worst outcome of the two, a page that says
      # awaiting approval over prices it was given, or an ordering surface opened to
      # someone the API will refuse."
      #
      # That was true when every customer group meant approved. Then the server learned
      # about More Information and Not Approved and the storefront did not, so a customer
      # declined into "Not Approved" had customer_groups.length == 1, read as approved, and
      # was shown the full portal: their name in the header, the catalogue, the cart
      # drawer. The API then refused to price any of it. Exactly the failure the docblock
      # names, and caused by changing one side only.
      #
      # ── why fix it here rather than in the storefront ─────────────────────────
      #
      # Because this is what Spree says the field is for. Its own comment on the attribute
      # reads "Membership signal for storefront branching (e.g. wholesale approval)". So
      # the honest repair is to make the signal carry the shop's actual verdict, computed
      # in one place, rather than to teach a second client how to recompute it. It also
      # means no SDK type changes and no second definition of "approved" to drift.
      #
      # ── why SUBCLASS and not a decorator on V3::CustomerSerializer ────────────
      #
      # Spree::Api::V3::Admin::CustomerSerializer INHERITS from V3::CustomerSerializer and
      # is registered under a different dependency (admin_customer_serializer). Prepending
      # a module onto the parent would filter the admin API too, and an admin screen that
      # cannot see a customer's Not Approved membership is a shop that cannot tell why
      # somebody has no prices.
      #
      # ── what a shop that has configured nothing sees ──────────────────────────
      #
      # Exactly what it sees today. Both id lists come from approval_group_roles, which
      # defaults to {}, so nothing is filtered and the payload is unchanged.
      #
      # ── what this deliberately does NOT do ────────────────────────────────────
      #
      # "More Information" now looks the same to the storefront as "no group yet", and both
      # render the Awaiting Approval state. That is correct rather than a shortcut: a
      # customer on hold IS awaiting approval, and the detail of what the shop needs
      # reaches them by email, where the shop typed it. A distinct on-hold screen would
      # need a serialized role and a third branch in WholesaleGate, which is its own piece
      # of work and not this one.
      class ApprovalScopedCustomerSerializer < CustomerSerializer
        many :customer_groups,
             proc { |groups, params|
               store = params&.dig(:store) || Spree::Current.store
               # params first, then Spree::Current: the parent does the same, because
               # Spree::Current.store falls back to the DEFAULT store, which is the wrong
               # answer on a sibling store's domain.
               scoped = groups.for_store(store)
               next scoped unless store.respond_to?(:declining_customer_group_ids)

               # Not Approved is terminal and is checked first, the same order as
               # StorefrontGatingDecorator#approved_for_pricing? and
               # CustomerMailer#in_approving_group?. An approving group left behind must
               # not read as approval.
               declining = store.declining_customer_group_ids
               next scoped.none if declining.any? && scoped.exists?(id: declining)

               excluded = store.non_approving_customer_group_ids
               excluded.any? ? scoped.where.not(id: excluded) : scoped
             },
             resource: proc { Spree.api.customer_group_serializer }
      end
    end
  end
end
