# Build every transactional email this shop can send, and say which ones break.
#
#   bin/rails emails:smoke
#
# ── why this exists ──────────────────────────────────────────────────────────
#
# The client asked "does the reimbursement email work or not? I can't remember",
# and nobody could answer it, because nothing had ever built one. Eleven
# templates were ported and their rendering was checked by eye against a design;
# whether the mailer could assemble them against this shop's own data was never
# tested at all.
#
# The first run answered it. The reimbursement mailer raised
#
#     ActiveSupport::DelegationError: store delegated to order, but order is nil
#
# on four of five shops, because each carries one reimbursement row pointing at
# an order that does not exist. That row is not ours: it is in his own
# pre-upgrade dump, alongside an empty customer returns table and orders whose
# ids start at 92, so it was already dangling before anything was migrated.
#
# ── it renders, it does not send ─────────────────────────────────────────────
#
# Every mail is BUILT and thrown away. Nothing is delivered, so this is safe to
# run against a shop carrying real customer addresses. The distinction matters:
# a template that renders can still fail to deliver, and delivery is a separate
# question this deliberately does not answer.
#
# A template that raises is reported with the record it was given, because "the
# reimbursement email is broken" and "this one reimbursement row is broken" are
# very different sentences to send to a client.
require 'fileutils'

namespace :emails do
  desc 'Build every transactional email against this shop and report failures'
  task smoke: :environment do
    # A COMPLETE order, and nothing else. The fallback to Order.last was there so
    # a shop with no orders still had something to build from, and on 24 August
    # that fallback handed the confirmation mailer an abandoned cart: state
    # "cart", no addresses, no email address. The mailer raised
    # `undefined method 'full_name' for nil` and the run reported two failures on
    # a shop whose emails are fine.
    #
    # Measured before changing it, because "the probe is wrong" is a convenient
    # thing to believe: across all seven shops, complete orders with no
    # ship_address or no bill_address came to zero. So no real order reaches that
    # code path, and the failure was manufactured here.
    #
    # A shop with no completed orders now SKIPS, and says so. A gate that fails
    # on a shop that has simply never sold anything is a gate people re-run until
    # it is green, which is the same as not having it.
    order = Spree::Order.complete.order(:id).last
    shipment = Spree::Shipment.joins(:order).order(:id).last

    # Only a reimbursement whose order still exists. `Spree::Reimbursement#1`
    # survived his pre-upgrade dump with its order gone, so the mailer raised
    # ActiveSupport::DelegationError on four shops: "store delegated to order,
    # but order is nil". That row cannot generate an email in real life either,
    # because there is no order to reimburse. It is orphaned data, not a broken
    # template, and reporting it as a failed email sends the client looking at
    # the wrong thing.
    reimbursement = Spree::Reimbursement.joins(:order).order(:id).last
    user = Spree.user_class.order(:id).last

    cases = [
      ['order_mailer.confirm_email',        -> { Spree::OrderMailer.confirm_email(order) },                order],
      ['order_mailer.cancel_email',         -> { Spree::OrderMailer.cancel_email(order) },                 order],
      ['order_mailer.store_owner_notification', -> { Spree::OrderMailer.store_owner_notification_email(order) }, order],
      ['shipment_mailer.shipped_email',     -> { Spree::ShipmentMailer.shipped_email(shipment) },          shipment],
      ['reimbursement_mailer.reimbursement', -> { Spree::ReimbursementMailer.reimbursement_email(reimbursement) }, reimbursement],
    ]

    # welcome_email(user, reset_token, store), not welcome_email(user). Getting
    # this wrong made the smoke test report a broken mailer on all five shops,
    # which is the failure mode a smoke test must not have: a false alarm trains
    # people to skip the output. The signature was read off the method rather
    # than assumed the second time.
    if user
      cases << [
        'customer_mailer.welcome',
        -> { Spree::CustomerMailer.welcome_email(user, 'smoke-test-token', Spree::Store.default) },
        user
      ]
      cases << [
        'customer_mailer.password_reset',
        -> { Spree::CustomerMailer.password_reset_email(user, 'smoke-test-token', Spree::Store.default) },
        user
      ]
    end

    # DUMP=/tmp/emails writes each rendered email out as a file. The client asked
    # whether an email works; a table of green ticks is an assertion, and the
    # email itself is evidence. Written only when asked for, so the ordinary run
    # stays a check rather than a generator.
    dump = ENV['DUMP']
    FileUtils.mkdir_p(dump) if dump

    ok = 0
    failures = []

    cases.each do |name, build, record|
      if record.nil?
        puts format('  SKIP  %-42s nothing on this shop to build it from', name)
        next
      end

      begin
        mail = build.call
        html = mail.html_part ? mail.html_part.body.to_s : mail.body.to_s
        text = mail.text_part ? mail.text_part.body.to_s : ''
        raw = html.scan(/\*\*/).length

        # A placeholder the template never filled in. I18n does NOT raise for
        # this and nothing logs it: the mail builds, the subject is right, and
        # `%{number}` is printed to the customer as those eight characters.
        #
        # It happens because each shop wrote its own locale file for its own
        # templates. Two of them use `order_number` as a heading, "Order #
        # %{number}", where the others use it as a field label, "Order/Invoice
        # #:". Same key, different shape, and only one of the two shapes has a
        # number to interpolate here.
        #
        # Checked on the rendered body rather than on the locale files, because
        # the body is the thing the customer reads and it does not matter which
        # of eleven templates or four scopes the placeholder came from.
        unfilled = (html + text).scan(/%\{[a-z_]+\}/).uniq

        if html.strip.empty?
          failures << [name, 'rendered an empty body']
          puts format('  FAIL  %-42s empty body', name)
        elsif raw.positive?
          failures << [name, "#{raw} raw ** markers in the html"]
          puts format('  FAIL  %-42s %d raw markers', name, raw)
        elsif unfilled.any?
          failures << [name, "unfilled placeholder(s) printed to the customer: #{unfilled.join(' ')}"]
          puts format('  FAIL  %-42s unfilled %s', name, unfilled.join(' '))
        else
          ok += 1
          if dump
            base = File.join(dump, name.tr('.', '_'))
            File.write("#{base}.html", html)
            File.write("#{base}.txt", text) unless text.empty?
          end
          puts format('  ok    %-42s html %d B, text %d B', name, html.length, text.length)
        end
      rescue StandardError => e
        failures << [name, "#{e.class}: #{e.message[0, 120]}"]
        puts format('  FAIL  %-42s %s', name, "#{e.class}: #{e.message[0, 90]}")
        puts format('        given %s', record.class.name + '#' + record.id.to_s)
      end
    end

    puts
    puts "  #{ok} built, #{failures.length} failed"
    failures.each { |n, why| puts "    #{n}: #{why}" }
    exit(1) if failures.any?
  end
end
