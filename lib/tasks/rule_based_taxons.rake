# Turn a rule-based category into an ordinary one, keeping what it holds.
#
#     bin/rails taxons:rule_based_report
#     PERMALINK=categories/shop-specials/on-sale/special-offers bin/rails taxons:make_manual
#     bin/rails taxons:make_manual_all
#
# ── why ──────────────────────────────────────────────────────────────────────
#
# The 5.6 Store API serves no taxon with `automatic = true`. Not as an empty
# list: the category endpoint answers 404 and the page renders nothing, while the
# link to it sits in his menu answering 200. See on_sale_collection.rake, where
# the same fault was found on collections/on-sale and measured on a real shop.
#
# WHICH categories are rule-based differs per shop, because it came from whatever
# each shop's owner set up years ago. Measured across the estate:
#
#   two shops   categories/shop-specials/on-sale/special-offers is ORDINARY, 7
#               and 9 products, and its page works
#   one shop    the same permalink is RULE-BASED, 12 products, and its page is
#               blank
#
# So this is not a migration bug to fix once. It is a per-shop condition to find
# and correct, which is why there is a report task beside the change.
#
# ── what changing it costs ───────────────────────────────────────────────────
#
# The rules stop being applied. A product that would have started matching later
# no longer joins on its own, and it has to be added in the admin.
#
# That is the trade the shop owner already made for the on-sale collection, in
# his words: "I think leave it once it is set". The alternative is a category in
# his navigation that shows nothing at all, which is worse for him and invisible
# to any check that only reads status codes.
#
# NOTHING IS REMOVED. The products already linked stay linked, in their order.
# The rules rows stay in the database too, so the decision is reversible with one
# UPDATE if he ever wants them back.
namespace :taxons do
  def rule_based
    Spree::Taxon.where(automatic: true)
  end

  desc 'List every rule-based category, what it holds and what serves it'
  task rule_based_report: :environment do
    found = rule_based.order(:permalink)
    if found.empty?
      puts 'no rule-based categories on this shop, so the Store API can serve all of them'
      next
    end

    puts "#{found.count} rule-based categor(ies). The Store API serves none of them:"
    found.each do |taxon|
      rules = defined?(Spree::TaxonRule) ? Spree::TaxonRule.where(taxon_id: taxon.id).count : '?'
      puts format('  %-56s %3d product(s)  %s rule(s)', taxon.permalink, taxon.products.count, rules)
    end
    puts
    puts 'PERMALINK=<one of the above> bin/rails taxons:make_manual'
    puts 'bin/rails taxons:make_manual_all   turns all of them, keeping their products'
  end

  desc 'Turn one rule-based category into an ordinary one'
  task make_manual: :environment do
    permalink = ENV['PERMALINK'].presence
    abort 'PERMALINK=<permalink> is required. Run taxons:rule_based_report first.' if permalink.nil?

    taxon = Spree::Taxon.find_by(permalink: permalink)
    abort "no category with permalink #{permalink} on this shop" if taxon.nil?

    unless taxon.automatic
      puts "#{permalink} is already an ordinary category, nothing to do"
      next
    end

    held = taxon.products.count
    # A rule-based category that currently matches nothing would become an
    # ordinary EMPTY category, which is a worse page than the one it replaces:
    # at least a rule-based one can be redirected away. Refuse and say so.
    if held.zero?
      abort "#{permalink} is rule-based and holds no products. Turning it manual " \
            'would leave an empty category. Redirect it instead, in retired-urls.json.'
    end

    # Regenerate BEFORE the flip, never after.
    #
    # The classification table for a rule-based category is a snapshot taken
    # whenever RegenerateProducts last ran, which for a database restored from the
    # client's server is whenever his server last ran it. Flipping first freezes
    # that snapshot forever, because both products_matching_rules and
    # RegenerateProducts return early once the category is manual.
    #
    # This froze special-offers on nz at 10 products while its own rule matched
    # 28. See sync_to_rules below, which is the repair for a category already
    # frozen at the wrong number.
    Spree::Taxons::RegenerateProducts.call(taxon: taxon)
    taxon.reload
    fresh = taxon.products.count

    taxon.update!(automatic: false)
    puts "#{permalink}: automatic -> false, holding #{fresh} product(s)"
    puts "  its rules were applied first: #{held} -> #{fresh}" if fresh != held
    puts 'The Store API will serve it now. Its rules are still in the database.'
  end

  # ── the order that matters, and got it wrong ───────────────────────────────
  #
  # make_manual above flips `automatic` to false and keeps whatever the
  # classification table already held. That table is NOT the rule's answer. For a
  # rule-based category Spree only refreshes it when Taxons::RegenerateProducts
  # runs, so it holds whatever that job last produced on the client's own server,
  # at whatever moment that was.
  #
  # Measured on nz on 30 Aug, after make_manual had frozen it:
  #
  #   categories/shop-specials/on-sale/special-offers   held 10
  #   its own rule, applied              matched 28
  #
  # Eighteen products on sale were missing from his sale page, and nothing was
  # broken: the page rendered, answered 200, and showed ten real products. Only
  # asking the rule what it meant found it.
  #
  # Both Spree entry points refuse to help once the flip has happened:
  #
  #   products_matching_rules   returns none        if manual?
  #   RegenerateProducts        returns immediately if manual?
  #
  # So the freeze has to happen AFTER a regeneration, never before. This applies
  # the rules directly through Spree's own rule objects, which needs no flip and
  # so cannot leave a category rule-based if it fails halfway.
  def matching_by_rules(taxon)
    return nil if taxon.rules.empty?

    all_products = taxon.store.products.not_archived

    if taxon.rules_match_policy == 'any'
      ids = taxon.rules.flat_map { |rule| rule.apply(all_products).ids }.uniq
      all_products.where(id: ids)
    else
      taxon.rules.reduce(all_products) { |scope, rule| rule.apply(scope) }
    end
  end

  def describe(product)
    sku = product.master&.sku.presence || '(no sku)'
    format('%-20s %s', sku, product.name.to_s[0, 52])
  end

  desc "Make a frozen category hold what its own rules say (APPLY=1 to write)"
  task sync_to_rules: :environment do
    only = ENV['PERMALINK'].presence
    apply = ENV['APPLY'] == '1'

    scope = Spree::Taxon.joins(:rules).distinct.order(:permalink)
    scope = scope.where(permalink: only) if only

    if scope.empty?
      puts only ? "no category #{only} with rules on this shop" : 'no category on this shop has rules'
      next
    end

    puts apply ? 'APPLYING' : 'dry run, nothing is written. Add APPLY=1 to write.'
    puts

    scope.each do |taxon|
      want = matching_by_rules(taxon)
      next if want.nil?

      want_ids = want.ids
      have_ids = taxon.classifications.pluck(:product_id)
      add = want_ids - have_ids
      remove = have_ids - want_ids

      puts format('%s  [%s, match %s]', taxon.permalink,
                  taxon.automatic? ? 'rule-based' : 'frozen', taxon.rules_match_policy)
      puts format('  holds %d, its rules match %d', have_ids.size, want_ids.size)

      # A rule that matches nothing would empty a live category. That is worse
      # than a stale one and it is never what was meant, so it is refused rather
      # than applied. Seen for real: a rule referencing a tag the client renamed.
      if want_ids.empty?
        puts '  REFUSED: the rules match no products. Emptying a live category is not a fix.'
        puts
        next
      end

      Spree::Product.where(id: add).find_each { |p| puts "  + #{describe(p)}" }
      Spree::Product.where(id: remove).find_each { |p| puts "  - #{describe(p)}" }
      puts '  already correct' if add.empty? && remove.empty?

      if apply && (add.any? || remove.any?)
        # Positions carried over for anything that stays, so his ordering of the
        # products already on the page survives.
        keep = taxon.classifications.where(product_id: want_ids).order(:position).pluck(:product_id)
        Spree::Classification.transaction do
          taxon.classifications.where(product_id: remove).delete_all
          next_position = keep.size
          rows = add.map do |product_id|
            next_position += 1
            { product_id: product_id, taxon_id: taxon.id, position: next_position,
              created_at: Time.current, updated_at: Time.current }
          end
          Spree::Classification.insert_all(rows) if rows.any?
        end
        Spree::Taxon.reset_counters(taxon.id, :classifications)
        Spree::Product.where(id: (add + remove).uniq).touch_all
        puts format('  applied: +%d, -%d, now %d', add.size, remove.size, taxon.classifications.count)
      end
      puts
    end

    puts 'nothing was written. Add APPLY=1 to write.' unless apply
  end

  desc 'Turn every rule-based category that holds products into an ordinary one'
  task make_manual_all: :environment do
    turned = []
    empty = []

    rule_based.order(:permalink).each do |taxon|
      if taxon.products.count.zero?
        empty << taxon.permalink
        next
      end
      # Same order as make_manual: apply the rules, then freeze the answer.
      Spree::Taxons::RegenerateProducts.call(taxon: taxon)
      taxon.reload
      count = taxon.products.count
      taxon.update!(automatic: false)
      turned << "#{taxon.permalink} (#{count})"
    end

    puts turned.empty? ? 'nothing to turn' : "turned #{turned.count}: #{turned.join(', ')}"
    return if empty.empty?

    puts "left alone, rule-based and empty: #{empty.join(', ')}"
    puts 'Those need a redirect in retired-urls.json, not a conversion: making them'
    puts 'manual would publish an empty category instead of a missing one.'
  end
end
