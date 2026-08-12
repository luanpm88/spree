module Spree
  module Api
    module V3
      # Extends the Store API's price gating so that signing in is not the same thing
      # as being approved.
      #
      # Spree's own rule, in spree_api's StorefrontGating, is one line:
      #
      #   def hide_prices?
      #     try_spree_current_user.blank? && !!current_channel&.storefront_prices_hidden?
      #   end
      #
      # and its documentation says so plainly: "Logged-in customers are never gated."
      # That is the right rule for a shop where signing in IS the entitlement. It is the
      # wrong rule for a trade shop, where anyone can register and the shop decides
      # afterwards who may see trade prices. Out of the box, an applicant creates an
      # account and immediately sees every price.
      #
      # Hiding them in the storefront alone would be theatre. The Next.js front end
      # reads the same Store API that anything else with the publishable key can read,
      # so the numbers have to be absent from the response, not merely unrendered.
      #
      # A prepend rather than an event or a service swap, against the order of
      # preference in CLAUDE.md, because there is nothing else to reach for: this is a
      # per-request authorization decision inside a controller concern, and Spree
      # exposes no dependency or event for it. It is deliberately one method.
      #
      # APPROVAL IS MEMBERSHIP OF ANY CUSTOMER GROUP, not of one group named in code.
      # The client's group is "Bulk Orders" today, and a shop with distributors and
      # resellers will have more tomorrow. Matching on a name means a rename in the
      # admin silently hides prices from every approved customer, with no error and no
      # clue. Membership is the thing he actually manipulates when he approves someone.
      module StorefrontGatingDecorator
        def hide_prices?
          # Guests keep Spree's answer exactly. Nothing here loosens the existing gate.
          return true if super

          user = try_spree_current_user
          return false if user.blank?

          # Only ever applies on a channel the shop has already gated. A public channel
          # stays public: this must not turn a retail storefront into a members club
          # because somebody attached a customer group to it.
          #
          # Tested as "not public" rather than against storefront_prices_hidden?, and
          # that was a real hole. The two predicates are mutually exclusive:
          #
          #   public           prices_hidden?=false  login_required?=false
          #   prices_hidden    prices_hidden?=true   login_required?=false
          #   login_required   prices_hidden?=false  login_required?=true
          #
          # So the earlier guard switched this off on login_required, which is the MORE
          # restrictive posture, not a looser one. Found by auditing the live shop: its
          # Wholesale channel is login_required, so an approved-looking but unapproved
          # customer who signed in saw every trade price, on the one channel where that
          # matters most. login_required only stops GUESTS reading the catalog; it says
          # nothing about who may see prices once signed in, which is this method's job.
          #
          # Inverted against 'public' rather than listing the gated values, because a
          # posture added to Spree::Channel::Gating::STOREFRONT_ACCESS later would be a
          # further restriction, and a list would silently fail open on it.
          return false if current_channel.nil?
          return false if current_channel.resolved_storefront_access == 'public'

          !approved_for_pricing?(user)
        end

        private

        # @param user [Spree.user_class]
        # @return [Boolean] whether this customer may see prices
        def approved_for_pricing?(user)
          return true unless user.respond_to?(:customer_groups)

          user.customer_groups.exists?
        rescue StandardError
          # Fail OPEN, and the choice is deliberate.
          #
          # Failing closed would hide prices from every approved customer the moment
          # this query broke, turning a fault into a shop that appears to have no
          # prices at all, which reads to a buyer as a broken site rather than as a
          # permission. Failing open shows trade prices to someone unapproved, which is
          # a disclosure the shop can see and correct. The blast radius of the first is
          # every customer; of the second, one.
          true
        end
      end
    end
  end
end

Spree::Api::V3::StorefrontGating.prepend Spree::Api::V3::StorefrontGatingDecorator
