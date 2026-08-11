module Spree
  module ShipmentMailerDecorator
    def self.prepended(base)
      base.include Spree::FullDocumentTemplates
    end
  end

  ShipmentMailer.prepend ShipmentMailerDecorator
end
