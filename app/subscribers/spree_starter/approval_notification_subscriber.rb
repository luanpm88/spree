# frozen_string_literal: true

module SpreeStarter
  # Tells the customer they have been approved, the moment the shop approves them.
  #
  # Approval on this shop is one action: an admin moves an applicant into a customer
  # group and their prices stop reading "Awaiting Approval". Nothing in Spree marks
  # that moment, so without this the applicant is left refreshing a page waiting for
  # numbers to appear.
  #
  # The client first proposed doing this from Acelle, with staff adding the customer
  # to a mailing list by hand. That works, and it also makes approving two jobs in two
  # systems where forgetting the second is invisible: the customer has trade pricing
  # and was never told, and the shop looks correct from the inside. He chose this
  # route once that was laid out.
  #
  # Spree::CustomerGroupUser carries publish_events but NOT lifecycle events, so
  # nothing fires on the join until they are switched on. That happens in
  # config/initializers/spree.rb, and this subscriber is useless without it.
  class ApprovalNotificationSubscriber < Spree::Subscriber
    subscribes_to 'customer_group_user.created'

    # Long enough for an admin who is assigning two groups in one sitting to finish,
    # and short enough that somebody waiting on approval cannot tell. Also gives the
    # membership row time to settle before the mailer re-reads it.
    GRACE = 2.minutes

    def handle(event)
      # The payload for this model is Spree's minimal fallback, {id, created_at,
      # updated_at}: no user_id, no customer_group_id, because there is no V3
      # serializer for a join table. The row has to be fetched.
      membership = find_membership(event)
      return if membership.nil?

      user = membership.user
      return if user.nil?

      store = event.store || Spree::Store.default
      return if store.nil?

      # Approval happens once. A customer later added to a second group, say
      # distributors on top of Bulk Orders, has already been told.
      #
      # Decided by asking whether THIS row is their oldest membership rather than by
      # counting groups. Counting loses a race: two groups attached in one request
      # publish two events, both see a count of two, and neither sends. Ordering has
      # no such window, because exactly one row can be the oldest.
      return unless first_membership_for?(user, membership)

      Spree::CustomerMailer.approval_email(user, store).deliver_later(wait: GRACE)
    end

    private

    def find_membership(event)
      Spree::CustomerGroupUser.find_by_prefix_id(event.payload['id'])
    rescue StandardError
      nil
    end

    def first_membership_for?(user, membership)
      oldest = Spree::CustomerGroupUser.where(user_id: user.id)
                                       .order(:created_at, :id)
                                       .first
      oldest&.id == membership.id
    end
  end
end
