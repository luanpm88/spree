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
    subscribes_to 'customer_group_user.created', 'user.updated'

    on 'customer_group_user.created', :handle_membership
    on 'user.updated', :handle_user_changed

    # Long enough for an admin who is assigning two groups in one sitting to finish, and
    # short enough that somebody waiting on approval cannot tell. Also gives the
    # membership row time to settle before the mailer re-reads it.
    #
    # It earns its keep twice over now that Not Approved exists. Every one of the three
    # mailers re-reads the customer's groups when the job RUNS, so an admin who clicks
    # the wrong group and fixes it within two minutes sends nothing at all. The client
    # said it himself about declining: it is "much worse to send by mistake".
    GRACE = 2.minutes

    # A customer joined a group, so the shop has just decided something.
    def handle_membership(event)
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
        # Told once, and "once" is a recorded fact rather than a guess about row order.
        # See Spree::UserDecorator::APPROVAL_NOTIFIED_KEY: the old ordering test was spent
        # the moment a send was withheld, so a withheld approval could never be delivered
        # by any later event.
        return if user.approval_notified?

        # Ordering survives as a cheap de-duplicator, and ONLY that. Two approving groups
        # ticked in one save publish two events; both pass the marker check, because the
        # marker is not written until a job renders. Without this they enqueue two jobs
        # that then race to be the one that marks, and a lost race sends a second
        # "you are approved".
        #
        # It is safe here in a way it was not as the correctness guard, because the
        # recovery path does not consult it: handle_user_changed has no ordering test, so
        # an approval withheld while a customer was still declined is still delivered when
        # the decline is lifted. Optimisation here, correctness there.
        return unless first_approving_membership?(user, membership, store)

        Spree::CustomerMailer.approval_email(user, store).deliver_later(wait: GRACE)
      end
    end

    # The customer record changed, which is the ONLY signal a declining membership going
    # away produces. Measured:
    #
    #   customer_group_ids=      publishes user.updated        (the admin customer form)
    #   remove_customers         publishes NOTHING             (group screen and API)
    #   destroy on the join row  publishes nothing either, because CustomerGroupUser has
    #                            only :create lifecycle events enabled
    #
    # So this handler is how an un-decline reaches the customer at all. It is cheap on the
    # hot path: almost every user.updated returns on the first or second line.
    #
    # The group-screen path is covered by Spree::CustomerGroupDecorator#remove_customers,
    # which publishes user.updated for the affected customers precisely so that this
    # handler is the single place the decision is re-examined.
    def handle_user_changed(event)
      user = find_user(event)
      return if user.nil?
      return if user.approval_notified?

      store = event.store || Spree::Store.default
      return if store.nil?

      # Only an approval is announced here. Nothing about a user record changing tells us
      # the shop just declined somebody, and inventing that would email people on an
      # address edit.
      return unless approved_now?(user, store)

      Spree::CustomerMailer.approval_email(user, store).deliver_later(wait: GRACE)
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

    # A de-duplicator, not the once-only guard. Exactly one row can be the oldest, so two
    # events from one save cannot both pass, and no race window exists at enqueue time.
    def first_approving_membership?(user, membership, store)
      scope = Spree::CustomerGroupUser.where(user_id: user.id, user_type: membership.user_type)
      excluded = store.respond_to?(:non_approving_customer_group_ids) ? store.non_approving_customer_group_ids : []
      scope = scope.where.not(customer_group_id: excluded) if excluded.any?

      scope.order(:created_at, :id).first&.id == membership.id
    rescue StandardError
      # Fail towards enqueuing: the mailer re-checks entitlement and the marker stops a
      # duplicate, so a broken query here costs a wasted job rather than a missing email.
      true
    end

    def find_user(event)
      Spree.user_class.find_by_prefix_id(event.payload['id'])
    rescue StandardError
      nil
    end

    # Mirrors StorefrontGatingDecorator#approved_for_pricing? and
    # CustomerMailer#in_approving_group?: Not Approved is terminal and is checked first, a
    # group on the exclusion list does not count, anything else does. The mailer checks it
    # again at render time, which is what makes the two minute grace useful.
    def approved_now?(user, store)
      return false unless user.respond_to?(:customer_groups)

      groups = user.customer_groups
      declining = store.respond_to?(:declining_customer_group_ids) ? store.declining_customer_group_ids : []
      return false if declining.any? && groups.exists?(id: declining)

      excluded = store.respond_to?(:non_approving_customer_group_ids) ? store.non_approving_customer_group_ids : []
      return groups.exists? if excluded.empty?

      groups.where.not(id: excluded).exists?
    rescue StandardError
      false
    end
  end
end
