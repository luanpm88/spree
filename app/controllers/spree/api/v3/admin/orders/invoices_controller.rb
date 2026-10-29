module Spree
  module Api
    module V3
      module Admin
        module Orders
          # The printable invoice for one order, for the dashboard's "Print invoice"
          # action (apps/dashboard/src/actions/print-invoice-item.tsx).
          #
          # On 5.6 this was a page in the Rails admin, which Spree 6.0 removes. The
          # dashboard signs staff in with a JWT held in memory, so a plain page has no
          # session to check; the invoice comes back through the Admin API instead,
          # as the finished HTML document, and the dashboard opens it in a new window
          # for the browser to print. Same document as 5.6, same words: the shop's
          # identity and bank details come from its own wording file.
          #
          # Authorisation is the parent order's, from BaseController: :show on that
          # order, so a role that cannot see an order cannot print it either.
          class InvoicesController < BaseController
            skip_before_action :set_resource

            # GET /api/v3/admin/orders/:order_id/invoice
            def show
              store = @parent.store || current_store
              html = ActionController::Base.render(
                template: 'spree/admin_invoices/show',
                layout: false,
                assigns: { order: @parent, store: store }
              )

              render json: { number: @parent.number, html: html }
            end
          end
        end
      end
    end
  end
end
