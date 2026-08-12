module Spree
  # Adds the welcome email that Spree 5.6 does not ship. Shaped after the stock
  # password_reset_email in spree_emails, so it inherits the same store-locale
  # handling, the same URL host defaulting, and the same token-appending helper.
  module CustomerMailerDecorator
    def self.prepended(base)
      # Where the reset link points, relative to the store's storefront_url.
      #
      # The stock password_reset_email does not need this: the storefront supplies a
      # redirect_url when a customer asks for a reset, so Spree just appends a token to
      # whatever it was handed. A welcome email has no such request behind it, and
      # appending the token to the bare storefront_url drops the customer on the home
      # page with a token in the query string and nothing to do with it.
      #
      # Deliberately WITHOUT the /{country}/{locale} prefix the storefront uses in its
      # URLs. Next.js redirects /account/reset-password?token=… to
      # /us/en/account/reset-password?token=… and keeps the query string, so letting it
      # choose is both shorter and more correct than guessing here. An earlier version
      # derived the country from the store's default market and produced /ca/en/,
      # because the market named "US" lists Canada first.
      #
      # Override for a different front end, which the client will need: he runs his own
      # login front end on the wholesale shop.
      #
      #   Spree::CustomerMailer.welcome_reset_path = '/account/set-password'
      base.class_attribute :welcome_reset_path, default: '/account/reset-password'
    end

    # @param user [Spree.user_class]
    # @param reset_token [String] the RAW Devise token, not the stored hash
    # @param store [Spree::Store]
    def welcome_email(user, reset_token, store)
      @user = user
      @current_store = store
      # append_token comes from Spree::BaseMailer and uses ?token= / &token=, which is
      # the parameter name the storefront's reset page reads. Do not invent another.
      @reset_url = append_token(
        "#{store.storefront_url.to_s.chomp('/')}#{self.class.welcome_reset_path}",
        reset_token
      )

      with_store_locale(store) do
        mail(
          to: user.email,
          subject: Spree.t('customer_mailer.welcome_email.subject', store: store.name),
          store_url: store.storefront_url
        )
      end
    end

    # Tells the shop that somebody has signed up and is waiting to be approved.
    #
    # Spree publishes nothing at all when a customer account is created, so without
    # this the wholesale flow has a silent gap in the middle: an applicant sits at
    # "Awaiting Approval" prices and the only way anyone finds out is by opening the
    # customer list and noticing a new row.
    #
    # Goes to the store's new_order_notifications_email. That field is what the admin
    # labels "New Order Notifications Email", and in 5.6.1 core the only thing that
    # actually reads it is WebhookMailer, with OrderMailer#store_owner_notification_email
    # in spree_emails the one real user. Reusing it keeps the shop's "where do we get
    # told about things" answer in one box rather than adding a second.
    #
    # The link points at the ADMIN host, not the storefront. store.formatted_url is
    # the backend; store.storefront_url is where customers go, and a customer record
    # does not exist there.
    #
    # @param user [Spree.user_class] the customer who just signed up
    # @param store [Spree::Store]
    def store_signup_notification(user, store)
      # Both decisions live here rather than in the subscriber, and that is the whole
      # design. A mailer body is rendered when the JOB runs, not when it is enqueued,
      # and the subscriber enqueues this with a two minute delay. Here is therefore the
      # only place that sees the world as it is by the time the email would go out.
      #
      # Returning early yields ActionMailer::Base::NullMail, and deliver_later on a
      # NullMail is a no-op.

      # No address means the shop has not said where to send this. There is no sensible
      # fallback: mail_from_address would post it to the shop's own noreply mailbox.
      # Guarding is not optional, because reaching `mail(to: nil)` raises
      #   ArgumentError: SMTP To address may not be blank: []
      # and lands in the failed queue, which is a strange way to learn that a setting
      # was cleared.
      return if store.new_order_notifications_email.blank?

      # Somebody who belongs to a group has already been approved, which is what has
      # happened when the shop creates a trade customer and assigns them in one sitting.
      # Nothing to approve, nothing to announce.
      #
      # This is exactly why the send is delayed. user.created fires on the account's own
      # commit, and a group attached a moment later in a second transaction is not
      # visible yet. Checked at enqueue time this loses the race every time: measured,
      # not assumed. A customer created and approved together still got announced as
      # waiting.
      return if user.respond_to?(:customer_groups) && user.reload.customer_groups.any?

      @user = user
      @current_store = store
      @customer_admin_url = "#{store.formatted_url.to_s.chomp('/')}/admin/users/#{user.id}/edit"

      with_store_locale(store) do
        mail(
          to: store.new_order_notifications_email,
          subject: Spree.t('customer_mailer.store_signup_notification.subject',
                           email: user.email, store: store.name),
          store_url: store.storefront_url
        )
      end
    end
  end

  CustomerMailer.prepend CustomerMailerDecorator
end
