module Spree
  # The email for a cart that was started and never finished, from his
  # "Incomplete Order" design of 19 August.
  #
  # ── what this is and is not ──────────────────────────────────────────────────
  #
  # This is the MAILER only. Nothing calls it yet, and that is deliberate.
  #
  # Spree 5.6.1 has no abandoned cart mailer, no view and no job: checked across
  # the whole bundle on 25 August and there is not one file mentioning it. So the
  # feature is three parts, not one, and only the first two are ours to decide:
  #
  #   1. a mailer action        this file
  #   2. a template            app/views/shops/<shop>/.../incomplete_order_email
  #   3. something that fires it, after some delay, once per cart
  #
  # The third is his call and not a technical one. How long to wait, whether it
  # sends once or three times, and above all whether he is content to email
  # people who left a cart without asking them first, which in several of the
  # countries these shops sell to is treated as marketing.
  #
  # Built now anyway so it can be previewed and reviewed rather than described.
  # Wiring it to a schedule is a five line job once he has answered.
  #
  # ── the link ─────────────────────────────────────────────────────────────────
  #
  # It returns to CHECKOUT with the order token, not to /cart. A bare /cart link
  # shows an empty cart to anybody who opens the mail on a different device from
  # the one they shopped on, which is most people reading email. The token is
  # what makes the order theirs again, and append_token comes from
  # Spree::BaseMailer, which picks ? or & correctly.
  module OrderMailerIncompleteOrderDecorator
    def incomplete_order_email(order_id)
      @order = Spree::Order.incomplete.not_canceled.find(order_id)
      @current_store = @order.store

      base = "#{@current_store.storefront_url.to_s.chomp('/')}#{self.class.checkout_path}/#{@order.to_param}"
      @checkout_payment_url = append_token(base, @order.token)

      with_store_locale(@current_store, @order.locale) do
        mail(
          to: @order.email,
          subject: Spree.t(:subject, scope: [:user_emails, :incomplete_order],
                                     default: Spree.t('order_mailer.confirm_email.subject', number: @order.number)),
          store_url: @current_store.storefront_url
        )
      end
    end
  end

  OrderMailer.prepend OrderMailerIncompleteOrderDecorator
end
