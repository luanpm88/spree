module Spree
  # Renders the client's numbered lists, and interpolates them.
  #
  # ── the bug this exists for ────────────────────────────────────────────────
  #
  # I18n interpolates a lookup that returns a STRING. It does NOT interpolate the strings
  # inside a lookup that returns a HASH. Measured on the running shop:
  #
  #   Spree.t(:what_bullets, scope: [...], contact_url: 'https://X')[3]
  #   => "please use our <a href='%{contact_url}'><strong>contact form</strong></a>."
  #
  # The client writes his bullet lists as numbered hashes, 0/1/2/3, so the order is
  # explicit rather than left to YAML array handling. One bullet in his approval email
  # carries %{contact_url}. Rendered through a plain hash lookup the customer receives a
  # literal %{contact_url} inside an href: a broken link, in the email that tells a new
  # trade customer they are approved.
  #
  # ── why this is a helper wired in explicitly ──────────────────────────────
  #
  # An earlier version prepended Spree::MailHelper, on the assumption that mailer views
  # could see it. They cannot: Spree::CustomerMailer._helpers carries neither store_logo
  # nor variant_image_url, so that module is not a helper on this mailer at all. Checked,
  # after the prepend produced "undefined method email_lines" at render time.
  #
  # ── why unknown tokens are left in place rather than blanked ──────────────
  #
  # Substituting an unknown token with '' hides the mistake and ships a sentence with a
  # hole in it. Leaving the token makes it survive into the render assertions, which check
  # that no email body contains "%{" anywhere. So a missing argument fails in testing
  # instead of arriving quietly in somebody's inbox.
  module ApprovalMailHelper
    # @param key [Symbol] e.g. :what_bullets
    # @param scope [Array<Symbol>] e.g. [:user_emails, :account_approval]
    # @param args [Hash] interpolation values
    # @return [Array<String>] the lines, in the client's numbered order, interpolated
    def email_lines(key, scope:, **args)
      value = Spree.t(key, scope: scope, default: {})

      # sort_by the integer of the key, so a tenth bullet lands after the ninth. String
      # order would put 10 between 1 and 2.
      lines = if value.is_a?(Hash)
                value.sort_by { |k, _| k.to_s.to_i }.map(&:last)
              else
                Array(value)
              end

      lines.map { |line| interpolate_email_string(line.to_s, args) }
    end

    # @param string [String]
    # @param args [Hash]
    # @return [String] with %{known} replaced and %{unknown} deliberately left alone
    def interpolate_email_string(string, args)
      return string if args.blank?

      string.gsub(/%\{(\w+)\}/) do
        name = Regexp.last_match(1).to_sym
        args.key?(name) ? args[name].to_s : Regexp.last_match(0)
      end
    end
  end
end
