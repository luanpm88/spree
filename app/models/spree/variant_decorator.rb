module Spree
  # Gives dimensions_unit the same fallback Spree already gives weight_unit.
  #
  # Upstream, Variant#weight_unit reads:
  #
  #   attributes['weight_unit'] || Spree::Store.default.preferred_weight_unit
  #
  # and there is no equivalent for dimensions_unit. The column is nullable,
  # validated with allow_blank, never written by the CSV importer, and read by
  # nothing. Variant#volume is
  #
  #   (width || 0) * (height || 0) * (depth || 0)
  #
  # with no unit awareness at all, so an empty dimensions_unit is not a missing
  # label. It is a number whose meaning nobody recorded.
  #
  # On this project that number picks the freight tier: under 1 CBM ships as
  # cartons, up to 12 as pallets, beyond that a container. A catalogue loaded in
  # millimetres and read as centimetres is wrong by a factor of a thousand and
  # looks entirely plausible on the screen.
  #
  # The store has no preferred_dimensions_unit to fall back to, only
  # preferred_unit_system, so the mapping is derived from that.
  module VariantDecorator
    # Keyed by Spree::Store's unit_system preference. The values are members of
    # Spree::Variant::DIMENSION_UNITS (mm cm in ft).
    DIMENSIONS_UNIT_BY_SYSTEM = { 'metric' => 'cm', 'imperial' => 'in' }.freeze

    # @return [String] the stored unit, or the store's default for its unit system
    def dimensions_unit
      attributes['dimensions_unit'].presence || self.class.default_dimensions_unit
    end

    def self.prepended(base)
      base.singleton_class.prepend(ClassMethods)
    end

    module ClassMethods
      # 'cm' as the last resort rather than 'in'. Spree's own unit_system default
      # is imperial, which suits its US origin; every shop in this project sells
      # from New Zealand and Australia. Guessing inches here would be a silent
      # 2.54x error in the direction nobody would check.
      def default_dimensions_unit
        system = Spree::Store.default&.preferred_unit_system
        DIMENSIONS_UNIT_BY_SYSTEM.fetch(system.to_s, 'cm')
      rescue StandardError
        'cm'
      end
    end
  end

  Variant.prepend VariantDecorator
end
