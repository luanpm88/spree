# Templates that belong to THIS shop, overriding the shared ones.
#
#     app/views/shops/<shop>/spree/customer_mailer/welcome_email.html.erb
#
# ── why this exists ──────────────────────────────────────────────────────────
#
# One image serves seven shops. Every mailer template in app/views is shared by
# all of them, and that has been fine while the only per-shop difference was
# wording, which config/initializers/shop_locale.rb already handles.
#
# It stops being fine the moment a shop has its own DESIGN. The client sent seven
# email designs for one shop on 19 August: a logo lockup, a script heading, green
# tick marks, a pill button, a dark support panel with his droplet watermark, and
# a legal footer naming his holding company. Building that into the shared
# template would redesign the emails of six shops that never asked for it, which
# is the single most repeated mistake on this project: his footer colours, his
# policy order and his wording have each reached shops they were not meant for.
#
# So a shop can carry its own copy of any template, and every other shop keeps
# the shared one untouched.
#
# ── how it resolves ──────────────────────────────────────────────────────────
#
# The per-shop directory is PREPENDED, so a file there wins and anything absent
# falls through to app/views exactly as before. A shop with no directory behaves
# as it always has, which is why this is safe to ship before any shop uses it.
#
# Prepended to ActionMailer as well as ActionController. They keep separate view
# path stacks, and a mailer looking at the controller's paths is not a thing:
# setting only the controller's would have left every mailer on the shared
# template while the check that renders one said it had worked.
#
# ── keeping the words out of it ──────────────────────────────────────────────
#
# The templates under here hold STRUCTURE, not sentences. Every string still
# comes from the shop's own locale file, so the same markup would serve another
# shop given its own words, and a wording change stays a one-file change. The
# directory is gitignored all the same, because its path names the client's shop
# and this repository is public. It travels through CLIENT_ASSETS, like
# config/shop_locales and app/models/spree/calculator/shipping.

Rails.application.config.after_initialize do
  # SHOP_KEY first: these overrides are WORDS and layout, so they follow the
  # shop's content key, not the deployment's name. See shop_locale.rb.
  shop = ENV['SHOP_KEY'].presence&.strip || ENV['SHOP'].to_s.strip
  next if shop.empty?

  dir = Rails.root.join('app', 'views', 'shops', shop)
  next unless dir.directory?

  ActionController::Base.prepend_view_path(dir.to_s)
  ActionMailer::Base.prepend_view_path(dir.to_s)

  # Said out loud, once, at boot. A template silently overriding another is the
  # thing that makes "why does this shop look different" take an hour, and the
  # answer should be in the log of the container that does it.
  Rails.logger.info(
    "[shop_views] #{shop} is using its own templates from app/views/shops/#{shop}: " +
      Dir.glob(dir.join('**', '*.erb')).map { |f| f.sub("#{dir}/", '') }.sort.join(', ')
  )
end
