module Spree
  # Adds the welcome email that Spree 5.6 does not ship. Shaped after the stock
  # password_reset_email in spree_emails, so it inherits the same store-locale
  # handling, the same URL host defaulting, and the same token-appending helper.
  module CustomerMailerDecorator
    def self.prepended(base)
      # Wired explicitly. Spree::MailHelper is NOT a helper on this mailer, so a module
      # prepended onto it is invisible to these views. Measured the hard way.
      base.helper Spree::ApprovalMailHelper

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

      # Whether the welcome email carries a set-your-password link.
      #
      # Default true, which is right for a shop whose admin creates customer accounts:
      # those customers have no password and the link is their only way in.
      #
      # FALSE is right for this client, and the evidence is in his own storefront rather
      # than in an opinion. storefront/.../(wholesale)/wholesale/apply/page.tsx collects a
      # password on the application form: an `apply-password` field, minimum six
      # characters, autoComplete="new-password", posted as both password and
      # password_confirmation. So an applicant has already chosen one by the time this
      # email goes out, and his own wording agrees: "You can now sign in and browse our
      # product range". Telling somebody to set a password thirty seconds after they set
      # one reads as a broken email.
      #
      # Set in config/initializers/spree.rb.
      base.class_attribute :welcome_includes_password_link, default: true
    end

    # @param user [Spree.user_class]
    # @param reset_token [String] the RAW Devise token, not the stored hash
    # @param store [Spree::Store]
    def welcome_email(user, reset_token, store)
      @user = user
      @current_store = store
      @storefront_url = store.storefront_url.to_s.chomp('/')

      # His own copy when he has written it, ours when he has not. His welcome section is
      # the SIGN-UP email and it says so: heading "Your Account Is Awaiting Final
      # Approval", and a bullet promising a second email once approved. That is exactly
      # what this send is, so it should be his words and not ours.
      #
      # The fallback matters: on a checkout without his file, every one of these keys is
      # absent and the email has to still say something.
      his_copy = Spree.t(:heading, scope: [:user_emails, :welcome], default: '').present?
      @copy_scope = his_copy ? [:user_emails, :welcome] : nil
      @note = ''
      @contact_url = Spree.t(:contact_url, scope: [:user_emails, :common], default: @storefront_url)

      if self.class.welcome_includes_password_link
        # append_token comes from Spree::BaseMailer and uses ?token= / &token=, which is
        # the parameter name the storefront's reset page reads. Do not invent another.
        @reset_url = append_token(
          "#{@storefront_url}#{self.class.welcome_reset_path}",
          reset_token
        )
      end

      subject = if his_copy
                  Spree.t(:subject, scope: [:user_emails, :welcome], store: store.name)
                else
                  Spree.t('customer_mailer.welcome_email.subject', store: store.name)
                end

      with_store_locale(store) do
        mail(to: user.email, subject: subject, store_url: store.storefront_url)
      end
    end

    # ── the three approval outcomes ────────────────────────────────────────────
    #
    # The client settled the workflow as: approved and finished; information not right so
    # ask for more; cannot be reached or still wrong so decline. His words for the last
    # one: "not approved means: Not Approved".
    #
    # WHERE HIS COPY ACTUALLY LIVES, read out of the file he sent rather than assumed:
    #
    #   user_emails.account_approval                          the approved email
    #   user_emails.account_approval.account_not_approved      the "we need more" email
    #                                                          (NESTED inside the first,
    #                                                           which is how he wrote it)
    #   user_emails.not_approved                              does not exist
    #
    # The third has no copy because his flow does not need one: "If no reply, the account
    # stays in the declined group." So not_approved_email is wired, refuses to send while
    # its section is missing, and is therefore silent by construction. It starts working
    # the day he writes the words, with no code change.
    #
    # Every one of these passes note: AND contact_url:. Not defensively, because his file
    # requires both:
    #
    #   account_approval.body                    uses %{note}
    #   account_approval.what_bullets.3          uses %{contact_url}
    #   account_approval.account_not_approved.body  uses %{note}
    #
    # I18n raises MissingInterpolationArgument for an argument a string USES and ignores
    # ones it does not, so passing both everywhere is safe and means his wording can move
    # them between sections without a code change. He put %{note} in the APPROVED email
    # too, which was not asked for and is a good idea: it lets a welcome carry a line
    # written for that customer.

    # @param user [Spree.user_class]
    # @param store [Spree::Store]
    def approval_email(user, store)
      # Re-checked at render time, not at enqueue time, for the same reason as the
      # signup notification: this is sent with a delay, and the world can move.
      #
      # Asks for an APPROVING group, not for any group. It used to be
      # `customer_groups.reload.empty?`, which was right while every group meant approved.
      # Now that More Information and Not Approved are also groups, "has a group" would
      # let this congratulate somebody the shop had just declined.
      return unless in_approving_group?(user, store)

      deliver_outcome(user, store, [:user_emails, :account_approval])
    end

    # Asks the applicant for more about their business.
    #
    # The client named the hard part himself: "we will not know what info to ask for in a
    # template". So the shop types it into a box on the customer page and it arrives here
    # as %{note}, which his wording places inside its own sentence.
    #
    # @param user [Spree.user_class]
    # @param store [Spree::Store]
    def more_information_email(user, store)
      group = group_for_role(:more_information, store)
      return if group.nil?

      # Still the shop's decision by the time this runs. An admin who picks the wrong
      # group and fixes it inside the two minute grace sends nothing.
      return unless user.customer_groups.reload.exists?(id: group.id)

      # And the decision has not moved past it. Both of these are reachable in one save,
      # because the admin form is a single multi-select: ticking More Information and
      # Approved together fires two events, and without these guards the customer would
      # be asked for more information and congratulated seconds apart.
      declining = store.respond_to?(:declining_customer_group_ids) ? store.declining_customer_group_ids : []
      return if declining.any? && user.customer_groups.exists?(id: declining)
      return if in_approving_group?(user, store)

      deliver_outcome(user, store, [:user_emails, :account_approval, :account_not_approved])
    end

    # Tells the applicant the shop has declined the account.
    #
    # Dormant today: his file has no user_emails.not_approved section, because his flow
    # leaves an unreachable applicant sitting in the group without a further email. Kept
    # rather than deleted so that the day he writes the words, it sends.
    #
    # @param user [Spree.user_class]
    # @param store [Spree::Store]
    def not_approved_email(user, store)
      group = group_for_role(:not_approved, store)
      return if group.nil?
      return unless user.customer_groups.reload.exists?(id: group.id)

      deliver_outcome(user, store, [:user_emails, :not_approved])
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
      #
      # ANY group is correct here, and it was re-examined when More Information and Not
      # Approved arrived. Elsewhere "any group" became a bug, because those two mean not
      # approved. Here the question is different: this email exists to tell the shop that
      # somebody is waiting for a DECISION, and membership of any of the three means a
      # decision was already taken. Do not "fix" this to match the others.
      return if user.respond_to?(:customer_groups) && user.reload.customer_groups.any?

      @user = user
      @current_store = store
      # to_param, NOT id, and the show page rather than /edit. Both halves were wrong and
      # both were measured, not reasoned:
      #
      #   Spree::Admin::UsersController#find_resource is
      #     model_class.accessible_by(...).find_by_prefix_id!(params[:id])
      #
      # and find_by_prefix_id('1') returns nil, so /admin/users/1/edit rescued into a
      # redirect and landed the shop on the customer LIST. The one link whose entire job
      # is "here is the person to approve" pointed at everybody. to_param returns the
      # prefixed id (cus_UkLWZg9DAJ) because Spree::User includes Spree::PrefixedId.
      #
      # /edit is a Turbo Frame drawer opened from the show page, so requesting it directly
      # returns a bare frame rather than a usable page. The show page carries the customer,
      # their groups and the Edit button that opens that drawer.
      @customer_admin_url = "#{store.formatted_url.to_s.chomp('/')}/admin/users/#{user.to_param}"

      with_store_locale(store) do
        mail(
          to: store.new_order_notifications_email,
          subject: Spree.t('customer_mailer.store_signup_notification.subject',
                           email: user.email, store: store.name),
          store_url: store.storefront_url
        )
      end
    end

    # Private, and that is not style. ActionMailer treats every PUBLIC instance method
    # as a deliverable action, so a helper left public becomes a mailer action that can
    # be invoked and rendered.
    private

    # The one place any of the three outcome emails is actually built.
    #
    # @copy_scope is set HERE and read by the views, so the key path is defined once. The
    # earlier version repeated the scope in the mailer and again in each template, which
    # is two places to update and one place to be wrong.
    #
    # No copy, no email. Checked against the heading rather than the subject, because a
    # missing subject shows up as an obviously broken email while a missing body does not.
    # Spree.t returns a translation_missing SPAN rather than raising, so `default: ''` is
    # what makes this a real check.
    def deliver_outcome(user, store, scope)
      return if Spree.t(:heading, scope: scope, default: '').blank?

      @user = user
      @current_store = store
      @storefront_url = store.storefront_url.to_s.chomp('/')
      @copy_scope = scope
      @note = customer_note(user)
      # From his own common section, so the shop can change it without touching code.
      @contact_url = Spree.t(:contact_url, scope: [:user_emails, :common], default: @storefront_url)

      with_store_locale(store) do
        mail(
          to: user.email,
          subject: Spree.t(:subject, scope: scope, store: store.name, note: @note, contact_url: @contact_url),
          store_url: store.storefront_url
        )
      end
    end

    # The shop's note to this customer, typed on the admin form beside the customer
    # group selector. Owned by the model, see Spree::UserDecorator#approval_note, so
    # there is one definition of where it lives rather than a key repeated here.
    #
    # Read by both new emails: a decline can carry a reason as usefully as a request for
    # information can carry a question.
    #
    # @return [String] never nil, so %{note} always has something to interpolate. I18n
    #   raises MissingInterpolationArgument on a missing key.
    def customer_note(user)
      return '' unless user.respond_to?(:approval_note)

      user.approval_note
    rescue StandardError
      ''
    end

    # @return [Spree::CustomerGroup, nil]
    def group_for_role(role, store)
      return nil unless store.respond_to?(:approval_group_roles)

      id = store.approval_group_roles[role.to_s]
      return nil if id.nil?

      Spree::CustomerGroup.find_by(id: id)
    rescue StandardError
      nil
    end

    # @return [Boolean] whether the customer belongs to at least one group that grants
    #   trade pricing. Mirrors StorefrontGatingDecorator#approved_for_pricing? on
    #   purpose: if these two ever disagree, a customer is told they are approved and
    #   then shown no prices, which is worse than either answer alone.
    def in_approving_group?(user, store)
      return false unless user.respond_to?(:customer_groups)

      groups = user.customer_groups.reload

      # Not Approved wins, checked first, for the same reason as in the price gate: an
      # approving group left behind would otherwise make a declined customer look
      # approved. The comment below about mirroring the gate is only true with this here.
      declining = store.respond_to?(:declining_customer_group_ids) ? store.declining_customer_group_ids : []
      return false if declining.any? && groups.exists?(id: declining)

      excluded = store.respond_to?(:non_approving_customer_group_ids) ? store.non_approving_customer_group_ids : []
      return groups.any? if excluded.empty?

      groups.where.not(id: excluded).exists?
    rescue StandardError
      # Fail CLOSED here, unlike the price gate, and the asymmetry is deliberate. The
      # gate decides whether to SHOW something and a fault there should not black out a
      # working shop. This decides whether to SEND something, and an email wrongly
      # congratulating a declined applicant cannot be recalled.
      false
    end
  end

  CustomerMailer.prepend CustomerMailerDecorator
end
