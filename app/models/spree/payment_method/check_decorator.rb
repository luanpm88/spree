module Spree
  class PaymentMethod
    # Gives the offline payment method an editable instructions box again.
    #
    # ── why ───────────────────────────────────────────────────────────────────
    #
    # The shops being migrated run bank transfer on this method, and the wording that
    # tells a customer where to send the money lived in spree_payment_methods.instructions.
    # 5.6.1 has no instructions column and its payment method form offers only name,
    # display_on, auto_capture and active. So a shop that upgrades keeps the text in the
    # database and loses both the display and any way to change it.
    #
    # rehearsal:carry_payment_instructions moves the text into :description, which is
    # what Spree::Api::V3::PaymentMethodSerializer publishes to a storefront. This puts
    # the matching editor back in the admin, through the hook 5.6.1 already provides:
    # _form.html.erb renders custom_form_fields/<name> for any payment method that
    # answers custom_form_fields_partial_name. No gem file is touched.
    #
    # ── why a plain textarea and not the rich editor ──────────────────────────
    #
    # f.spree_rich_text_area is Action Text: it calls Rails' rich_text_area, which needs
    # has_rich_text on the attribute. description here is an ordinary :text column, and
    # adding Action Text would put the content somewhere the API serializer does not read.
    # So the box takes HTML directly. That matches what is already stored, which is HTML
    # written in the old shop's editor.
    module CheckDecorator
      def custom_form_fields_partial_name
        'check'
      end
    end

    Check.prepend CheckDecorator
  end
end
