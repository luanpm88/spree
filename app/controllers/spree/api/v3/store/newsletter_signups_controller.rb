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
        # Spree::NewsletterSubscriber.subscribe takes email, user, store and
        # redirect_url. A name posted to it is dropped by the strong parameters
        # before anything could store it. A field on the form that silently
        # discards what someone types is worse than no field.
        #
        # ── where the name goes, and why there ───────────────────────────────
        #
        # Into a metafield, not into public_metadata.
        #
        # Metafields are a first class thing in 5.6: they have a definition with
        # a name and a type, the admin renders them, and Spree::Exports::
        # NewsletterSubscribers already puts every metafield into the CSV as its
        # own column. So the name lands where the shop owner will actually meet
        # it, which is the export he sends to his mail tool. public_metadata is a
        # loose json blob that nothing displays and nothing exports.
        #
        # Spree::NewsletterSubscriber is on the platform's own list of resources
        # that may carry metafields, so this is a supported use of it rather than
        # a hole being widened.
        #
        # ── what this does NOT change ────────────────────────────────────────
        #
        # The Customer column in the admin still fills itself from the account
        # whose email matches, exactly as before. That column is a link to a
        # customer record, not a typed name, and it was never the thing a name
        # field could fill. This adds a Name column to the export beside it.
        class NewsletterSignupsController < ::Spree::Api::V3::Store::BaseController
          allow_guest_storefront_access!

          NAMESPACE = 'customer'.freeze
          KEY = 'name'.freeze
          MAX_NAME = 100

          def create
            subscriber = Spree::NewsletterSubscriber.subscribe(
              email: params[:email],
              user: current_user,
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
          # metafield could not be written would tell the visitor their signup
          # did not work when it did.
          def store_name_for(subscriber)
            name = params[:name].to_s.strip.first(MAX_NAME)
            return if name.blank?

            definition = metafield_definition
            return if definition.nil?

            metafield = Spree::Metafield.find_or_initialize_by(
              resource: subscriber,
              metafield_definition_id: definition.id
            )
            metafield.type = definition.metafield_type
            metafield.value = name
            metafield.save
          rescue StandardError => e
            Rails.logger.warn("[newsletter] could not store the name: #{e.class}: #{e.message}")
          end

          # Created on first use rather than in a migration, so a shop that never
          # receives a named signup never grows a definition it does not use, and
          # so this works on all six shops without a deploy step per shop.
          def metafield_definition
            Spree::MetafieldDefinition.find_or_create_by!(
              resource_type: 'Spree::NewsletterSubscriber',
              namespace: NAMESPACE,
              key: KEY
            ) do |d|
              d.name = 'Name'
              d.metafield_type = 'Spree::Metafields::ShortText'
              d.display_on = 'both'
            end
          rescue ActiveRecord::RecordInvalid => e
            Rails.logger.warn("[newsletter] no metafield definition: #{e.message}")
            nil
          end
        end
      end
    end
  end
end
