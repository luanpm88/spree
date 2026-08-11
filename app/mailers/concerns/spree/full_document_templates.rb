module Spree
  # The client's email templates are complete HTML documents: their own <!DOCTYPE>, a
  # <head> carrying the Outlook conditional comments and MSO styles, and a <body>.
  # Spree's mailer layout (layouts/spree/base_mailer.html.erb) is also a complete
  # document and wraps the view in its own header, footer and stylesheet partials.
  #
  # Rendered one inside the other you get nested <html> elements. Gmail and Outlook both
  # strip the inner document, which silently discards the entire design and leaves
  # Spree's default chrome. The email arrives, it looks plausible, and it is wrong.
  #
  # So: no layout for a view that is already a whole document, Spree's layout for
  # everything else.
  #
  # Decided by looking at the file rather than by listing action names, because there
  # are three kinds of view in play and only one of them wants the layout skipped:
  #
  #   1. Spree's own views                  fragments  -> layout
  #   2. our welcome_email                  fragment   -> layout
  #   3. the client's ported templates      documents  -> no layout
  #
  # An earlier version tested only whether an override file existed. That was wrong for
  # case 2: our own welcome_email is an override AND wants the layout, so it would have
  # gone out as a bare unstyled fragment. Testing for <html> tells the three apart with
  # no list to keep in sync.
  #
  # It also matters that the client's templates are NOT in this repository — it is
  # public and they are his. On a checkout without them every mailer falls back to
  # Spree's views and Spree's layout, which is exactly right.
  module FullDocumentTemplates
    extend ActiveSupport::Concern

    included do
      layout -> { Spree::FullDocumentTemplates.full_document?(self.class, action_name) ? false : 'spree/base_mailer' }
    end

    class << self
      # Spree::OrderMailer#confirm_email -> app/views/spree/order_mailer/confirm_email.html.erb
      def full_document?(mailer_class, action)
        return false if action.blank?

        dir = mailer_class.name.demodulize.underscore
        path = Rails.root.join('app/views/spree', dir, "#{action}.html.erb")

        # Cached because this runs on every delivery, but never in development, where
        # the whole point is that editing a template takes effect without a restart.
        if Rails.application.config.cache_classes
          cache[path.to_s] = detect(path) unless cache.key?(path.to_s)
          cache[path.to_s]
        else
          detect(path)
        end
      end

      private

      def cache
        @cache ||= {}
      end

      # Reads the head of the file only. These templates are ~30 KB each and the marker
      # is always in the first few lines.
      def detect(path)
        return false unless path.exist?

        File.open(path) { |f| f.read(600) }.to_s.match?(/<html[\s>]/i)
      rescue SystemCallError
        false
      end
    end
  end
end
