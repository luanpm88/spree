module Spree
  module Admin
    # A printable invoice for one order.
    #
    # ── why this is a build and not an install ────────────────────────────────
    #
    # The client asked to "install" invoice printing. There is nothing to install.
    # spree_print_invoice pins spree_core ~> 2.0, spree_invoice is the same era, and
    # spree_admin 5.6.1 ships no invoice view, controller or route of its own. Checked all
    # three before writing a line.
    #
    # ── why no PDF gem ───────────────────────────────────────────────────────
    #
    # There is no PDF renderer in the bundle, and every candidate costs something real on a
    # shared box: wicked_pdf needs the wkhtmltopdf binary, grover needs Node and a headless
    # Chrome inside the web image, prawn needs the whole layout rebuilt in Ruby and would
    # never match his brand.
    #
    # So this renders a print-ready HTML document and lets the browser produce the PDF,
    # which every browser does natively and well. That is a real PDF, keeps the image the
    # size it is, and styles with CSS rather than coordinates.
    #
    # It does NOT give a downloadable .pdf FILE from a button, which matters if he ever
    # wants to attach one to an email automatically. That needs a renderer and is a
    # separate decision, deliberately not taken here. Said out loud rather than left for
    # him to discover.
    #
    # ── authorisation ────────────────────────────────────────────────────────
    #
    # BaseController already answers "is this an admin". This also asks "may this admin see
    # THIS order", because the shop has read-only and catalogue-only roles: :support and
    # :catalog exist in config/initializers/spree.rb and a catalogue clerk has no business
    # printing a customer's invoice.
    class InvoicesController < BaseController
      layout false

      def show
        @order = Spree::Order.includes(
          :line_items, :adjustments, :payments, :ship_address, :bill_address
        ).find_by_prefix_id!(params[:order_id])

        authorize! :show, @order

        @store = @order.store || Spree::Store.default
      end
    end
  end
end
