# frozen_string_literal: true

module SpreeStarter
  # Tells the customer what the shop decided, the moment the shop decides it.
  #
  # Approval on this shop is one action: an admin moves an applicant into a customer
  # group. Nothing in Spree marks that moment, so without this the applicant is left
  # refreshing a page waiting for numbers to appear.
  #
  # The client then settled the workflow as three outcomes, not one, and these are his
  # words:
  #
  #   Approved            "information looks good, Approved. Finished."
  #   More Information    "we will not know what info to ask for in a template"
  #   Not Approved        "not approved means: Not Approved"
  #
  # All three are customer groups, because that is the only thing the admin can do, so
  # all three arrive here as the same event. Which group means which outcome is
  # configured by id on the store, see Spree::StoreDecorator, and any group the shop has
  # not marked simply approves. That is what lets an unconfigured shop keep working.
  #
  # The client first proposed doing this from Acelle, with staff adding the customer to a
  # mailing list by hand. That works, and it also makes approving two jobs in two systems
  # where forgetting the second is invisible: the customer has trade pricing and was never
  # told, and the shop looks correct from the inside. He chose this route once that was
  # laid out.
  #
  # Spree::CustomerGroupUser carries publish_events but NOT lifecycle events, so nothing
  # fires on the join until they are switched on. That happens in
  # config/initializers/spree.rb, and this subscriber is useless without it.
  class ApprovalNotificationSubscriber < Spree::Subscriber
    subscribes_to 'customer_group_user.created'

    # Long enough for an admin who is assigning two groups in one sitting to finish, and
    # short enough that somebody waiting on approval cannot tell. Also gives the
    # membership row time to settle before the mailer re-reads it.
    #
    # It earns its keep twice over now that Not Approved exists. Every one of the three
    # mailers re-reads the customer's groups when the job RUNS, so an admin who clicks
    # the wrong group and fixes it within two minutes sends nothing at all. The client
    # said it himself about declining: it is "much worse to send by mistake".
    GRACE = 2.minutes

    def handle(event)
      # The payload for this model is Spree's minimal fallback, {id, created_at,
      # updated_at}: no user_id, no customer_group_id, because there is no V3 serializer
      # for a join table. The row has to be fetched.
      membership = find_membership(event)
      return if membership.nil?

      user = membership.user
      return if user.nil?

      store = event.store || Spree::Store.default
      return if store.nil?

      case role_for(membership, store)
      when :more_information
        Spree::CustomerMailer.more_information_email(user, store).deliver_later(wait: GRACE)
      when :not_approved
        Spree::CustomerMailer.not_approved_email(user, store).deliver_later(wait: GRACE)
      else
        # Approval happens once. A customer later added to a second approving group, say
        # distributors on top of Wholesale, has already been told.
        #
        # Decided by asking whether THIS row is their oldest APPROVING membership rather
        # than by counting. Counting loses a race: two groups attached in one request
        # publish two events, both see a count of two, and neither sends. Ordering has no
        # such window, because exactly one row can be the oldest.
        #
        # Scoped to approving groups, and that scope is the fix for a real bug. Before
        # it, the test was "oldest membership of any kind", so a customer put into More
        # Information first and approved afterwards would have had the APPROVAL email
        # fire on the More Information row, and then nothing at all on the real approval.
        # Exactly backwards, on the sequence the client is most likely to use.
        return unless first_approving_membership?(user, membership, store)

        Spree::CustomerMailer.approval_email(user, store).deliver_later(wait: GRACE)
      end
    end

    private

    def find_membership(event)
      Spree::CustomerGroupUser.find_by_prefix_id(event.payload['id'])
    rescue StandardError
      nil
    end

    # @return [Symbol] :approves, :more_information or :not_approved
    def role_for(membership, store)
      store.approval_role_for(membership.customer_group_id)
    rescue StandardError
      # An unreadable preference must not turn an approval into silence. Approving is
      # the common case by a wide margin, and the mailer re-checks entitlement anyway.
      :approves
    end

    def first_approving_membership?(user, membership, store)
      scope = Spree::CustomerGroupUser.where(user_id: user.id, user_type: membership.user_type)
      excluded = store.non_approving_customer_group_ids
      scope = scope.where.not(customer_group_id: excluded) if excluded.any?

      scope.order(:created_at, :id).first&.id == membership.id
    end
  end
end
