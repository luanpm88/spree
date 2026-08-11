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
  end

  CustomerMailer.prepend CustomerMailerDecorator
end
