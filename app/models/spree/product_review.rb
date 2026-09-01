module Spree
  # The reviews his customers already wrote.
  #
  # ── why a model of our own and not spree_product_reviews ────────────────────
  #
  # Every one of his dumps carries a populated spree_product_reviews table: the
  # rows came across with the rest of his data on the first cutover. What did not
  # come across is anything that reads them, because Spree 5.6 has no reviews of
  # its own and the extension that wrote them is not installed here.
  #
  # Installing spree_product_reviews 1.2.0 would give the model and the admin
  # screens, and two things argue against it right now. Its views target the Rails
  # storefront, which does not exist on 5.6, so the half that matters to a
  # customer would still have to be written in Next. And it pulls in
  # spree_auth_devise 4.6.3, a Spree 4 gem this app does not otherwise use, which
  # would need testing before it goes near a shop that is taking orders today.
  #
  # This is additive: a model over a table that is already there, and a read-only
  # endpoint beside it. Nothing in Spree changes, no gem is added, and the seven
  # shops keep running the image they are running. If the extension is adopted
  # later it can take this over.
  #
  # ── the columns, read off his own table ─────────────────────────────────────
  #
  #   id, product_id, user_id, variant_id, rating, title, review, product_name,
  #   purchase_date, ip_address, locale, approved, show_identifier, created_at,
  #   updated_at, spam
  #
  # `show_identifier` is his: false means the reviewer did not want their name
  # shown, so the API must not send it. `spam` and `approved` are both gates and
  # both are checked, because a row can be approved and later marked spam.
  class ProductReview < Spree::Base
    self.table_name = 'spree_product_reviews'

    belongs_to :product, class_name: 'Spree::Product', optional: true
    belongs_to :user, class_name: Spree.user_class.to_s, optional: true

    # Only what a visitor may see. Ordered newest first, which is how his old shop
    # showed them.
    scope :visible, -> { where(approved: true).where('spam IS NOT TRUE').order(created_at: :desc) }

    # The name to print, or nil.
    #
    # Nil rather than "Anonymous": what a shop calls an unnamed reviewer is
    # wording, and wording belongs in the storefront's own file with the rest of
    # his, not hard coded in a model.
    def display_name
      return nil unless show_identifier?

      name = user.respond_to?(:name) ? user&.name : nil
      name.presence
    end
  end
end
