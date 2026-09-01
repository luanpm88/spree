# The client's own shipping calculators, and only the ones belonging to THIS shop.
#
# ── what was wrong, in his own screenshots ───────────────────────────────────
#
# He sent two side by side on 24 August, captioned "New, ... Shop" and
# "Current, ... Shop", with an arrow on the Calculator dropdown. His own shop
# offers his freight table by name in that list. The new one offers Flat
# Percent, Flat rate, Flexible Rate per package item, Flat rate per package
# item, Price sack and Digital Delivery, and nothing of his.
#
# The classes were already in app/models. That is not enough. Spree builds the
# dropdown from Spree.calculators.shipping_methods, and a calculator absent from
# that collection cannot be chosen. Measured on the running container before
# writing this:
#
#   SHOP env: "nz"
#   registered: FlatPercentItemTotal, FlatRate, FlexiRate, PerItem, PriceSack,
#               DigitalDelivery
#   shipping methods in the database:
#     Free Post          Spree::Calculator::Shipping::FlatRate
#     Standard Postage   Spree::Calculator::Shipping::UbiNzShippingCalculator
#
# So the method in the database already points at his calculator and quotes with
# it, which is why his screenshot shows the name in the Amount column and not in
# the list. Nothing is broken today; it is unselectable, and the next person to
# edit that method loses it with no warning. That is the shape of failure this
# whole file exists to prevent.
#
# ── why the map is a separate, gitignored file ───────────────────────────────
#
# Its keys are the client's shop names and this repository is public, so the map
# lives in config/shop_calculators and travels as a deploy asset. Same reason
# and same mechanism as config/clean_url_shops and config/shop_collections. The
# schema, with no client names in it, is in config/shop_calculators.example.
#
# ── three things had to change in the files he sent, none of it logic ────────
#
#   One shop's file declares another shop's class name. It is that other shop's
#   file with the description edited and the class name missed. Under Zeitwerk a
#   constant that does not match its path raises on boot, so as sent it stops the
#   app. Renamed to match its filename.
#
#   Two of his files declare the same class with the same description, differing
#   only in comments and in one en dash inside a delivery estimate. The logic is
#   identical, so one class serves both shops and the map names it twice.
#
#   One opened with require_dependency, which modern Rails removed. Dropped;
#   Zeitwerk loads it.

Rails.application.config.after_initialize do
  shop = ENV['SHOP'].to_s.strip
  path = Rails.root.join('config', 'shop_calculators')

  # SHOP unset is local development and the test suite, exactly as in
  # config/initializers/shop_locale.rb. Without the map there, register nothing
  # and stay quiet: a checkout with no client assets has to boot.
  if path.exist?
    map = {}
    path.each_line do |line|
      next if line.strip.empty? || line.strip.start_with?('#')
      key, names = line.split(':', 2)
      next if names.nil?
      map[key.strip] = names.split
    end

    wanted =
      if shop.present?
        map[shop] || raise(<<~MSG)
          SHOP is #{shop.inspect} and config/shop_calculators has no line for it.

          Add one. Without it this shop's admin offers only the six calculators
          Spree ships with, so the freight table the client wrote is not
          selectable. An existing shipping method keeps quoting correctly until
          somebody edits it, and then it does not. Nothing fails and nothing
          logs, which is why this raises instead.
        MSG
      else
        map.values.flatten.uniq
      end

    wanted.each do |name|
      klass = "Spree::Calculator::Shipping::#{name}".safe_constantize
      unless klass
        raise <<~MSG
          Spree::Calculator::Shipping::#{name} does not resolve.

          Named in config/shop_calculators for shop #{shop.inspect}, but the
          constant is missing. Check that the file exists under
          app/models/spree/calculator/shipping (gitignored, carried by
          CLIENT_ASSETS in script/commercial) and that its class name matches
          its path, which is what Zeitwerk requires. One of the files he sent
          arrived with another shop's class name inside this shop's filename,
          so that is not a hypothetical.
        MSG
      end
      Spree.calculators.shipping_methods << klass unless Spree.calculators.shipping_methods.include?(klass)
    end
  end
end
