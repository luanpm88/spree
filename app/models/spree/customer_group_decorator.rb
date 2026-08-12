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

    # Makes the bulk path publish the events the single path already publishes.
    #
    # ── the hole this closes ──────────────────────────────────────────────────
    #
    # Spree's own add_customers ends in
    #
    #   Spree::CustomerGroupUser.upsert_all(records_to_insert, on_duplicate: :skip)
    #
    # and upsert_all runs no ActiveRecord callbacks, so it publishes nothing. Measured
    # side by side: add_customers for two users produced 0 customer_group_user.created
    # events, while a single CustomerGroupUser.create! produced them normally.
    #
    # That is the code path behind Customer Groups -> a group -> Add customers, which is
    # the obvious way to approve a batch of applicants. Without this, the shop ticks five
    # names, five people silently get trade pricing, and not one of them is told.
    #
    # It got worse than the missing email. first_approving_membership? decides whether to
    # send by asking whether THIS row is the customer's oldest approving membership. A row
    # created silently by the bulk path still counts in that query, so a later genuine
    # approval through the user form would find the older bulk row, conclude the customer
    # had already been told, and stay quiet for good.
    #
    # ── why super, rather than replacing upsert_all with create! ─────────────
    #
    # Spree chose the bulk insert on purpose. A shop adding five hundred customers should
    # not pay five hundred inserts because we wanted callbacks. So the fast path stays and
    # the events are published after it.
    #
    # The membership ids are captured BEFORE calling super, because super returns a count
    # rather than the rows, and publishing for somebody who was already a member would
    # send them a second approval email.
    #
    # remove_customers has the same shape, delete_all with no callbacks, and is
    # deliberately left alone: nothing here emails on removal, and it should not start.
    #
    # @param user_ids [Array]
    # @return [Integer] the count Spree returns, unchanged
    def add_customers(user_ids)
      wanted = Array(user_ids).map(&:to_s).uniq
      return super if wanted.empty?

      already = customer_group_users.where(user_id: wanted).pluck(:user_id).map(&:to_s).to_set
      created = super
      return created if created.to_i.zero?

      fresh = wanted.reject { |id| already.include?(id) }
      return created if fresh.empty?

      customer_group_users.where(user_id: fresh).find_each do |membership|
        # The same guard the callback carries, so a context that has events switched off
        # (seeds, a bulk import) stays as silent here as it does everywhere else.
        next unless membership.send(:should_publish_events?)

        membership.send(:publish_create_event)
      end

      created
    end

    # Makes an un-decline from the group screen visible.
    #
    # remove_customers is delete_all plus touch_users, and neither runs a callback, so
    # removing somebody from "Not Approved" publishes NOTHING. Measured against the other
    # two paths:
    #
    #   customer_group_ids=      user.updated        (the admin customer form)
    #   remove_customers         nothing             (this, and the Admin API)
    #   destroy on the join row  nothing, because CustomerGroupUser enables :create only
    #
    # That silence is the difference between an approval that arrives late and one that
    # never arrives: SpreeStarter::ApprovalNotificationSubscriber#handle_user_changed is
    # the only thing that can notice a customer has become approved without a new
    # membership appearing, and it needs an event to run at all.
    #
    # Publishing user.updated rather than inventing a new event name, because that is
    # exactly what the equivalent form path already publishes, so one handler covers both.
    #
    # @param user_ids [Array]
    # @return [Integer] the count Spree returns, unchanged
    def remove_customers(user_ids)
      wanted = Array(user_ids).map(&:to_s).uniq
      removed = super
      return removed if removed.to_i.zero? || wanted.empty?

      Spree.user_class.where(id: wanted).find_each do |user|
        next unless user.respond_to?(:should_publish_events?, true)
        next unless user.send(:should_publish_events?)

        user.publish_event('user.updated')
      end

      removed
    end
  end

  CustomerGroup.prepend CustomerGroupDecorator
end
