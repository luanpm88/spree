module Spree
  # Spree has no welcome email, on 5.6 or on 6.0. 5.6 at least had a hook for one, in
  # spree_core/app/services/spree/orders/create_user_account.rb:
  #
  #     user.send_welcome_email if user.respond_to?(:send_welcome_email)
  #
  # 6.0 dropped even that. The client's wholesale flow needs one anyway: he approves an
  # application, or creates the customer himself, and expects the system to send a
  # welcome. Nothing in Spree fires for either, so this adds the method and the trigger.
  #
  # On Spree::Customer, which is what Spree 6.0 signs customers in with. It was
  # Spree::User, a Devise model of our own, until 6.0; spree:upgrade copies every
  # spree_users row into spree_customers, keeping the id and the password hash.
  #
  # A callback rather than a subscriber, against the usual order of preference in
  # CLAUDE.md. Spree::Customer publishes user.created like any model, and
  # SpreeStarter::SignupNotificationSubscriber uses exactly that. The callback stays
  # here for a reason that does not apply to the subscriber: this email carries a
  # password-reset token minted for this specific send. A subscriber runs later, in
  # another process, from a payload; it would have to mint a second token, and the
  # account-creation path is precisely where a token has to belong to the mail that
  # went out. Anything reachable from the event alone belongs in a subscriber instead.
  module CustomerDecorator
    def self.prepended(base)
      # Off by default, deliberately. This fires on EVERY user row that gets created,
      # which includes seeds, sample data and any bulk customer import. Turning it on
      # is one line in config/initializers/spree.rb; having a CSV import silently email
      # five thousand people is not something to leave as a default.
      base.class_attribute :send_welcome_emails, default: false

      # An escape hatch for the cases that should never mail even when it is on:
      #   Spree::Customer.create!(email: ..., skip_welcome_email: true)
      base.attr_accessor :skip_welcome_email

      base.after_create_commit :deliver_welcome_email_if_enabled
    end

    # Where the shop's note to this applicant lives.
    #
    # The client asked for "a text box; then we just add the info, send it, and the user
    # replies to the listed email address". This is that box, and it is read by both
    # more_information_email and not_approved_email.
    #
    # On 6.0 the note is a custom field on the customer, labelled "Approval note", which
    # the dashboard shows on the customer's page. That is the nearest thing 6.0 has to
    # the 5.6 text box beside the customer group selector, which lived on the Rails
    # admin form that 6.0 removes. Its definition is created per store when the shop
    # moves (tmp/rehearsal6/600/post.rb); a custom field definition belongs to a store.
    #
    # The same string as the 5.6 key, namespace "approval" and key "note", so the
    # fallback below reads a note typed on 5.6. 5.6 kept it in private_metadata, which
    # spree:upgrade folds into `metadata` with its keys intact. Reading private_metadata
    # on 6.0 raises, which would stop every approval email.
    APPROVAL_NOTE_KEY = 'approval.note'

    # @return [String] never nil, because it is interpolated into an email as %{note} and
    #   I18n raises on a missing interpolation argument.
    def approval_note
      (get_custom_field(APPROVAL_NOTE_KEY)&.value.presence || metadata.to_h[APPROVAL_NOTE_KEY]).to_s
    end

    # For the console and for tests. Staff type the note in the dashboard.
    #
    # Into the custom field when the shop has the definition, else into metadata. The
    # metadata path MERGES rather than assigns: metadata's setter replaces the entire
    # hash, and one note is not worth deleting every other key in it.
    def approval_note=(value)
      if Spree::CustomFieldDefinition.exists?(resource_type: self.class.name, namespace: 'approval', key: 'note')
        set_custom_field(APPROVAL_NOTE_KEY, value.to_s.strip)
      else
        self.metadata = metadata.to_h.merge(APPROVAL_NOTE_KEY => value.to_s.strip)
      end
    end

    # When this customer was told they were approved, or nil if they never were.
    #
    # ── why a recorded fact instead of a clever query ────────────────────────
    #
    # The subscriber used to decide "have we already told them" by asking whether the
    # membership row that just appeared was the customer's OLDEST approving membership.
    # That reads the right answer out of the wrong thing, and it fails the moment a send
    # is dropped rather than delivered:
    #
    #   customer sits in Not Approved. Shop changes its mind and ticks Wholesale in the
    #   same save. The insert publishes, the row IS the oldest approving one, so the email
    #   is enqueued. Two minutes later the mailer re-checks, finds the Not Approved
    #   membership still there, and correctly refuses to send. Then the shop unticks Not
    #   Approved, which publishes nothing at all through remove_customers and only
    #   user.updated through the form. The customer is now approved, sees trade prices,
    #   and the ordering test still says the Wholesale row is the oldest, so no future
    #   event can ever send it. Told nothing, permanently.
    #
    # A marker cannot go stale like that. Not told yet means still to do, whatever order
    # the rows arrived in.
    APPROVAL_NOTIFIED_KEY = 'approval.notified_at'

    # @return [Boolean]
    def approval_notified?
      metadata.to_h[APPROVAL_NOTIFIED_KEY].present?
    end

    # Merges, for the same reason approval_note= does: metadata's setter replaces the
    # whole hash, and this must not delete the note the shop typed.
    def mark_approval_notified!
      return if approval_notified?

      update_columns(
        metadata: metadata.to_h.merge(APPROVAL_NOTIFIED_KEY => Time.current.iso8601)
      )
    end

    # Sends the welcome, including a password-reset link so the customer can set their
    # own password. Deliberately public and callable on its own, so an admin can resend
    # one from the console without recreating the account:
    #
    #   Spree.customer_class.find_by(email: '...').send_welcome_email
    def send_welcome_email
      # A customer has no store of its own on 6.0 (`stores` runs through staff roles,
      # which a customer never holds), and every shop here is one store per database.
      store = Spree::Store.default
      return if store.nil?

      # Rails' generates_token_for, the token the storefront's reset page sends back to
      # /api/v3/store/password_resets/:id. On 5.6 there was a second, Devise, token
      # that looked right and was rejected at the last step; Devise is gone on 6.0, so
      # this is now the only kind there is.
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

  Customer.prepend CustomerDecorator
end
