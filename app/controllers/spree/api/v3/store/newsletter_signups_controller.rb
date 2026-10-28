module Spree
  module Api
    module V3
      module Store
        # Subscribe to the newsletter and keep the name the visitor typed.
        #
        # ── why this endpoint exists at all ──────────────────────────────────
        #
        # The client asked for a name beside the email on the subscribe form, so
        # a signup is a person rather than an address. Spree's own endpoint
        # cannot carry one, and it does not say so. Measured against the running
        # shop rather than read anywhere:
        #
        #   POST .../newsletter_subscribers {email, name, first_name, last_name}
        #     -> 201 Created, and the name is gone. No error, no warning.
        #   POST .../newsletter_subscribers {email, public_metadata: {name}}
        #     -> 201 Created, public_metadata still null.
        #
        # spree_newsletter_subscribers has no name column, and
        # Spree::NewsletterSubscriber.subscribe takes email, customer, store and
        # redirect_url. A name posted to it is dropped by the strong parameters
        # before anything could store it. A field on the form that silently
        # discards what someone types is worse than no field. Still true on
        # 6.0.0: its CreateNewsletterSubscriberParams are email and redirect_url.
        #
        # Measured on 5.6 against the running shop; the 6.0 lines are read from
        # spree_api 6.0.0's newsletter_subscribers_controller.rb.
        #
        # ── where the name goes, and why there ───────────────────────────────
        #
        # Into a custom field (a metafield on 5.6), not into metadata.
        #
        # Custom fields are a first class thing: they have a definition with a
        # label and a type, the dashboard renders them, and the subscriber export
        # puts every one into the CSV as its own column. So the name lands where
        # the shop owner will actually meet it, which is the export he sends to
        # his mail tool. metadata is a loose json blob that nothing displays and
        # nothing exports.
        #
        # Spree::NewsletterSubscriber is on the platform's own list of resources
        # that may carry custom fields (Spree.custom_fields.enabled_resources), so
        # this is a supported use of it rather than a hole being widened.
        #
        # ── what this does NOT change ────────────────────────────────────────
        #
        # The Customer column in the admin still fills itself from the account
        # whose email matches, exactly as before. That column is a link to a
        # customer record, not a typed name, and it was never the thing a name
        # field could fill. This adds a Name column to the export beside it.
        class NewsletterSignupsController < ::Spree::Api::V3::Store::BaseController
          allow_guest_storefront_access!

          # The limit Spree puts on its own newsletter endpoint since 6.0. Ours
          # creates the same row from the same anonymous request, so it takes the
          # same limit rather than being the unthrottled way round it.
          rate_limit to: Spree::Api::Config[:rate_limit_register],
                     within: Spree::Api::Config[:rate_limit_window].seconds,
                     store: Rails.cache,
                     only: :create,
                     with: -> { render_rate_limited(limit: Spree::Api::Config[:rate_limit_register]) }

          NAMESPACE = 'customer'.freeze
          KEY = 'name'.freeze
          MAX_NAME = 100

          def create
            subscriber = Spree::NewsletterSubscriber.subscribe(
              email: params[:email],
              customer: current_user,
              store: current_store
            )

            return render_errors(subscriber.errors) if subscriber.errors.any?

            store_name_for(subscriber)

            render json: serialize_resource(subscriber), status: :created
          end

          private

          # The platform's own serializer for this resource, named because the
          # base controller infers one from the controller's name and there is no
          # NewsletterSignup model to infer from.
          #
          # Worth knowing how this failed: without it the row was created, the
          # name was stored, the confirmation email went out, and the endpoint
          # answered 500. Everything worked except saying so, which on the
          # storefront would have shown the visitor an error over a signup that
          # had in fact succeeded.
          def serializer_class
            ::Spree::Api::V3::NewsletterSubscriberSerializer
          end

          # Best effort on purpose. The subscription itself has already
          # succeeded by this point, and failing the whole request because a
          # custom field could not be written would tell the visitor their
          # signup did not work when it did.
          #
          # set_custom_field saves with save!, so a validation failure lands in the
          # log below instead of vanishing.
          def store_name_for(subscriber)
            name = params[:name].to_s.strip.first(MAX_NAME)
            return if name.blank?

            definition = custom_field_definition
            return if definition.nil?

            subscriber.set_custom_field(definition, name)
          rescue StandardError => e
            Rails.logger.warn("[newsletter] could not store the name: #{e.class}: #{e.message}")
          end

          # Created on first use rather than in a migration, so a shop that never
          # receives a named signup never grows a definition it does not use, and
          # so this works on every shop without a deploy step per shop.
          #
          # Per store, because a definition belongs to one on 6.0.
          def custom_field_definition
            Spree::CustomFieldDefinition.find_or_create_by!(
              store: current_store,
              resource_type: 'Spree::NewsletterSubscriber',
              namespace: NAMESPACE,
              key: KEY
            ) do |d|
              d.label = 'Name'
              d.field_type = 'short_text'
              # Read by staff and the export, never by the storefront.
              d.storefront_visible = false
            end
          rescue ActiveRecord::RecordInvalid => e
            Rails.logger.warn("[newsletter] no custom field definition: #{e.message}")
            nil
          end
        end
      end
    end
  end
end
