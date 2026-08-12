module Spree
  # Spree 5.6 has no welcome email. What it has is a single hook, in
  # spree_core/app/services/spree/orders/create_user_account.rb:28:
  #
  #     user.send_welcome_email if user.respond_to?(:send_welcome_email)
  #
  # Nothing implements it, and that one call site is the guest-checkout path where a
  # shopper opts into an account. The client's wholesale flow is the other shape
  # entirely: he approves an application, creates the customer in the admin himself,
  # and expects the system to send a welcome with a link to set a password. Nothing in
  # Spree fires for an admin-created customer, so this adds both halves — the method
  # the existing hook is looking for, and a trigger for the admin path.
  #
  # A callback rather than a subscriber, against the usual order of preference in
  # CLAUDE.md.
  #
  # An earlier version of this note claimed Spree publishes no customer lifecycle event
  # to subscribe to. That was wrong. Spree::Publishable is included in Spree::Base, so
  # Spree::User publishes user.created on after_commit like every other model, and
  # SpreeStarter::SignupNotificationSubscriber uses exactly that.
  #
  # The callback stays here anyway, for a reason that does not apply to the subscriber.
  # This email carries a password-reset token minted for this specific send. A
  # subscriber runs later, in another process, from a payload; it would have to mint a
  # second token, and the account-creation path is precisely where a token has to
  # belong to the mail that went out. Anything reachable from the event alone belongs
  # in a subscriber instead.
  module UserDecorator
    def self.prepended(base)
      # Off by default, deliberately. This fires on EVERY user row that gets created,
      # which includes seeds, sample data and any bulk customer import. Turning it on
      # is one line in config/initializers/spree.rb; having a CSV import silently email
      # five thousand people is not something to leave as a default.
      base.class_attribute :send_welcome_emails, default: false

      # An escape hatch for the cases that should never mail even when it is on:
      #   Spree::User.create!(email: ..., skip_welcome_email: true)
      base.attr_accessor :skip_welcome_email

      base.after_create_commit :deliver_welcome_email_if_enabled
    end

    # Sends the welcome, including a password-reset link so the customer can set their
    # own password. Deliberately public and callable on its own, so an admin can resend
    # one from the console without recreating the account:
    #
    #   Spree.user_class.find_by(email: '...').send_welcome_email
    def send_welcome_email
      store = respond_to?(:stores) ? stores.first : nil
      store ||= Spree::Store.default
      return if store.nil?

      # `generate_token_for(:password_reset)`, NOT Devise's set_reset_password_token.
      #
      # There are two different reset mechanisms in play and they do not interoperate.
      # Devise's token works with Spree.user_class.reset_password_by_token, which is the
      # Rails-side path. The storefront never touches that: it PATCHes
      # /api/v3/store/password_resets/:id, and that controller reads the token with
      # find_by_password_reset_token, which is Rails' own generates_token_for.
      #
      # Handing out a Devise token produces an email whose link opens the right page,
      # shows the right form, accepts the password, and then answers "Password reset
      # token is invalid or has expired". Everything up to the last step looks correct,
      # which is why this needs an end-to-end test rather than a unit one.
      token = generate_token_for(:password_reset)

      Spree::CustomerMailer.welcome_email(self, token, store).deliver_later
    end

    private

    def deliver_welcome_email_if_enabled
      return unless self.class.send_welcome_emails
      return if skip_welcome_email

      send_welcome_email
    rescue StandardError => e
      # Never let a mail failure roll back or block account creation. The account
      # existing matters more than the notification, and the customer can always use
      # "forgot password" instead.
      Rails.logger.error("[welcome_email] #{email}: #{e.class}: #{e.message}")
    end
  end

  User.prepend UserDecorator
end
