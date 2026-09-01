# frozen_string_literal: true

module Spree
  # Does THIS shop approve customers before they can buy?
  #
  # Reads config/approval_shops, which is one shop key per line. See that file for
  # why this is declared rather than worked out from the data: the client asked for
  # exactly this, having spotted that the previous version would break the moment
  # he used customer groups for VIP or Loyalty on a retail shop.
  #
  # ── shape of the answer ─────────────────────────────────────────────────────
  #
  # A hard true or false, and false when the file is missing. A shop that is not
  # listed sends no approval mail, which is the safe direction: a missing line
  # leaves a wholesale shop quiet, where a wrong guess announces a retail
  # customer's signup to the shop owner. He has already had the second one.
  #
  # ── why it is read once ─────────────────────────────────────────────────────
  #
  # The file cannot change while the process is running: it is baked into the image
  # and a change arrives as a deploy, which restarts the container. Reading it on
  # every signup would be a disk hit on a hot path for an answer that cannot move.
  module ApprovalShops
    PATH = 'config/approval_shops'

    class << self
      # @param shop [String, nil] override, for tests. Defaults to this deployment.
      # @return [Boolean] whether this shop approves customers before they buy
      def required?(shop = nil)
        candidates = shop ? [shop] : current_shops
        candidates
          .map { |name| name.to_s.strip.downcase }
          .reject(&:empty?)
          .any? { |name| names.include?(name) }
      end

      # BOTH names, not one of them.
      #
      # A shop has two: SHOP is the deployment (the container, the image, the
      # directory) and SHOP_KEY is its set of words, and on the commercial shop
      # they differ. Checking only the first would mean the file has to name the
      # shop by whichever one the code happened to pick, and getting that wrong
      # fails SILENTLY: the shop simply stops announcing signups and nobody finds
      # out until an applicant has been waiting a week.
      #
      # So either name matches. There is nothing to remember and no wrong answer.
      def current_shops
        [ENV['SHOP_KEY'], ENV['SHOP']].compact
      end

      def names
        @names ||= read
      end

      # For tests, which stub the environment between examples.
      def reset!
        @names = nil
      end

      private

      def read
        path = Rails.root.join(PATH)
        return Set.new unless path.exist?

        path
          .each_line
          .map { |line| line.split('#').first.to_s.strip.downcase }
          .reject(&:empty?)
          .to_set
      end
    end
  end
end
