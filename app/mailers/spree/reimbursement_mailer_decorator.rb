module Spree
  module ReimbursementMailerDecorator
    def self.prepended(base)
      base.include Spree::FullDocumentTemplates
    end
  end

  ReimbursementMailer.prepend ReimbursementMailerDecorator
end
