module Spree
  # What to hand each mailer so it can be built from THIS shop's own data.
  #
  # ── why this cannot be discovered ────────────────────────────────────────
  #
  # Nothing in a method signature says which record of which class, and guessing
  # wrong does not raise. `welcome_email(user)` on a three-argument method
  # raises and is caught in a minute; handing `confirm_email` an abandoned cart
  # does not raise, it renders, and on 24 Aug it reported two broken emails on a
  # shop whose emails were fine.
  #
  # So every argument list below was read off the method with
  # `instance_method(action).parameters` in this container, not assumed. The
  # ones that have already cost something are marked.
  #
  # ── the record is chosen by the scope the action itself uses ─────────────
  #
  # This is the part that is easy to get wrong, because three different order
  # scopes are in play and they exclude each other:
  #
  #   confirm / cancel / store_owner_notification   Spree::Order.complete
  #   payment_link_email                            Spree::Order.incomplete.not_canceled
  #                                                 — and it takes an ID, not an
  #                                                 order, and calls `.find`, so
  #                                                 a complete order raises
  #                                                 RecordNotFound
  #   shipped / reimbursement                       joins(:order)
  #
  # The join is not decoration. One reimbursement row survived the client's
  # pre-upgrade dump with its order gone, and the mailer raised
  # "store delegated to order, but order is nil" on four of seven shops. That
  # row cannot produce an email in real life either: it is orphaned data, not a
  # broken template, and the difference is the whole value of the screen.
  #
  # ── building is not sending, and that is arranged, not hoped for ─────────
  #
  # `Spree::OrderMailer.confirm_email(order)` returns an
  # `ActionMailer::MessageDelivery`, which is a `Delegator`. `.deliver` on it is
  # not a typo Ruby rejects — Delegator forwards it to `Mail::Message#deliver`
  # and it sends. `.deliver` reads like a build word. It is not.
  #
  # So no MessageDelivery is ever created here. `build!` does what
  # `MessageDelivery#processed_mailer` does, minus the proxy: instantiate the
  # mailer, `process` the action, take `#message`. The returned object has no
  # `deliver_now` and no `deliver_later` on it at all, and
  # `perform_deliveries = false` is set on it before it is handed back, so even
  # a stray `.deliver` added later is a no-op inside the mail gem.
  #
  # ── it sets nothing ──────────────────────────────────────────────────────
  #
  # No I18n.locale, no Spree::Current.store, no Mobility fallback. Every action
  # sets its own: `confirm_email` reads `@order.store` and `@order.locale`, and
  # `Spree::BaseMailer#mail` wraps the render in `with_store_locale`. A probe
  # that arranges that itself repairs the exact fault it is measuring, which is
  # the 19 Aug lesson — three shops shipped green on a script that opened with
  # `I18n.locale = Spree::Store.default.default_locale`.
  class EmailSamples
    # A token that is obviously not real, so a screenshot of a preview cannot be
    # mistaken for a working password reset link.
    PREVIEW_TOKEN = 'preview-not-a-real-token'.freeze

    # How many candidates a `search` sample will try before giving up. Bounded,
    # because this runs on a shop with real customer numbers and a screen must
    # not scan a table to draw a row.
    SEARCH_LIMIT = 25

    Sample = Struct.new(:key, :needs, :target, :blocked_by, :search, keyword_init: true) do
      # Which of the records this email needs are absent on this shop, by the
      # scope this email itself uses. Empty means it can be built.
      def missing(cache = {})
        absent = needs.filter_map do |label, finder|
          value = cache.key?(finder) ? cache[finder] : (cache[finder] = finder.call)
          label if value.nil?
        end

        # A `search` sample needs at least one candidate to try. None at all is
        # the same kind of answer as a missing record and reads the same way on
        # the row: there is nothing on this shop to build it from.
        if search
          label, finder = search
          list = cache.key?(finder) ? cache[finder] : (cache[finder] = Array(finder.call))
          absent << label if list.empty?
        end

        absent
      end

      # Builds the Mail::Message. Never delivers — see the note above.
      def build!
        records = needs.transform_values { |finder| finder.call }
        return compose(records) if search.nil?

        # ── the guard picks the record, rather than a copy of the guard ──────
        #
        # Three of this app's own emails are guarded by conditions no query can
        # express without copying them out of the mailer: approval_email asks
        # whether the customer is in an APPROVING group and has not already been
        # told, more_information_email asks that the decision has not moved past
        # it, and both read a JSON metadata column and a store preference hash.
        #
        # A copy of those conditions here would be a second implementation of
        # the shop's approval rules, in a file nobody would think to change when
        # the first one moves. So the sample is found by TRYING: build with each
        # of the most recent candidates and keep the first that actually
        # composes. It cannot drift from the guard, because it IS the guard.
        #
        # This is only safe because building has no side effects, which is
        # measured rather than assumed — see the note at the top of the file and
        # script/check_admin_emails.
        label, finder = search
        candidates = Array(finder.call).first(SEARCH_LIMIT)
        empty = nil

        candidates.each do |candidate|
          message = compose(records.merge(label => candidate))
          return message unless message.is_a?(ActionMailer::Base::NullMail)

          empty ||= message
        end

        # Nothing qualified. Hand back the empty one rather than nil, so the
        # screen says "this shop builds this empty" — which is true — instead of
        # pretending the email is broken.
        empty || compose(records.merge(label => nil))
      end

      private

      def compose(records)
        mailer_class, action, args = target.call(records)

        mailer = mailer_class.new
        mailer.process(action, *args)
        message = mailer.message
        # A real kill switch inside the mail gem, not a comment: with this
        # false, Mail::Message#do_delivery returns without touching a delivery
        # method. It does NOT stop `deliver!`/`deliver_now!`, which bypass it by
        # design, which is why the rule above is that neither exists on this
        # object in the first place.
        message.perform_deliveries = false
        message
      end
    end

    # ── the records, each by the scope its own email uses ──────────────────
    COMPLETE_ORDER = -> { Spree::Order.complete.order(:id).last }
    OPEN_ORDER     = -> { Spree::Order.incomplete.not_canceled.order(:id).last }
    SHIPMENT       = -> { Spree::Shipment.joins(:order).order(:id).last }
    REIMBURSEMENT  = -> { Spree::Reimbursement.joins(:order).order(:id).last }
    USER           = -> { Spree.user_class.order(:id).last }
    # Newest first, because a customer who has just been approved or declined is
    # the one whose email somebody is checking. Bounded by SEARCH_LIMIT at the
    # point of use.
    RECENT_CUSTOMERS = -> { Spree.user_class.order(id: :desc).limit(Spree::EmailSamples::SEARCH_LIMIT).to_a }
    ADMIN_USER     = -> { Spree.admin_user_class.order(:id).last }
    STORE          = -> { Spree::Store.default }

    # Records from models that may not be present in every Spree build. `defined?`
    # rather than a rescue, so a genuinely broken constant still raises loudly.
    def self.latest(const_name, &scope)
      lambda do
        next nil unless Object.const_defined?(const_name)

        relation = Object.const_get(const_name)
        relation = scope.call(relation) if scope
        relation.order(:id).last
      end
    end

    # ── shop settings that decide whether an email can exist at all ────────
    #
    # These duplicate a line of the mailer's own guard, and that is a trade made
    # deliberately. A customer-state guard is copied at real cost — it is the
    # shop's approval policy, it moves, and a stale copy lies — so those are
    # left to `search` below. A store setting being blank is a different animal:
    # it is one field, the merchant can fix it, and the row that says
    # "this shop has no notifications address" is worth more than a preview
    # would be. If the guard ever moves the row reads "no data yet" on an email
    # that could build, which is visible and wrong in the safe direction.
    NOTIFICATIONS_ADDRESS = lambda do
      Spree::Store.default&.new_order_notifications_email.presence
    end
    APPROVAL_ROLES = lambda do
      store = Spree::Store.default
      next nil unless store.respond_to?(:approval_group_roles)

      store.approval_group_roles.presence
    end

    EXPORT       = latest('Spree::Export')
    IMPORT       = latest('Spree::Import')
    REPORT       = latest('Spree::Report')
    INVITATION   = latest('Spree::Invitation')
    SUBSCRIBER   = latest('Spree::NewsletterSubscriber')
    WEBHOOK      = latest('Spree::WebhookEndpoint')

    # Devise renders a template for every module it ships, whether or not that
    # module is switched on. A shop with no :confirmable cannot send
    # confirmation_instructions at all, and the row saying so is worth more than
    # a preview of it would be.
    def self.devise_off(mod)
      lambda do
        next nil if Spree.user_class.devise_modules.include?(mod)

        "Devise :#{mod} is not enabled on this shop, so nothing sends this."
      end
    end

    # key => [needs, target, blocked_by]
    #
    # `target` returns [mailer class, action, args] so the caller, not this
    # table, decides how to build. `needs` labels are what the screen prints
    # when a record is missing, so they are written as a merchant would say it.
    DEFINITIONS = {
      # ── orders ──────────────────────────────────────────────────────────
      'spree/order_mailer/confirm_email' => [
        { 'a completed order' => COMPLETE_ORDER },
        ->(r) { [Spree::OrderMailer, :confirm_email, [r['a completed order']]] }
      ],
      'spree/order_mailer/cancel_email' => [
        { 'a completed order' => COMPLETE_ORDER },
        ->(r) { [Spree::OrderMailer, :cancel_email, [r['a completed order']]] }
      ],
      'spree/order_mailer/store_owner_notification_email' => [
        { 'a completed order' => COMPLETE_ORDER },
        ->(r) { [Spree::OrderMailer, :store_owner_notification_email, [r['a completed order']]] }
      ],
      # Takes an ID and calls `Spree::Order.incomplete.not_canceled.find` on it.
      # A completed order here is RecordNotFound, not a broken template.
      'spree/order_mailer/payment_link_email' => [
        { 'an order still open' => OPEN_ORDER },
        ->(r) { [Spree::OrderMailer, :payment_link_email, [r['an order still open'].id]] }
      ],

      # ── fulfilment ──────────────────────────────────────────────────────
      'spree/shipment_mailer/shipped_email' => [
        { 'a shipment' => SHIPMENT },
        ->(r) { [Spree::ShipmentMailer, :shipped_email, [r['a shipment']]] }
      ],
      'spree/reimbursement_mailer/reimbursement_email' => [
        { 'a reimbursement that still has its order' => REIMBURSEMENT },
        ->(r) { [Spree::ReimbursementMailer, :reimbursement_email, [r['a reimbursement that still has its order']]] }
      ],

      # ── customers ───────────────────────────────────────────────────────
      #
      # Three arguments, not one. The first version of the smoke task called
      # welcome_email(user) and reported a broken mailer on all five shops. A
      # false alarm is worse than no check, because it teaches people to skip
      # the output.
      'spree/customer_mailer/welcome_email' => [
        { 'a customer' => USER, 'a store' => STORE },
        ->(r) { [Spree::CustomerMailer, :welcome_email, [r['a customer'], PREVIEW_TOKEN, r['a store']]] }
      ],
      'spree/customer_mailer/password_reset_email' => [
        { 'a customer' => USER, 'a store' => STORE },
        ->(r) { [Spree::CustomerMailer, :password_reset_email, [r['a customer'], PREVIEW_TOKEN, r['a store']]] }
      ],
      # ── the shop's own approval emails ──────────────────────────────────
      #
      # These four are the wholesale flow, and all four are guarded by
      # conditions on the customer that no query expresses without copying the
      # mailer's own rules. They take the fourth argument — a candidate list to
      # try in order — rather than one record. `Spree.user_class.last` is almost
      # never the right customer for any of them, and handing them one produces
      # an empty preview of the emails the client cares about most.
      'spree/customer_mailer/approval_email' => [
        { 'a store' => STORE },
        ->(r) { [Spree::CustomerMailer, :approval_email, [r['a customer'], r['a store']]] },
        nil,
        ['a customer who has just been approved', RECENT_CUSTOMERS]
      ],
      'spree/customer_mailer/not_approved_email' => [
        { 'a store' => STORE, 'approval group set up in settings' => APPROVAL_ROLES },
        ->(r) { [Spree::CustomerMailer, :not_approved_email, [r['a customer'], r['a store']]] },
        nil,
        ['a customer who has been declined', RECENT_CUSTOMERS]
      ],
      'spree/customer_mailer/more_information_email' => [
        { 'a store' => STORE, 'approval group set up in settings' => APPROVAL_ROLES },
        ->(r) { [Spree::CustomerMailer, :more_information_email, [r['a customer'], r['a store']]] },
        nil,
        ['a customer who has been asked for more information', RECENT_CUSTOMERS]
      ],
      'spree/customer_mailer/store_signup_notification' => [
        { 'a store' => STORE, '"new order notifications" address' => NOTIFICATIONS_ADDRESS },
        ->(r) { [Spree::CustomerMailer, :store_signup_notification, [r['a customer'], r['a store']]] },
        nil,
        ['a customer awaiting approval', RECENT_CUSTOMERS]
      ],

      # ── admin users ─────────────────────────────────────────────────────
      'spree/admin_user_mailer/confirmation_email' => [
        { 'an admin user' => ADMIN_USER, 'a store' => STORE },
        ->(r) { [Spree::AdminUserMailer, :confirmation_email, [r['an admin user'], PREVIEW_TOKEN, r['a store']]] }
      ],
      'spree/admin_user_mailer/password_reset_email' => [
        { 'an admin user' => ADMIN_USER, 'a store' => STORE },
        ->(r) { [Spree::AdminUserMailer, :password_reset_email, [r['an admin user'], PREVIEW_TOKEN, r['a store']]] }
      ],

      # ── shop operations ─────────────────────────────────────────────────
      'spree/export_mailer/export_done' => [
        { 'an export' => EXPORT },
        ->(r) { [Spree::ExportMailer, :export_done, [r['an export']]] }
      ],
      'spree/import_mailer/import_done' => [
        { 'an import' => IMPORT },
        ->(r) { [Spree::ImportMailer, :import_done, [r['an import']]] }
      ],
      'spree/report_mailer/report_done' => [
        { 'a report' => REPORT },
        ->(r) { [Spree::ReportMailer, :report_done, [r['a report']]] }
      ],
      'spree/invitation_mailer/invitation_email' => [
        { 'an invitation' => INVITATION },
        ->(r) { [Spree::InvitationMailer, :invitation_email, [r['an invitation']]] }
      ],
      'spree/invitation_mailer/invitation_accepted' => [
        { 'an invitation' => INVITATION },
        ->(r) { [Spree::InvitationMailer, :invitation_accepted, [r['an invitation']]] }
      ],
      'spree/newsletter_mailer/email_confirmation' => [
        { 'a newsletter subscriber' => SUBSCRIBER },
        ->(r) { [Spree::NewsletterMailer, :email_confirmation, [r['a newsletter subscriber']]] }
      ],
      'spree/webhook_mailer/endpoint_disabled' => [
        { 'a webhook endpoint' => WEBHOOK },
        ->(r) { [Spree::WebhookMailer, :endpoint_disabled, [r['a webhook endpoint']]] }
      ],

      # ── devise ──────────────────────────────────────────────────────────
      #
      # Five templates ship; this shop has :recoverable, so one of them fires.
      # The other four are listed with the module that is off, because "we do
      # not send this" is the answer somebody is looking for when they find the
      # template and wonder why nobody receives it.
      'devise/mailer/reset_password_instructions' => [
        { 'a customer' => USER },
        ->(r) { [Devise::Mailer, :reset_password_instructions, [r['a customer'], PREVIEW_TOKEN]] }
      ],
      'devise/mailer/confirmation_instructions' => [
        { 'a customer' => USER },
        ->(r) { [Devise::Mailer, :confirmation_instructions, [r['a customer'], PREVIEW_TOKEN]] },
        devise_off(:confirmable)
      ],
      'devise/mailer/unlock_instructions' => [
        { 'a customer' => USER },
        ->(r) { [Devise::Mailer, :unlock_instructions, [r['a customer'], PREVIEW_TOKEN]] },
        devise_off(:lockable)
      ],
      'devise/mailer/email_changed' => [
        { 'a customer' => USER },
        ->(r) { [Devise::Mailer, :email_changed, [r['a customer']]] },
        devise_off(:confirmable)
      ],
      'devise/mailer/password_change' => [
        { 'a customer' => USER },
        ->(r) { [Devise::Mailer, :password_change, [r['a customer']]] }
      ]
    }.freeze

    class << self
      def for(key)
        table[key]
      end

      def table
        @table ||= DEFINITIONS.each_with_object({}) do |(key, (needs, target, blocked_by, search)), out|
          out[key] = Sample.new(key: key, needs: needs, target: target,
                                blocked_by: blocked_by, search: search)
        end
      end

      def reset!
        @table = nil
      end
    end
  end
end
