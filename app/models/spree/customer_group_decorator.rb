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

    def self.prepended(base)
      base.singleton_class.prepend ClassMethods
    end

    # The bulk membership paths, on the class rather than the instance.
    #
    # Spree 6.0 moved the work into CustomerGroup.add_customers_to and
    # .remove_customers_from, and the dashboard's bulk action on the customers list
    # calls those directly (spree_api admin/customers_controller.rb, apply_groups).
    # The instance methods still exist and only forward to them. A hook on the
    # instance, which is where this lived on 5.6, would see the group screen and miss
    # every bulk approval from the customers list.
    module ClassMethods
      # Makes the bulk path publish the events the single path already publishes.
      #
      # ── the hole this closes ────────────────────────────────────────────────
      #
      # Spree's own add_customers_to ends in
      #
      #   Spree::CustomerGroupUser.upsert_all(records_to_insert, on_duplicate: :skip)
      #
      # and upsert_all runs no ActiveRecord callbacks, so it publishes nothing.
      # Measured side by side on 5.6: add_customers for two users produced 0
      # customer_group_user.created events, while a single CustomerGroupUser.create!
      # produced them normally.
      #
      # That is the path behind ticking several applicants and adding them to a group,
      # which is the obvious way to approve a batch. Without this, the shop ticks five
      # names, five people silently get trade pricing, and not one of them is told.
      #
      # ── why super, rather than replacing upsert_all with create! ───────────
      #
      # Spree chose the bulk insert on purpose. A shop adding five hundred customers
      # should not pay five hundred inserts because we wanted callbacks. So the fast
      # path stays and the events are published after it.
      #
      # The existing membership ids are captured BEFORE calling super, because super
      # returns a count rather than the rows, and publishing for somebody who was
      # already a member would send them a second approval email.
      #
      # @param groups [Array<Spree::CustomerGroup>]
      # @param customer_ids [Array]
      # @return [Integer] the count Spree returns, unchanged
      def add_customers_to(groups, customer_ids)
        wanted = Array(customer_ids).compact_blank.map(&:to_s).uniq
        group_ids = Array(groups).map(&:id)
        return super if wanted.empty? || group_ids.empty?

        memberships = Spree::CustomerGroupUser.where(customer_group_id: group_ids, customer_id: wanted)
        already = memberships.pluck(:id)
        created = super
        return created if created.to_i.zero?

        memberships.where.not(id: already).find_each do |membership|
          # The same guard the callback carries, so a context that has events switched
          # off (seeds, a bulk import) stays as silent here as it does everywhere else.
          next unless membership.send(:should_publish_events?)

          membership.send(:publish_create_event)
        end

        created
      end

      # Makes an un-decline visible.
      #
      # remove_customers_from is delete_all plus touch_all, and neither runs a
      # callback, so removing somebody from "Not Approved" publishes NOTHING. The same
      # is true of saving a customer with fewer customer_group_ids, which Rails also
      # deletes without callbacks on a has_many :through.
      #
      # That silence is the difference between an approval that arrives late and one
      # that never arrives: SpreeStarter::ApprovalNotificationSubscriber#handle_user_changed
      # is the only thing that can notice a customer has become approved without a
      # new membership appearing, and it needs an event to run at all.
      #
      # Publishing user.updated rather than inventing a new event name, because that
      # is what a customer save already publishes, so one handler covers both.
      #
      # @param groups [Array<Spree::CustomerGroup>]
      # @param customer_ids [Array]
      # @return [Integer] the count Spree returns, unchanged
      def remove_customers_from(groups, customer_ids)
        wanted = Array(customer_ids).compact_blank.map(&:to_s).uniq
        removed = super
        return removed if removed.to_i.zero? || wanted.empty?

        Spree.customer_class.where(id: wanted).find_each do |customer|
          next unless customer.send(:should_publish_events?)

          customer.publish_event('user.updated')
        end

        removed
      end
    end
  end

  CustomerGroup.prepend CustomerGroupDecorator
end
