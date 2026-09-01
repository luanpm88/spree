# Load the wording that belongs to THIS shop, and nothing that belongs to another.
#
# ── the shape ────────────────────────────────────────────────────────────────
#
#     config/shop_locales/_common.en.yml     every shop, brand neutral
#     config/shop_locales/<shop>.en.yml      this shop only
#     config/shop_locales/<shop>.fr.yml      this shop, another language
#
# Loaded in that order and appended last, so the shop's own file beats the common
# one and both beat everything Spree and config/locales declare. The common file
# is optional: a shop that writes every key does not need one.
#
# This is the client's own recommendation, in his words: "make a very common
# en.yml file and only change basic info such as shop name and URL".
#
# ── what happens without it ──────────────────────────────────────────────────
#
# On the old server each shop was its own Rails application, so config/locales
# meant that shop and nothing else. Here one image serves them all, and a file
# left in config/locales is read by every shop on the box.
#
# One brand's file sat there as the default. Measured on the running containers,
# it was supplying 50 keys to all five retail shops, including
#
#     the closing line of every order confirmation
#     the heading of the welcome mail, which announced an approval step
#       that retail customers do not have
#     the entire bank block of the payment link mail: another company's
#       account name, bank, account number and SWIFT code
#
# The last one was confirmed on the rendered mail, not inferred from the file.
# Nothing failed, nothing logged, and every one of those emails looked finished.
#
# ── why the files are not under config/locales ───────────────────────────────
#
# Rails::Engine declares
#
#     paths.add "config/locales", glob: "**/*.{rb,yml}"
#
# which is recursive, so a subdirectory under it is not isolation either. That
# was measured too: a per shop file placed in config/locales/shops/ was on every
# shop's load path regardless of SHOP.
#
# ── why a missing file raises ────────────────────────────────────────────────
#
# Because the failure it replaces was silent, and a shop that will not boot is
# found in seconds by the person running the deploy. A shop that boots and mails
# another brand's wording is found by its customers.
#
# SHOP unset is not an error: that is local development and the test suite.
# script/shop_host leaves it unset, loudly, for a shop that has no file yet.
#
# ── SHOP_KEY first, and why there are two names ─────────────────────────────
#
# SHOP names the DEPLOYMENT: the container, the image, the directory under /srv.
# SHOP_KEY names the SET OF WORDS. On the seven shops of the retail estate they
# are the same string, so one variable did for both and nobody noticed there were
# two ideas in it.
#
# The commercial shop is deployed under one name and its wording is filed under
# another. On 1 Sep this initializer asked for a file named after the DEPLOYMENT,
# found nothing, and refused to boot while the shop's real wording file sat in the
# same directory under its own key. The backend went down and took the storefront
# with it, because the storefront waits on the backend's health.
#
# That is the guard working exactly as designed: it would rather stop than send
# another brand's wording, and it named the missing file in the log. The bug was
# that it was asking for the wrong name. Same distinction the storefront draws in
# storefront/src/lib/shop-key.ts, and the same fallback, so a shop that does not
# set SHOP_KEY behaves exactly as before.
shop = ENV['SHOP_KEY'].presence&.strip || ENV['SHOP'].to_s.strip

if shop.present?
  dir = Rails.root.join('config', 'shop_locales')
  own = Dir[dir.join("#{shop}.*.yml")].sort

  if own.empty?
    raise <<~MSG
      SHOP is set to #{shop.inspect} but config/shop_locales/#{shop}.*.yml matched nothing.

      That file carries this shop's own email wording. Without it the shop falls
      back to whatever else is loaded, and nothing about that is visible from
      the outside.

      The directory is gitignored on purpose (it is the client's copy and this
      repository is public), so it travels as a deploy asset. Check that
      config/shop_locales is in CLIENT_ASSETS in script/commercial.
    MSG
  end

  common = Dir[dir.join('_common.*.yml')].sort

  # ── after_initialize, and this is load bearing ─────────────────────────────
  #
  # I18n reads its load path in order and the LAST file to define a key wins.
  # Appending at the top level of an initializer does NOT achieve that: every
  # engine's :add_locales initializer runs afterwards and unshifts, so everything
  # Spree and the app declare lands in front. Measured, the shop's own file came
  # out first of ten, which is last to be consulted.
  #
  # after_initialize runs once every engine has finished. reload! because the
  # backend may already have read the path during boot, and a load path that
  # grows after initialisation is ignored until it is asked again.
  Rails.application.config.after_initialize do
    I18n.load_path.concat(common)
    I18n.load_path.concat(own)
    I18n.backend.reload!
  end
end
