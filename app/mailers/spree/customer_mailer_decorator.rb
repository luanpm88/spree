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

    # @param user [Spree.customer_class]
    # @param reset_token [String] from generate_token_for(:password_reset)
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
      # ── every lookup inside the store's locale, not only the render ──────────
      #
      # with_store_locale was already here, around mail() alone. That renders the
      # BODY in the shop's locale and leaves every decision above it at the
      # default one, which is where this went wrong.
      #
      # Measured on Canada, whose wording lives under en-CA:
      #
      #     store.default_locale      en-CA
      #     I18n.locale in the mailer en
      #     welcome_message at en     (absent)
      #     welcome_message at en-CA  <the shop's own welcome heading>
      #
      # So his_copy came out false, @copy_scope was nil, and the shop sent our
      # generic wording while his own sat one locale away. The subject fell to
      # Spree's default the same way. Canada, Australia and New Zealand all did
      # this; the United States and nolocal did not, and only because their
      # wording happens to sit under plain en.
      #
      # It was hidden until this morning: one brand file supplied every key under
      # plain en, so there was always something to find. Removing it uncovered it.
      #
      # with_store_locale, not I18n.with_locale: Spree's version also sets the
      # Mobility fallbacks for the store, and a locale switch without them reads
      # translated records differently.
      with_store_locale(store) do
        # Two vocabularies, both his. His COMMERCIAL file names the heading `heading`;
        # his RETAIL files name it `welcome_message`. Same role, different word, and
        # the difference is not cosmetic: this line decides whether his copy is used
        # at all.
        #
        # Checking only `heading` meant every retail shop failed this test and fell
        # back to ours. It did not look that way, because one brand's file sat in
        # config/locales and was read by every shop on the box, so retail borrowed
        # the commercial heading and shipped it: "Your Account Is Awaiting Final
        # Approval", to customers of a retail shop who have no approval step.
        his_copy = [
          Spree.t(:heading, scope: [:user_emails, :welcome], default: ''),
          Spree.t(:welcome_message, scope: [:user_emails, :welcome], default: '')
        ].any?(&:present?)
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
    #   user_emails.account_not_approved                      the "we need more" email
    #                                                          (it was nested inside the
    #                                                           first until 19 Aug, when
    #                                                           he moved it up a level)
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
    #   account_not_approved.body                uses %{note}
    #
    # I18n raises MissingInterpolationArgument for an argument a string USES and ignores
    # ones it does not, so passing both everywhere is safe and means his wording can move
    # them between sections without a code change. He put %{note} in the APPROVED email
    # too, which was not asked for and is a good idea: it lets a welcome carry a line
    # written for that customer.

    # @param user [Spree.customer_class]
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
      return deliver_outcome(user, store, [:user_emails, :account_approval]) unless user.respond_to?(:mark_approval_notified!)

      # Told once, and the check, the build and the mark happen under a lock on the
      # customer row, because "once" failed without it. Measured on the 6.0 copy, 28 Oct:
      # three approval jobs fell due in the same second, from one new membership and two
      # edits to the customer, and the customer received the approval email twice. Each
      # job read "not told yet" before either wrote the marker.
      #
      # Two jobs at once is the normal case, not a corner: the subscriber enqueues on
      # customer_group_user.created AND on user.updated, both with the same two minute
      # grace, so approving somebody and editing them in the same sitting (typing the
      # note, fixing a name) queues two.
      #
      # with_lock reloads the row FOR UPDATE, so the second job waits for the first to
      # commit and then sees the marker. Only the build happens inside; the SMTP send is
      # ActionMailer's, after this action returns, so the lock is held for milliseconds.
      message = nil
      user.with_lock do
        next if user.approval_notified?

        message = deliver_outcome(user, store, [:user_emails, :account_approval])

        # Marked here, past every guard, and NOT at enqueue time. Marking on enqueue is
        # what the old ordering test effectively did, and it is why a withheld approval
        # could never be recovered: the shop looked told when nothing had been sent. If
        # the SMTP delivery itself then fails the mail is lost, which is the same exposure
        # every other mailer here has and strictly better than losing it silently forever.
        user.mark_approval_notified! if message.present?
      end
      message
    end

    # Asks the applicant for more about their business.
    #
    # The client named the hard part himself: "we will not know what info to ask for in a
    # template". So the shop types it into a box on the customer page and it arrives here
    # as %{note}, which his wording places inside its own sentence.
    #
    # @param user [Spree.customer_class]
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

      # Two levels, not three. He moved this section up a level in the file he sent
      # on 19 Aug, and a scope that names a level his file no longer has resolves
      # to nothing: the email would send with an empty heading and an empty body,
      # because I18n's default is the empty string here rather than an error.
      # Only the commercial shop has this section at all, so nothing else moves.
      deliver_outcome(user, store, [:user_emails, :account_not_approved])
    end

    # Tells the applicant the shop has declined the account.
    #
    # Dormant today: his file has no user_emails.not_approved section, because his flow
    # leaves an unreachable applicant sitting in the group without a further email. Kept
    # rather than deleted so that the day he writes the words, it sends.
    #
    # @param user [Spree.customer_class]
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
    # @param user [Spree.customer_class] the customer who just signed up
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

      # A shop that does not do approvals must not announce that somebody is
      # waiting for approval.
      #
      # This was missing, and it reached the client as a real mail from a RETAIL
      # shop. His words: "I just got an email for a new retail customer who signed
      # up in AU shop. It states: Someone has signed up and is waiting for approval.
      # This email and its message is only for the [wholesale shops], no retail shop
      # should have this message for customer or admin."
      #
      # The two guards that were here are both true on a retail shop: it has a
      # notifications address like every shop, and a retail customer belongs to no
      # group. So every retail signup announced itself.
      #
      # ── the first fix inferred it, and he caught that too ─────────────────────
      #
      # It asked whether the shop had any customer groups, on the reasoning that
      # approval here IS a customer group. Measured and true at the time: the
      # wholesale shop had 3 and every retail shop had 0.
      #
      # He replied before it could bite:
      #
      #   "I can see us using the customer groups for things like VIP, Loyalty,
      #    Staff, etc which would trigger the email, or have you setup a
      #    customer_approval_required = true / false?"
      #
      # He is right, and it is worth being plain about why. A group is how an
      # approval is RECORDED. It is not what decides whether a shop does approvals
      # at all, and the day a retail shop gets a VIP group it would have started
      # announcing every retail signup again: the exact fault he had just reported.
      #
      # So it is declared per shop in config/approval_shops and nothing is inferred.
      # A shop that is not listed sends nothing, which is the safe direction: the
      # failure of a missing line is a wholesale shop that stays quiet, and the
      # failure of a wrong inference is a retail customer's signup announced to him.
      return unless Spree::ApprovalShops.required?

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
      # The customer's page in the 6.0 dashboard, which replaced the Rails admin this
      # used to point at (/admin/users/:id, a 404 on 6.0).
      #
      # The route, read out of the dashboard bundle Spree 6.0.0 ships:
      #
      #   /_authenticated/$storeId/customers/$customerId
      #
      # Prefixed ids for both, never raw ones: the dashboard takes its ids from the Admin
      # API, which only ever gives prefixed ones (store_…, cust_…). prefixed_id, not
      # to_param, because Spree::Store#to_param is the raw id (measured: "1"). On 5.6 a
      # raw id in this link landed the shop on the customer LIST instead of the person
      # to approve, which is the one thing this link exists for.
      #
      # DashboardUrl rather than store.formatted_url + '/dashboard', because it is what
      # Spree's own staff emails use and it honours SPREE_DASHBOARD_URL when the
      # dashboard is served from somewhere else.
      @customer_admin_url = "#{Spree::Stores::DashboardUrl.call(store: store).to_s.chomp('/')}/#{store.prefixed_id}/customers/#{user.prefixed_id}"

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
      # The whole method inside the store's locale, including the guard.
      #
      # The guard used to sit outside it, so on a shop whose wording lives under a
      # regional root (en-CA, en-AU, en-NZ) the heading read as blank and the
      # email silently did not send. Silently is the point: no error, no log, and
      # the customer simply never hears back about their account.
      #
      # `next`, not `return`: this is a block. It leaves the block without
      # calling mail, which is what the guard has always meant.
      with_store_locale(store) do
        next if Spree.t(:heading, scope: scope, default: '').blank?

        @user = user
        @current_store = store
        @storefront_url = store.storefront_url.to_s.chomp('/')
        @copy_scope = scope
        @note = customer_note(user)
        # From his own common section, so the shop can change it without touching code.
        @contact_url = Spree.t(:contact_url, scope: [:user_emails, :common], default: @storefront_url)

        mail(
          to: user.email,
          subject: Spree.t(:subject, scope: scope, store: store.name, note: @note, contact_url: @contact_url),
          store_url: store.storefront_url
        )
      end
    end

    # The shop's note to this customer, typed on the admin form beside the customer
    # group selector. Owned by the model, see Spree::CustomerDecorator#approval_note, so
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
