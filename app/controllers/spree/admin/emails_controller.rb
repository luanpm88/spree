module Spree
  module Admin
    # Every email this shop can send, and what each one looks like right now,
    # built from this shop's own data.
    #
    # ── it builds, it does not send ─────────────────────────────────────────
    #
    # This is the property everything else rests on, so it is arranged rather
    # than hoped for, and `script/check_admin_emails` asserts each part.
    #
    #   1. No `ActionMailer::MessageDelivery` is ever created. That object is a
    #      Delegator, and `.deliver` on it forwards to `Mail::Message#deliver`
    #      and sends. Spree::EmailSamples#build! instantiates the mailer and
    #      calls `process`, so the object this controller holds has no
    #      `deliver_now` and no `deliver_later` on it at all.
    #   2. `perform_deliveries = false` is set on the built message, which makes
    #      `Mail::Message#do_delivery` a no-op inside the mail gem.
    #   3. The word `deliver` does not appear in this file, its views, or its
    #      helper, and the gate greps for it. A request spec alone would not
    #      catch a bad line that the happy path never runs.
    #
    # ── it sets nothing ────────────────────────────────────────────────────
    #
    # No I18n.locale, no Spree::Current.store. Each mailer action sets its own
    # from the record it is given, and a preview that arranges that itself
    # repairs the exact fault it is measuring. The 19 Aug lesson: a probe opened
    # with `I18n.locale = Spree::Store.default.default_locale`, the mailer never
    # does that, the missing locale switch was the whole bug, and three shops
    # shipped with the script calling them green. So the screen reads the store
    # and locale back OFF the built message and prints them, rather than
    # deciding them.
    #
    # ── authorisation ──────────────────────────────────────────────────────
    #
    # `authorize_admin` is OVERRIDDEN, not supplemented. The inherited one does
    # `authorize! :admin, :emails` against the bare controller symbol, which no
    # permission set in config/initializers/spree.rb grants, so adding a second
    # check underneath it leaves a screen that silently 403s the moment anyone
    # gives :manager ConfigurationManagement. Gating on the store is the same
    # door the existing "Emails" settings item beside this one already uses.
    class EmailsController < BaseController
      include Spree::Admin::SettingsConcern

      before_action :load_entry, only: %i[show preview envelope]
      before_action :no_store!

      # GET /admin/emails
      def index
        @entries = Spree::EmailCatalogue.all
        @selected ||= @entries.first
      end

      # GET /admin/emails/:id
      #
      # The same screen with one selected, so "I am looking at the shipped
      # email" is a URL that can be sent to somebody.
      def show
        @entries = Spree::EmailCatalogue.all
        @selected = @entry
        render :index
      end

      # GET /admin/emails/:id/envelope
      #
      # Subject, sender, the store and locale it was built in, and the two body
      # faults I18n does not raise on. JSON, for the bar above the frame.
      #
      # A separate request rather than meta tags injected into the preview: the
      # frame's whole claim is that it shows exactly what a customer receives,
      # and a document we have added anything to no longer shows that. It is
      # also not rendered into the list, because a subject is only known by
      # BUILDING the email, and building all 26 to draw one page would render 26
      # customers' data to answer a question about one.
      def envelope
        state = preview_state
        if state[:message].nil? || state[:empty]
          return render(json: { available: false, empty: state[:empty], note: state[:note] })
        end

        message = state[:message]
        html = part_body(message, 'html').to_s

        render json: {
          available: true,
          subject: message.subject.to_s,
          from: Array(message.from).join(', '),
          to: Array(message.to).join(', '),
          has_text: !message.text_part.nil?,
          # Read back off the message, never off what this controller intended.
          store: built_store(message),
          locale: I18n.locale.to_s,
          source: @entry.source_label,
          # I18n raises on neither of these and both print to the customer.
          # `bin/rails emails:smoke` checks them on the terminal; there is no
          # reason a screen showing the body should make somebody grep it.
          raw_bold: html.scan('**').size,
          unfilled: html.scan(/%\{[a-z_]+\}/).uniq,
          # A key the shop's locale file does not have. Found by this screen on
          # 22 Sep in the reimbursement email, on a store whose default_locale
          # is en-CA: seven of them, in the line that states the amount
          # refunded. `bin/rails emails:smoke` had built the same email and
          # called it ok, because it only looked for ** and %{}. Both now check
          # for all three.
          missing: (html + part_body(message, 'text').to_s)
                     .scan(/translation missing: ([^"<\n]+)/).flatten.uniq
        }
      rescue StandardError => e
        Rails.logger.error("[admin/emails] envelope #{@entry.key}: #{e.class}: #{e.message}")
        render json: { available: false, note: "#{e.class}: #{e.message}" }
      end

      # GET /admin/emails/:id/preview
      #
      # The rendered email itself, for the frame. `layout false` and no admin
      # chrome: whatever comes out of here is what a customer would receive, and
      # wrapping it in the admin's own HTML would be showing something else.
      #
      # It is served to a SANDBOXED iframe (see the view). This app has no CSP —
      # config/initializers/content_security_policy.rb is commented out end to
      # end — and these bodies include templates ported off the client's live
      # site. Inlined into the admin DOM, any script in one of them would run
      # with the admin's session.
      def preview
        state = preview_state
        return render_notice(state[:title], state[:note]) if state[:message].nil? || state[:empty]

        body = part_body(state[:message], params[:part])
        return render_notice(Spree.t('admin.emails.no_text_part'), Spree.t('admin.emails.no_text_part_why')) if body.nil?

        if params[:part] == 'text'
          # Plain text in a browser needs a <pre>, or the frame shows one long
          # reflowed paragraph and every line break the customer will see is
          # invisible — which is the only thing worth looking at in a text part.
          render html: text_frame(body).html_safe, layout: false
        else
          render html: body.html_safe, layout: false
        end
      rescue StandardError => e
        # A template that raises is a finding, not a 500. The screen names the
        # email and what it said, because "the emails are broken" and "this one
        # reimbursement row is broken" are very different sentences.
        Rails.logger.error("[admin/emails] #{@entry.key}: #{e.class}: #{e.message}")
        render_notice(Spree.t('admin.emails.failed'), "#{e.class}: #{e.message}")
      end

      private

      # See the note at the top of the class. Do not add a second check; replace
      # this one.
      def authorize_admin
        authorize! :admin, Spree::Store
        authorize! :update, current_store
      end

      # The body names a customer, their address and what they paid. Rails'
      # default is `max-age=0, private, must-revalidate`, which still lets a
      # shared cache hold it and still lets the ETag middleware hash one
      # customer's order.
      def no_store!
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
      end

      def load_entry
        @entry = Spree::EmailCatalogue.find(params[:id].to_s)
        return if @entry

        redirect_to spree.admin_emails_path, alert: Spree.t('admin.emails.unknown')
      end

      # The three states this screen has, worked out once for both actions.
      #
      # "Built empty" is its own state and never an ok. `Spree::BaseMailer#mail`
      # returns early when `Spree::Config[:send_core_emails]` is off, and
      # `store_signup_notification` returns early when the store has no
      # notification address; in both cases `process` swaps the message for a
      # NullMail whose body is "" and which raises nothing. Collapsing that into
      # "fine" is exactly the fault the single-part message already taught here:
      # green while the thing is gone.
      def preview_state
        sample = Spree::EmailSamples.for(@entry.key)

        if sample.nil?
          return { message: nil, title: Spree.t('admin.emails.not_wired'),
                   note: Spree.t('admin.emails.not_wired_why') }
        end

        if sample.blocked_by && (reason = sample.blocked_by.call)
          return { message: nil, title: Spree.t('admin.emails.never_sent'), note: reason }
        end

        absent = sample.missing
        if absent.any?
          return { message: nil, title: Spree.t('admin.emails.nothing_to_build_from'),
                   note: Spree.t('admin.emails.needs', records: absent.to_sentence) }
        end

        message = sample.build!
        return { message: message, empty: false } unless message.is_a?(ActionMailer::Base::NullMail)

        # Built, and came back with nothing in it. Never an ok, and never a bare
        # "empty" either: the merchant needs to know which of the two it is.
        #
        # A `search` sample already tried every recent candidate, so the answer
        # is about the customers, not the email. Anything else returned early on
        # its own terms, and the honest sentence names the two settings that do
        # that rather than guessing which one it was.
        note = if sample.search
                 Spree.t('admin.emails.nobody_qualifies',
                         count: Spree::EmailSamples::SEARCH_LIMIT, records: sample.search.first)
               else
                 Spree.t('admin.emails.returned_early')
               end
        { message: message, empty: true, title: Spree.t('admin.emails.builds_empty'), note: note }
      end

      # A single-part message has no html_part at all and its body IS the html.
      # Reading html_part without this returns nil and renders a blank frame,
      # which looks exactly like a broken template.
      def part_body(message, want)
        return '' if message.is_a?(ActionMailer::Base::NullMail)

        part = want == 'text' ? message.text_part : message.html_part
        return part.body.decoded if part
        return nil if want == 'text' && message.multipart?
        return nil if want == 'text' && message.mime_type.to_s != 'text/plain'

        message.body.decoded
      end

      def built_store(message)
        Spree::Current.store&.name || Spree::Store.default&.name
      rescue StandardError
        nil
      end

      def text_frame(body)
        "#{notice_head}<body><pre class=\"text\">#{ERB::Util.html_escape(body)}</pre></body></html>"
      end

      def render_notice(title, note)
        html = <<~HTML
          #{notice_head}
          <body><div class="box">
            <h2>#{ERB::Util.html_escape(title)}</h2>
            <p>#{ERB::Util.html_escape(note.to_s)}</p>
          </div></body></html>
        HTML
        render html: html.html_safe, layout: false, status: :ok
      end

      def notice_head
        <<~HTML
          <!doctype html><html><head><meta charset="utf-8"><style>
            body { margin:0; font: 14px/1.6 ui-sans-serif, system-ui, sans-serif; color:#374151;
                   background:#fff; }
            .box { display:flex; align-items:center; justify-content:center;
                   flex-direction:column; height:100vh; text-align:center; padding:2rem; }
            h2 { font-size:15px; font-weight:600; color:#111827; margin:0 0 .5rem; }
            p { margin:0; max-width:32rem; color:#6b7280; }
            pre.text { margin:0; padding:24px; white-space:pre-wrap; word-wrap:break-word;
                       font: 13px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace; }
          </style></head>
        HTML
      end
    end
  end
end
