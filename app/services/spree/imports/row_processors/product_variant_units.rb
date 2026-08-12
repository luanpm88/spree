module Spree
  module Imports
    module RowProcessors
      # Makes the product importer keep the unit columns it already asks you for.
      #
      # Spree's import schema offers both of these as mappable columns
      # (spree_core/app/models/spree/import_schemas/products.rb:20,22):
      #
      #   { name: 'dimensions_unit', label: 'Dimensions Unit' }
      #   { name: 'weight_unit',     label: 'Weight Unit' }
      #
      # and the row processor that consumes the mapping assigns seven fields,
      # neither of them (product_variant.rb:28-34). You map the column in the
      # admin, the import reports success, and the value is thrown away. No error,
      # no warning, nothing in a log.
      #
      # weight_unit survives the omission because Variant#weight_unit falls back
      # to the store preference. dimensions_unit has no such reader upstream; ours
      # is added in Spree::VariantDecorator, and a default is not the same thing as
      # the value somebody typed. A file that says mm and is read as cm is wrong by
      # a factor of a thousand, in a number that decides whether an order ships as
      # cartons, pallets or a container.
      #
      # Hooked on the return value of process!, which is the variant itself, rather
      # than on the assignments: they sit inline inside process! with no method of
      # their own to override.
      class ProductVariantUnits < ProductVariant
        UNIT_COLUMNS = %w[dimensions_unit weight_unit].freeze

        def process!
          variant = super
          return variant unless variant.is_a?(Spree::Variant)

          units = UNIT_COLUMNS.each_with_object({}) do |column, memo|
            value = attributes[column]
            memo[column] = value.to_s.strip.downcase if value.present?
          end
          return variant if units.empty?

          # update! rather than update_columns, so Spree's own inclusion
          # validation runs. A typo in the unit column should stop the row and say
          # so during the import, not sit in the database looking like a number
          # anyone can compute a volume from.
          variant.update!(units)
          variant
        end
      end
    end
  end
end
