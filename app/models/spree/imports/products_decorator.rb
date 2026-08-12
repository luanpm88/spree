module Spree
  module Imports
    # Points the product importer at the row processor that keeps the unit
    # columns. row_processor_class is a plain public method on
    # Spree::Imports::Products and exists to be overridden.
    module ProductsDecorator
      def row_processor_class
        Spree::Imports::RowProcessors::ProductVariantUnits
      end
    end

    Products.prepend ProductsDecorator
  end
end
