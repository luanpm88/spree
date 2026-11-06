# Draft Orders: which unfinished orders have already been paid.
#
# On 5 Nov a customer's paid order sat in Draft Orders for two months, among
# dozens of abandoned carts, and the only way to tell it apart was to open it.
# A PayPal fault (fixed 4 Nov) let a customer pay before giving an address, so
# the money was taken and the order never finished. The client asked for a way
# to check this from the shop, and none of the filters could: an unfinished
# order has payment_state NULL whether it was paid or not, because Spree only
# works payment_state out when the order completes. Measured on all seven shops
# on 6 Nov: the one paid draft and the 52 unpaid ones on that shop all read NULL.
#
# So the column reads the payments themselves. A draft with a completed payment
# shows "Paid" and the amount; every other row is blank, so a paid one stands out
# on the page. The same column is a filter in the list's own filter menu
# (Payment is Paid), through the `payments` association Spree::OrderDecorator
# adds to the ransack whitelist.
#
# The list preloads associations lazily, so reading each row's payments is one
# query for the page, not one per row.
#
# Added the way spree_admin's own tables initializer says to extend it.
Rails.application.config.after_initialize do
  Spree.admin.tables.checkouts.add :payment,
                                   label: :payment,
                                   type: :custom,
                                   filter_type: :select,
                                   sortable: false,
                                   filterable: true,
                                   default: true,
                                   position: 45,
                                   partial: 'spree/admin/tables/columns/checkout_payment',
                                   ransack_attribute: 'payments_state',
                                   operators: %i[eq not_eq],
                                   value_options: lambda {
                                     [
                                       { value: 'completed', label: I18n.t('spree.payment_states.paid', default: 'Paid') },
                                       { value: 'pending', label: I18n.t('spree.payment_states.pending', default: 'Pending') },
                                       { value: 'failed', label: I18n.t('spree.payment_states.failed', default: 'Failed') }
                                     ]
                                   },
                                   method: ->(order) { order.payments.select(&:completed?).sum(&:amount) }
end
