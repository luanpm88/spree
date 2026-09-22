module Spree
  module Admin
    module EmailsHelper
      # Four states, and each one is a different sentence for the merchant.
      #
      #   :ready      a record exists that this email can be built from
      #   :no_record  the shop has nothing to build it from yet — not a fault.
      #               A shop that has never sold anything has no completed
      #               order, and a gate that fails on that is a gate people
      #               re-run until it is green, which is the same as not having
      #               one
      #   :never      the shop cannot send this at all, because the module
      #               behind it is switched off
      #   :unknown    nobody has written down what to hand this mailer yet. It
      #               is our gap, not the shop's, and it says so
      #
      # There is deliberately no state for "template with no method": that is
      # unreachable, because EmailCatalogue only lists a template whose action
      # is in the mailer's action_methods. Measured on this app: 26 templates,
      # 26 methods, no orphan either way.
      STATUS_BADGE = {
        ready: 'badge-active',
        no_record: 'badge-light',
        never: 'badge-inactive',
        unknown: 'badge-warning'
      }.freeze

      # The record lookups are shared across rows — nine distinct queries back
      # 26 rows — so they are resolved once per request. Without this the list
      # runs `Spree::Order.complete.order(:id).last` four times for the four
      # order emails alone.
      def email_record_cache
        @email_record_cache ||= {}
      end

      def email_state(entry)
        sample = Spree::EmailSamples.for(entry.key)
        return [:unknown, Spree.t('admin.emails.not_wired_why')] if sample.nil?

        if sample.blocked_by && (reason = sample.blocked_by.call)
          return [:never, reason]
        end

        # The same method the preview uses, sharing one cache across the 26
        # rows. Asking the sample twice in two different ways is how a list and
        # the thing it lists start disagreeing.
        absent = sample.missing(email_record_cache)
        return [:no_record, Spree.t('admin.emails.needs', records: absent.to_sentence)] if absent.any?

        [:ready, nil]
      end

      def email_status_badge(status)
        tag.span(Spree.t("admin.emails.status.#{status}"),
                 class: "badge #{STATUS_BADGE.fetch(status, 'badge-light')}")
      end
    end
  end
end
