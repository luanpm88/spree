module Spree
  # Spree 5.6.1 cannot send payment_link_email at all. spree_emails builds it with
  #
  #   spree.checkout_state_url(@order.token, :payment, host: store.storefront_url)
  #
  # and that route helper came from spree_storefront, whose last release is 5.4.6.
  # On 5.6 the engine has zero checkout route helpers, so the call raises
  # NoMethodError and the mail never goes out. Upstream bug, not a misconfiguration.
  #
  # The replacement points at the Next.js storefront instead, whose checkout route is
  #
  #   app/[country]/[locale]/(checkout)/checkout/[id]/page.tsx
  #
  # `[id]` is the prefixed order id (or_AXs1igzRC6), which is what `to_param` returns
  # and what the Store API accepts. The /{country}/{locale} prefix is left off on
  # purpose: the storefront middleware fills it in and preserves the query string,
  # the same way the welcome email's reset link works.
  #
  # ── one thing this cannot fix on its own ────────────────────────────────────
  #
  # The token is appended because a payment link is opened by someone who is not
  # logged in, often on a different device from the one that built the cart. The
  # storefront's checkout page currently resolves the cart from a COOKIE
  # (getCart -> getCartToken(surface)), and reads no token from the URL. Its own SDK
  # already accepts one — client.carts.get(cartId, { spreeToken }) — so the missing
  # piece is small, and account/reset-password/page.tsx already does exactly this
  # with searchParams.get("token").
  #
  # Until the checkout page reads ?token=, this link only works in the browser that
  # still holds the cart cookie. The URL is correct and carries everything needed;
  # the storefront has to pick it up. Tracked in the plan as task_payment_link_frontend.
  module OrderMailerPaymentLinkDecorator
    def self.prepended(base)
      # Overridable rather than hardcoded, so a storefront that names the route
      # differently is a one-line config change and not a patch to this file.
      #
      #   Spree::OrderMailer.checkout_path = '/pay'
      base.class_attribute :checkout_path, default: '/checkout'
    end

    def payment_link_email(order_id)
      @order = Spree::Order.incomplete.not_canceled.find(order_id)
      @current_store = @order.store

      base = "#{@current_store.storefront_url.to_s.chomp('/')}#{self.class.checkout_path}/#{@order.to_param}"
      # append_token comes from Spree::BaseMailer and picks ? or & correctly.
      @checkout_payment_url = append_token(base, @order.token)

      with_store_locale(@current_store, @order.locale) do
        mail(
          to: @order.email,
          subject: Spree.t('order_mailer.payment_link_email.subject', number: @order.number),
          store_url: @current_store.storefront_url
        )
      end
    end
  end

  OrderMailer.prepend OrderMailerPaymentLinkDecorator
end
