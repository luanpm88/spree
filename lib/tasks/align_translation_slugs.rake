# Make a product's English translation agree with the product itself.
#
#   bin/rails slugs:report          what differs, writes nothing
#   bin/rails slugs:align           make them agree
#
# ── what this is for ─────────────────────────────────────────────────────────
#
# A shop upgraded from 5.4 can serve different addresses than it did before, and
# the reason is not the upgrade inventing them. `spree_product_translations` has
# its own `slug` column, and on one shop 14 of 79 products carry a translation
# slug that disagrees with `spree_products.slug`:
#
#   spree_products.slug              a-bottle-2-0l-with-a-lid-twin-pack
#   translation (en).slug            a-bottle-2-dot-0l-with-a-lid-2-bottle-combo
#
# 5.4's storefront read the product's own slug. The 5.6 Store API reads the
# translation. Both addresses resolve, so nothing 404s, but the shop advertises
# the second while every link in the world points at the first.
#
# Those rows are not new. On that shop they are dated a year before the upgrade,
# and they are present in the pre-upgrade dump, so this is old data surfacing
# rather than anything the migration did. Worth saying plainly, because the first
# guess was that somebody had renamed products, and that guess was wrong.
#
# ── how it behaves ───────────────────────────────────────────────────────────
#
# Reports by default. `slugs:align` is the only task that writes, it touches the
# translation row and never the product, and it leaves a translation alone when
# its slug is blank, because blank means "no override" rather than "disagrees".
namespace :slugs do
  # Only the rows where a translation actively claims a different address.
  def mismatched_translations
    return [] unless defined?(Spree::Product::Translation)

    Spree::Product::Translation
      .joins('INNER JOIN spree_products p ON p.id = spree_product_translations.spree_product_id')
      .where('spree_product_translations.slug IS NOT NULL')
      .where("spree_product_translations.slug <> ''")
      .where('spree_product_translations.slug <> p.slug')
      .where('p.deleted_at IS NULL')
      .select('spree_product_translations.*, p.slug AS product_slug, p.name AS product_name')
  end

  desc 'Show products whose translation slug disagrees with the product slug'
  task report: :environment do
    rows = mismatched_translations
    if rows.empty?
      puts 'ok — every translation slug agrees with its product'
      next
    end

    puts "#{rows.size} translation(s) claim a different address:\n\n"
    rows.each do |t|
      puts "  #{t.product_name}"
      puts "    product      #{t.product_slug}"
      puts "    translation  #{t.slug}   (#{t.locale})"
    end
    puts "\nbin/rails slugs:align makes the translations agree. Take a dump first."
  end

  desc 'Point translation slugs back at the product slug'
  task align: :environment do
    rows = mismatched_translations.to_a
    if rows.empty?
      puts 'nothing to do'
      next
    end

    changed = 0
    rows.each do |t|
      # Read the old value BEFORE writing. The first version printed t.slug after
      # update_column, so every line read "x -> x" and the log proved nothing.
      was = t.slug
      product_slug = t.product_slug
      # update_column, not update: this is a data correction, and running the
      # model's callbacks here would regenerate the very slug being corrected.
      t.update_column(:slug, product_slug)
      changed += 1
      puts "  #{t.locale}  #{was}"
      puts "      -> #{product_slug}"
    end

    puts "\n#{changed} translation(s) now agree with their product."
    puts 'The shop now serves the product slug, which is the address it had'
    puts 'before the upgrade. The translation slug it briefly served does NOT'
    puts 'resolve afterwards: it was never written to friendly_id_slugs, so'
    puts 'there is no history row for it. That is safe when the shop has not'
    puts 'been published yet, and it is the reason to run this BEFORE going'
    puts 'live rather than after.'
  end
end
