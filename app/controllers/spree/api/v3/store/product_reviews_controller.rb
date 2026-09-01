module Spree
  module Api
    module V3
      module Store
        # The approved reviews for one product, and their average.
        #
        # ── read only, on purpose ────────────────────────────────────────────
        #
        # Writing a review needs an account, a purchase check and a moderation
        # queue, and none of that should be invented in the middle of moving live
        # shops. His existing reviews were written on his old shop and came across
        # in the dump; this is what puts them back in front of a customer.
        #
        # Scoped to the product AND to the current store. A shop must never show
        # another shop's reviews, which is the same failure that put one shop's
        # pages on another earlier in this project.
        class ProductReviewsController < ::Spree::Api::V3::Store::ResourceController
          skip_before_action :authenticate_user, raise: false

          def index
            # Not every shop has the table. One shop on this estate is newer than
            # the others and never ran the extension that created
            # spree_product_reviews, so asking it for reviews would raise
            # ActiveRecord::StatementInvalid and turn a product page into a 500.
            # Measured, not assumed: to_regclass came back empty on that one and
            # non-empty on the rest.
            return render json: { data: [], meta: { count: 0, average_rating: nil } } unless reviews_table?

            product = current_store.products.friendly.find(params[:product_id])

            reviews = Spree::ProductReview.visible.where(product_id: product.id)

            render json: {
              data: reviews.map { |r| serialize(r) },
              meta: {
                count: reviews.size,
                average_rating: average_of(reviews)
              }
            }
          rescue ActiveRecord::RecordNotFound
            render json: { error: { code: 'not_found', message: 'Product not found' } }, status: :not_found
          end

          private

          # Asked once per process, not once per request: the answer cannot change
          # while the app is running, and a schema query on every product page is a
          # round trip for something that is fixed at boot.
          def reviews_table?
            return @@reviews_table if defined?(@@reviews_table)

            @@reviews_table = Spree::ProductReview.table_exists?
          rescue StandardError
            @@reviews_table = false
          end

          def serialize(review)
            {
              id: review.id,
              rating: review.rating,
              title: review.title,
              review: review.review,
              # Only when the reviewer allowed it. See Spree::ProductReview.
              name: review.display_name,
              created_at: review.created_at&.iso8601
            }
          end

          # Rounded to one decimal, and nil when there is nothing to average.
          #
          # Nil rather than 0: a shop with no reviews has no rating, and a zero
          # printed as a star row says the product scored nothing, which is a
          # different and worse claim.
          def average_of(reviews)
            return nil if reviews.empty?

            (reviews.sum(&:rating).to_f / reviews.size).round(1)
          end
        end
      end
    end
  end
end
