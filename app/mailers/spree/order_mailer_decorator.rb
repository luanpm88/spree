module Spree
  # the client's email templates are complete HTML documents: their own <!DOCTYPE>,
  # <head> with the Outlook conditional comments and MSO styles, and <body>. Spree's
  # own mailer layout (layouts/spree/base_mailer.html.erb) is also a complete document
  # and wraps the view in its header, footer and stylesheet partials.
  #
  # Rendering one inside the other produces nested <html> elements. Gmail and Outlook
  # both strip the inner document, which silently discards the entire design and leaves
  # Spree's default chrome — the email arrives, looks plausible, and is wrong.
  #
  # So: no layout for the actions whose views the client supplies. Everything else keeps
  # Spree's layout, which matters because Spree ships more mailers than these
  # (invitations, exports, reports) and those have no the client design.
  #
  # A decorator is the right tool here despite the usual preference against them. This
  # is a structural change to how the class renders, not a callback or a side effect,
  # and ActionMailer resolves `layout` on the class rather than through any injectable
  # service.
  module OrderMailerDecorator
    # Add an action here only once a full-document template exists for it in
    # app/views/spree/order_mailer/. A name listed without a matching view falls back
    # to Spree's stock view, which then renders with no layout at all — a bare
    # fragment with no <html> and no styles.
    #
    # A method rather than a constant: Rails reloads this file on every change in
    # development, and re-assigning a constant on reload emits an "already initialized
    # constant" warning on every request.
    def self.client_templates
      %w[confirm_email]
    end

    # The client's templates are NOT in this repository — it is public, and the designs
    # are his. So decide by looking for the file rather than by name alone: on a
    # checkout without them, Spree's own views must keep Spree's own layout, or every
    # order email goes out as a bare unstyled fragment.
    def self.override_present?(action)
      Rails.root.join('app/views/spree/order_mailer', "#{action}.html.erb").exist?
    end

    def self.prepended(base)
      base.layout lambda {
        d = Spree::OrderMailerDecorator
        d.client_templates.include?(action_name) && d.override_present?(action_name) ? false : 'spree/base_mailer'
      }
    end
  end

  OrderMailer.prepend OrderMailerDecorator
end
