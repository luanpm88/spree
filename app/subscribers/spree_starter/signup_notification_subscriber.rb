# frozen_string_literal: true

module SpreeStarter
  # Tells the shop that somebody signed up and is waiting to be approved.
  #
  # The wholesale flow has a silent gap without this. An applicant registers, sees
  # "Awaiting Approval" where every price should be, and waits. Spree sends the shop
  # nothing, so the only way anyone finds out is by opening the customer list and
  # noticing a new row. The applicant gives up long before that happens.
  #
  # A subscriber rather than a model callback, which is the order CLAUDE.md asks for
  # and was worth checking rather than assuming: Spree::Publishable is included in
  # Spree::Base, so Spree::User publishes user.created on after_commit like any other
  # model. An earlier note in user_decorator.rb claimed no customer lifecycle event
  # existed. It was wrong, and wrong in the direction that costs you, because it sent
  # the welcome email down the decorator route for no reason.
  #
  # Being a subscriber buys two things a callback does not. It runs through
  # Spree::Events::SubscriberJob, so a mail failure happens well away from the request
  # that created the account and can never roll a signup back. And Spree::User is left
  # alone.
  class SignupNotificationSubscriber < Spree::Subscriber
    subscribes_to 'user.created'

    # Long enough for someone finishing a form in the admin to attach a customer group,
    # short enough that an applicant waiting on a reply cannot tell. See the note on
    # Spree::CustomerMailer#store_signup_notification for why the decision that uses
    # this grace period is taken there and not here.
    GRACE = 2.minutes

    def handle(event)
      store = event.store || Spree::Store.default
      return if store.nil?

      user = find_user(event)
      return if user.nil?

      # Nothing is decided here beyond "there is a customer and a store". Both the
      # notification address and the group membership are read by the mailer, because
      # they are read correctly only after the wait below.
      Spree::CustomerMailer.store_signup_notification(user, store).deliver_later(wait: GRACE)
    end

    private

    # By prefixed id first. The payload carries `cus_UkLWZg9DAJ` rather than a raw
    # database id, and email is not a safe key on its own: Spree allows the same address
    # on more than one store, so find_by(email:) can return a different person's account
    # on a multi-store install.
    def find_user(event)
      Spree.user_class.find_by_prefix_id(event.payload['id']) ||
        Spree.user_class.find_by(email: event.payload['email'])
    rescue StandardError
      Spree.user_class.find_by(email: event.payload['email'])
    end
  end
end
