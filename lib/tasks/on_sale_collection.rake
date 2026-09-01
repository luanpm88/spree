# Build the On Sale collection as a MANUAL one, from the products that are
# actually discounted.
#
#   bin/rails on_sale:report     what would go in, writes nothing
#   bin/rails on_sale:build      create or refill collections/on-sale
#
# ── why manual, when automatic is less work ──────────────────────────────────
#
# Because the 5.6 Store API does not serve automatic taxons at all. Measured on a
# real shop rather than read anywhere: a taxon with `automatic = true` holding 19
# products answers 404 on /api/v3/store/categories/<permalink>, while the manual
# collections beside it answer 200. An automatic On Sale therefore produces an
# empty row on a headless storefront and a category page that does not exist.
#
# The rule the shop owner would have written by hand is applied here instead:
# a product belongs in On Sale when a live price sits below its compare-at price.
# So the collection is refilled by running this again, which is a command rather
# than an afternoon of tagging, and the result is a plain manual collection the
# API is willing to serve.
#
# ── it fills once, then leaves the collection alone ──────────────────────────
#
# `build` refuses to touch a collection that already has products in it. The shop
# owner was offered both and chose this: "I think leave it once it is set". After
# the first fill the collection is his, and anything he adds or removes in the
# admin stays.
#
# `refill` is the deliberate opposite and says what it is destroying before it
# does it. It exists for the day the discounts change wholesale, and it is a
# separate word so it cannot be reached by habit.
#
# Neither task ever deletes a taxon, and neither touches any other collection.
namespace :on_sale do
  PERMALINK = 'collections/on-sale'.freeze
  TAXON_NAME = 'On sale'.freeze

  def discounted_products
    # variants_including_master, not variants.
    #
    # `variants` excludes the master variant, and on this catalogue every
    # compare-at price sits on the master: a product with no options has its
    # price there and nowhere else. Joining through `variants` returned zero
    # products while the prices table plainly held fifteen, which is the kind of
    # empty result that reads as "no sale on" rather than as a broken query.
    Spree::Product
      .joins(variants_including_master: :prices)
      .where(spree_prices: { deleted_at: nil })
      .where.not(spree_prices: { compare_at_amount: nil })
      .where('spree_prices.compare_at_amount > spree_prices.amount')
      .where(deleted_at: nil)
      .distinct
  end

  def collections_root
    Spree::Taxon.find_by(permalink: 'collections')
  end

  desc 'List the products a manual On Sale collection would hold'
  task report: :environment do
    products = discounted_products.order(:name)
    taxon = Spree::Taxon.find_by(permalink: PERMALINK)

    puts taxon ? "#{PERMALINK} exists, automatic=#{taxon.automatic}" : "#{PERMALINK} does not exist yet"
    puts "#{products.count} product(s) have a price below their compare-at price:\n\n"
    products.each { |p| puts "  #{p.name}" }
    puts "\nbin/rails on_sale:build creates it manual and fills it. Take a dump first."
  end

  desc 'Create collections/on-sale as a manual collection and fill it'
  task build: :environment do
    root = collections_root
    abort 'no "collections" taxonomy root on this shop — nothing to attach to' if root.nil?

    taxon = Spree::Taxon.find_by(permalink: PERMALINK)
    if taxon.nil?
      taxon = Spree::Taxon.create!(
        name: TAXON_NAME,
        taxonomy: root.taxonomy,
        parent: root,
        automatic: false,
      )
      puts "created #{taxon.permalink}"
    else
      # An existing automatic one is turned manual rather than deleted. Deleting
      # would take its position, its description and anything else set on it.
      taxon.update!(automatic: false) if taxon.automatic
      puts "reusing #{taxon.permalink} (automatic=#{taxon.automatic})"
    end

    products = discounted_products.to_a
    abort 'no discounted products found — refusing to empty the collection' if products.empty?

    before = taxon.products.count
    if before.positive?
      puts "#{taxon.permalink} already holds #{before} product(s). Leaving it alone."
      puts 'bin/rails on_sale:refill rebuilds it from the discounts and discards'
      puts 'anything picked by hand.'
      next
    end
    products.each_with_index do |product, i|
      Spree::Classification.create!(taxon_id: taxon.id, product_id: product.id, position: i + 1)
    end

    taxon.reload
    Spree::Taxon.recalculate_products_count([taxon.id]) if Spree::Taxon.respond_to?(:recalculate_products_count)

    puts "#{taxon.permalink}: filled with #{products.count} product(s)"
    puts 'It is yours from here. build will not touch it again.'
  end

  # ── the case build and refill both get wrong ────────────────────────────────
  #
  # A shop arrives from the upgrade with collections/on-sale already there, still
  # automatic, and holding one or two products that its rules happened to match.
  # That is the worst of both:
  #
  #   automatic = true   the 5.6 Store API serves no automatic taxon, so the page
  #                      the home page's "see what's on offer" button leads to has
  #                      nothing on it at all
  #   1 product linked   `build` sees a non-empty collection and leaves it alone,
  #                      exactly as the shop owner asked it to
  #
  # So the collection reads as "already set" while showing nothing, and the only
  # tool that would fill it is `refill`, which discards. Neither is right: those
  # one or two rows were put there by a rule, not by him, and there is nothing to
  # protect and nothing to justify deleting.
  #
  # This adds what is missing and removes nothing. It is the one to reach for on a
  # shop that has just come across; `build` is for a shop with no collection at
  # all, and `refill` is still the only thing that destroys.
  desc 'Turn On Sale manual and add the discounted products it is missing'
  task top_up: :environment do
    taxon = Spree::Taxon.find_by(permalink: PERMALINK)
    abort "#{PERMALINK} does not exist — run on_sale:build first" if taxon.nil?

    if taxon.automatic
      taxon.update!(automatic: false)
      puts "#{PERMALINK}: automatic -> false, the Store API will serve it now"
    end

    products = discounted_products.to_a
    abort 'no discounted products found — nothing to add' if products.empty?

    have = taxon.products.pluck(:id).to_set
    missing = products.reject { |p| have.include?(p.id) }

    puts "#{PERMALINK}: holds #{have.size}, #{products.count} are discounted, adding #{missing.count}"
    if missing.empty?
      puts '  nothing to add'
      next
    end

    position = taxon.products.count
    missing.each do |product|
      position += 1
      Spree::Classification.create!(taxon_id: taxon.id, product_id: product.id, position: position)
      puts "  + #{product.name}"
    end

    taxon.reload
    Spree::Taxon.recalculate_products_count([taxon.id]) if Spree::Taxon.respond_to?(:recalculate_products_count)
    puts "#{PERMALINK}: now holds #{taxon.products.count} product(s). Nothing was removed."
  end

  desc 'Rebuild On Sale from the discounts, discarding anything picked by hand'
  task refill: :environment do
    taxon = Spree::Taxon.find_by(permalink: PERMALINK)
    abort "#{PERMALINK} does not exist — run on_sale:build first" if taxon.nil?

    products = discounted_products.to_a
    abort 'no discounted products found — refusing to empty the collection' if products.empty?

    before = taxon.products.count
    puts "discarding #{before} product(s) currently in #{taxon.permalink}"
    Spree::Classification.where(taxon_id: taxon.id).delete_all
    products.each_with_index do |product, i|
      Spree::Classification.create!(taxon_id: taxon.id, product_id: product.id, position: i + 1)
    end
    taxon.reload
    Spree::Taxon.recalculate_products_count([taxon.id]) if Spree::Taxon.respond_to?(:recalculate_products_count)
    puts "#{taxon.permalink}: #{before} before, #{products.count} now"
  end
end
