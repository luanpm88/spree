# Fill in the columns the 5.6 upgrade added and left empty.
#
#   bin/rails backfill:report     what is missing, changes nothing
#   bin/rails backfill:all        fix every gap below
#
#   bin/rails backfill:store_id    which store each row belongs to
#   bin/rails backfill:thumbnails  which image is a variant's primary one
#
# ── the pattern ──────────────────────────────────────────────────────────────
#
# Spree 5.6 denormalised two things that used to be derived, and the upgrade
# adds each column without populating it. Nothing raises, no count changes, no
# foreign key dangles. The shop simply comes up empty, and it comes up empty in
# a way that reads like a bad migration rather than a missing UPDATE.
#
# Both were found by looking at screenshots. Neither was found by the checklist,
# which asked whether the admin pages returned 200 and was told yes.
#
# ── what happened ────────────────────────────────────────────────────────────
#
# Spree 5.6 moved "which store does this belong to" from join tables onto a
# store_id column on the row itself. Spree::Product used to reach its stores
# through spree_products_stores; now the scope is simply
#
#   scope :for_store, ->(store) { where(store_id: store.id) }
#
# The upgrade adds the column and leaves it NULL. Nothing raises. The join
# tables keep their rows, so every count and every foreign key still looks
# right, and a checklist that asks "does the admin products page return 200"
# gets a cheerful yes.
#
# What the client sees is an empty shop. 89 products, 74 categories, all of the
# payment methods and all of the promotions, invisible in the admin and absent
# from the API, on a database where nothing is missing and nothing is broken.
# It was found by looking at a screenshot, not by any check.
#
# ── how the store is decided ─────────────────────────────────────────────────
#
# From the old join table wherever one exists, because that is the client's own
# answer to the question and it survives the upgrade untouched. Only where
# there is no join table does this fall back to "the single store in this
# database", and it refuses to guess at all if there is more than one.
#
# Never overwrites a store_id that is already set.
# Is the file for this asset actually on this server.
#
# NOT "is its service_name something we recognise". Every blob here carries a
# service name from the client's old install, and config/storage.yml maps all of
# them onto the same Disk directory on purpose. The name says nothing about
# whether the bytes arrived; only the service can.
def file_present?(asset)
  return false unless asset.respond_to?(:attachment) && asset.attachment.attached?

  blob = asset.attachment.blob
  blob.service.exist?(blob.key)
rescue StandardError
  false
end

namespace :backfill do
  # table => the join table that used to hold the answer, and its columns
  SOURCES = {
    'spree_products' => { join: 'spree_products_stores', fk: 'product_id' },
    'spree_payment_methods' => { join: 'spree_payment_methods_stores', fk: 'payment_method_id' },
    'spree_promotions' => { join: 'spree_promotions_stores', fk: 'promotion_id' },
    # Taxons hang off a taxonomy, and the taxonomy carries the store.
    'spree_taxons' => { parent: 'spree_taxonomies', fk: 'taxonomy_id' },
    'spree_role_users' => {}
  }.freeze

  def store_id_tables(conn)
    conn.select_values(<<~SQL)
      SELECT table_name FROM information_schema.columns
      WHERE column_name = 'store_id' AND table_schema = 'public' AND table_name LIKE 'spree_%'
      ORDER BY table_name
    SQL
  end

  def gaps(conn)
    store_id_tables(conn).filter_map do |t|
      total = conn.select_value("SELECT count(*) FROM #{conn.quote_table_name(t)}").to_i
      next if total.zero?

      nulls = conn.select_value("SELECT count(*) FROM #{conn.quote_table_name(t)} WHERE store_id IS NULL").to_i
      next if nulls.zero?

      { table: t, total: total, nulls: nulls }
    end
  end

  desc 'Report every column the upgrade left empty'
  task report: :environment do
    conn = ActiveRecord::Base.connection

    # Thumbnails first, it is one number.
    if conn.column_exists?(:spree_variants, :primary_media_id)
      blank = conn.select_value('SELECT count(*) FROM spree_variants WHERE primary_media_id IS NULL').to_i
      total = conn.select_value('SELECT count(*) FROM spree_variants').to_i
      puts blank.zero? ? "thumbnails: ok, all #{total} variants have one" :
        "thumbnails: #{blank} of #{total} variants have no primary image"
    end

    rows = gaps(conn)
    stores = conn.select_all('SELECT id, name, url FROM spree_stores ORDER BY id').to_a
    puts "#{stores.size} store(s): #{stores.map { |s| "#{s['id']} #{s['url']}" }.join(', ')}"

    if rows.empty?
      puts 'ok — every row with a store_id column has one'
      next
    end

    puts "\n#{rows.size} table(s) with rows that belong to no store:"
    rows.each do |r|
      how = if SOURCES[r[:table]]&.key?(:join) then "from #{SOURCES[r[:table]][:join]}"
            elsif SOURCES[r[:table]]&.key?(:parent) then "from #{SOURCES[r[:table]][:parent]}"
            elsif stores.size == 1 then 'the only store'
            else 'NO SOURCE — needs a decision'
            end
      puts format('  %-28s %5d of %-5d  %s', r[:table], r[:nulls], r[:total], how)
    end
    puts "\nbin/rails store_id:backfill to fix it"
  end

  desc 'Every backfill below, in order'
  task all: %i[store_id counters thumbnails orphan_variants channel]

  # ── variant records whose file never came across ───────────────────────────
  #
  # Active Storage tracks a generated thumbnail as an ActiveStorage::VariantRecord
  # row pointing at a second blob. Those rows are in his dump. The FILES behind
  # them are derived data and were never in the image mirror, so on a migrated
  # shop the row says "already generated" and the file is not there.
  #
  # What that does at request time is quiet and nasty. `representation.processed`
  # finds the record, decides there is nothing to generate, and hands back a blob
  # whose service has no file:
  #
  #   representations/redirect/...  302 to a disk URL that then 404s
  #   representations/proxy/...     404 in 4ms, no error, no log line worth reading
  #
  # It does not blank the page, which is why it survived: Next asks for several
  # widths, the ones with no variant record are generated on demand and render,
  # and only the sizes that happen to have a stale record fail. Measured on the
  # two migrated shops: 434 of 2364 records on one, 15 of 2416 on the other, and
  # zero on the five whose variants were all generated here.
  #
  # Deleting the record is safe and is the whole fix. A variant is derived from
  # the original, which is present; with the record gone the next request
  # regenerates it. Nothing of his is lost, and the original blobs are never
  # touched.
  desc 'Delete variant records whose generated file did not come across'
  task orphan_variants: :environment do
    orphans = []

    ActiveStorage::VariantRecord.includes(image_attachment: :blob).find_each do |record|
      blob = record.image_attachment&.blob
      present = blob.present? && (blob.service.exist?(blob.key) rescue false)
      orphans << record if !present
    end

    if orphans.empty?
      puts 'orphan variants: none, every variant record has its file'
      next
    end

    # Written down before anything is deleted. These rows are regenerable, so this
    # is not a restore path so much as a record of what was touched and when.
    log = Rails.root.join('tmp', "orphan_variants_#{Time.current.to_i}.txt")
    FileUtils.mkdir_p(log.dirname)
    File.write(log, orphans.map { |r| "#{r.id}\t#{r.blob_id}\t#{r.variation_digest}" }.join("\n"))

    removed = 0
    orphans.each do |record|
      # purge, not delete: it clears the attachment and the blob row together.
      # The file it tries to remove is the one that is already missing, and Disk
      # ignores that.
      record.image.purge if record.image_attachment
      record.destroy
      removed += 1
    rescue StandardError => e
      puts "  variant record #{record.id}: #{e.class}: #{e.message.to_s[0, 100]}"
    end

    puts "orphan variants: #{removed} record(s) removed, they regenerate on the next request"
    puts "  what was removed: #{log}"
  end

  # ── the channel every product has to be published to ───────────────────────
  #
  # The fifth thing 5.6 adds and leaves empty, and the only one that reaches
  # customers. 5.6 introduces channels: a product is visible to the Store API
  # only through a Spree::ProductPublication joining it to a channel. The
  # upgrade creates no channel and publishes nothing, so
  #
  #   spree_channels              0 rows
  #   spree_product_publications  0 rows
  #
  # on all seven of the client's shops, holding 353 active products between
  # them. The admin looks right, the API answers 200, and every product list is
  # empty. The storefront says "No products found" on a shop with 57 products in
  # it, which is how this was finally noticed.
  #
  # Uses Spree's own Channel#add_products so the publication rows are built the
  # way Spree builds them, and its promote_first_channel_to_default callback
  # marks the channel default without this task having to know that rule.
  desc 'Create the default channel and publish every active product to it'
  task channel: :environment do
    Spree::Store.find_each do |store|
      channel = store.channels.first
      if channel.nil?
        channel = store.channels.create!(name: 'Online Store', code: 'online-store', active: true)
        puts "channel: created '#{channel.name}' for #{store.url}"
      else
        puts "channel: '#{channel.name}' already exists for #{store.url}"
      end

      # Publish what the shop actually sells. Draft and archived products are
      # deliberately left unpublished: they are unpublished in the admin too, and
      # publishing them here would put them in front of customers.
      ids = Spree::Product.for_store(store).where(status: 'active', deleted_at: nil).pluck(:id)
      before = channel.publications.count
      channel.add_products(ids) if ids.any?
      after = channel.reload.publications.count
      puts "channel: #{after - before} product(s) published, #{after} in total"

      # Without a publishable key there is no storefront at all: every Store API
      # request answers 401. Four of the six shops had none, because the key is
      # created when a storefront is first set up and these databases predate
      # that. Created here rather than by hand so a shop cannot be published
      # with a channel and no way to read it.
      if store.api_keys.active.publishable.none?
        key = store.api_keys.create!(name: 'Storefront', key_type: 'publishable')
        puts "channel: created a publishable key for #{store.url} (#{key.token[0, 12]}…)"
      end

      # A publishable key that names no channel resolves to the default one, so
      # this is not strictly required. Bound explicitly anyway, because a key
      # tied to a channel keeps working when a second channel is added later.
      keys = store.api_keys.where(channel_id: nil)
      keys.update_all(channel_id: channel.id) if keys.any? && Spree::ApiKey.column_names.include?('channel_id')
    end
  end

  # ── counter caches ─────────────────────────────────────────────────────────
  #
  # 5.6 leans on counter columns for decisions, not merely for display. The one
  # that matters here is media_count: Spree::Product#has_media? reads it rather
  # than counting images, and find_variant_for_images returns nil when it says
  # zero. So a product with four images that load perfectly well shows a
  # placeholder everywhere, because a column says it has none.
  #
  # The columns are found by introspection rather than listed, because a list
  # written today is wrong at the next upgrade and wrong silently. Every
  # has_many whose child declares counter_cache gets reset through Rails' own
  # reset_counters, so the definition of each count stays Spree's.
  desc 'Recompute every counter cache the upgrade left at zero'
  task counters: :environment do
    Rails.application.eager_load!

    pairs = []
    ActiveRecord::Base.descendants.each do |klass|
      next unless klass.table_exists?
      next if klass.abstract_class?

      klass.reflect_on_all_associations(:has_many).each do |hm|
        child = begin
          hm.klass
        rescue StandardError
          next
        end
        back = child.reflect_on_all_associations(:belongs_to)
                    .find { |b| b.options[:counter_cache] && b.klass == klass rescue false }
        pairs << [klass, hm.name] if back
      end
    end
    pairs.uniq!

    # ── taxon counters ──────────────────────────────────────────────────────
    #
    # The sixth thing the upgrade leaves wrong, and the second that reaches
    # customers. spree_taxons.products_count and classification_count are kept by
    # Spree's own callbacks, not by a Rails counter_cache, so the introspection
    # above cannot see them and a restored dump never runs them.
    #
    # On the client's NZ shop 72 of 87 categories sat at products_count = 0 while
    # having products: eco-values/non-toxic said 0 and had 37. The Store API
    # filters categories on that number, so two thirds of his navigation was
    # invisible, and collections/on-sale, a carousel on his own home page, did
    # not exist as far as the API was concerned.
    #
    # Spree's own recalculate_products_count is used rather than a COUNT(*),
    # because the stored number is descendant INCLUSIVE: a parent counts the
    # products of every category beneath it, which a plain count gets wrong on
    # every category that has children.
    if defined?(Spree::Taxon) && Spree::Taxon.table_exists?
      ids = Spree::Taxon.pluck(:id)
      if ids.any?
        before = Spree::Taxon.where(products_count: 0).count
        if Spree::Taxon.respond_to?(:recalculate_products_count)
          Spree::Taxon.recalculate_products_count(ids)
        end
        if Spree::Taxon.reflect_on_association(:classifications)
          Spree::Taxon.reset_counters(ids, :classifications) rescue nil
        end
        after = Spree::Taxon.where(products_count: 0).count
        puts "taxons: #{before - after} category counter(s) corrected, #{after} still empty"
      end
    end

    # media_count is not a Rails counter_cache, so the introspection above never
    # sees it. Spree::Asset maintains it with after_create and after_destroy
    # callbacks, and a restored dump inserts rows without ever running those, so
    # it sits at zero on every row of a migrated shop.
    #
    # Recomputed, not incremented, so it is safe to run twice. The rule is taken
    # from Spree::Asset#increment_viewable_media_count: an asset on a variant
    # counts for that variant AND for its product; an asset on a product counts
    # for the product.
    conn = ActiveRecord::Base.connection
    if conn.column_exists?(:spree_variants, :media_count)
      conn.update(<<~SQL)
        UPDATE spree_variants v SET media_count = COALESCE(c.n, 0)
        FROM (SELECT id FROM spree_variants) all_v
        LEFT JOIN (
          SELECT viewable_id AS id, count(*) AS n FROM spree_assets
          WHERE viewable_type = 'Spree::Variant' GROUP BY 1
        ) c ON c.id = all_v.id
        WHERE v.id = all_v.id AND v.media_count IS DISTINCT FROM COALESCE(c.n, 0)
      SQL
      fixed = conn.select_value('SELECT count(*) FROM spree_variants WHERE media_count > 0')
      puts "  Spree::Variant                     media_count: #{fixed} row(s) now non-zero"
    end

    if conn.column_exists?(:spree_products, :media_count)
      conn.update(<<~SQL)
        UPDATE spree_products p SET media_count = COALESCE(c.n, 0)
        FROM (SELECT id FROM spree_products) all_p
        LEFT JOIN (
          SELECT pid, sum(n) AS n FROM (
            SELECT v.product_id AS pid, count(*) AS n
            FROM spree_assets a JOIN spree_variants v ON v.id = a.viewable_id
            WHERE a.viewable_type = 'Spree::Variant' GROUP BY 1
            UNION ALL
            SELECT a.viewable_id AS pid, count(*) AS n
            FROM spree_assets a WHERE a.viewable_type = 'Spree::Product' GROUP BY 1
          ) counted GROUP BY 1   -- not `both`, which postgres reserves for trim(both ...)
        ) c ON c.pid = all_p.id
        WHERE p.id = all_p.id AND p.media_count IS DISTINCT FROM COALESCE(c.n, 0)
      SQL
      fixed = conn.select_value('SELECT count(*) FROM spree_products WHERE media_count > 0')
      puts "  Spree::Product                     media_count: #{fixed} row(s) now non-zero"
    end

    puts "#{pairs.size} counter cache(s) to check"
    pairs.each do |klass, assoc|
      column = klass.reflect_on_association(assoc).klass
                    .reflect_on_all_associations(:belongs_to)
                    .find { |b| b.options[:counter_cache] && (b.klass == klass rescue false) }
      counter = column&.options&.dig(:counter_cache)
      counter = "#{assoc}_count" if counter == true || counter.nil?
      next unless klass.column_names.include?(counter.to_s)

      stale = klass.where(counter => 0).count
      next if stale.zero?

      # One at a time through reset_counters: it is Rails' own implementation,
      # so a counter with a scope or a custom column stays correct.
      klass.where(counter => 0).pluck(:id).each { |id| klass.reset_counters(id, assoc) }
      fixed = stale - klass.where(counter => 0).count
      puts format('  %-34s %s: %d of %d were zero, %d corrected',
                  klass.name, counter, stale, klass.count, fixed)
    end
  end

  # ── which image represents a variant ───────────────────────────────────────
  #
  # 5.6 put a primary_media_id on spree_variants instead of working out the
  # first image by position on every render. The upgrade leaves it NULL on every
  # row, so the admin product list, the API and the storefront all show a
  # placeholder for products whose images are attached, present on disk and
  # perfectly readable — as they were here, 4 of 4 loading on the edit page and
  # none in the list.
  #
  # update_thumbnail! is Spree's own method for this, so the rule for what
  # counts as "first" stays theirs and keeps working when it changes.
  # Variants AND products. Both carry their own primary_media_id and both have
  # their own update_thumbnail!, and doing only the variants gets you a shop
  # where every product page shows its photographs and every product LIST shows
  # placeholders, because the list reads the product's column and the page walks
  # to the variant.
  #
  # Products last: Spree::Product#update_thumbnail! reaches its image through
  # find_variant_for_images, which consults has_media?, which reads media_count.
  # Run this before backfill:counters and it fills in nothing at all while
  # reporting success.
  desc 'Point each variant and product at its first image'
  task thumbnails: :environment do
    [Spree::Variant, Spree::Product].each do |klass|
      next unless klass.column_names.include?('primary_media_id')

      scope = klass.where(primary_media_id: nil)
      total = scope.count
      if total.zero?
        puts "thumbnails: #{klass.name} nothing to do"
        next
      end

      filled = 0
      scope.find_each do |record|
        record.update_thumbnail!
        filled += 1 if record.reload.primary_media_id
      end
      puts "thumbnails: #{klass.name} #{filled} of #{total} now have a primary image"
      # The rest genuinely have no image at all, which is the client's own data
      # and not something to invent a fix for.
      puts "  #{total - filled} have no image to point at" if filled < total
    end

    Rake::Task['backfill:usable_thumbnails'].invoke
  end

  # ── point at an image that is actually there ───────────────────────────────
  #
  # update_thumbnail! picks the first image by position, and does not care
  # whether the file behind it exists. On a shop whose images came from a
  # storage service this install cannot reach, that is a 500 per thumbnail:
  # Rails raises KeyError for the missing service while rendering a list, and
  # 22 of them landed on one page of the admin.
  #
  # So prefer the first image whose blob is on local disk, and only fall back to
  # NULL — a placeholder — when none of a product's images came across. Nothing
  # is deleted: every asset row stays exactly where it was, ready for the files
  # when the old server is reachable again.
  desc 'Prefer a primary image whose file exists'
  #
  # ── what this got wrong, and what it cost ───────────────────────────────────
  #
  # The first version decided an image was missing with
  #
  #     WHERE ab.service_name <> 'local'
  #
  # On this estate NO blob is on a service called 'local'. His rows carry 'mirror'
  # or 'minio', and config/storage.yml declares both as Disk pointing at the SAME
  # directory as local, deliberately, so that his service names resolve without an
  # UPDATE across his data.
  #
  # So the query called every image broken, blanked primary_media_id on every
  # product, and printed "160 left blank, no image of theirs came across" as though
  # it had found something. thumbnail_url is built from primary_media, so the API
  # returned null, the storefront rendered no img tag at all, and the client opened
  # his own shop and found grey boxes where his products should be. He said
  # "frontend is all blank for me" and he was right.
  #
  # It even undid itself: backfill:thumbnails filled 78 of 78, then this ran in the
  # same `backfill:all` and emptied all 78, and the pair of messages read like
  # success followed by a note.
  #
  # A service NAME cannot answer "is the file there". Only the service can, so ask
  # it. This is slower, and it is the difference between a shop with photographs
  # and a shop without.
  task usable_thumbnails: :environment do
    repointed = 0
    blanked = 0

    { Spree::Variant => :variant, Spree::Product => :product }.each_key do |klass|
      next unless klass.column_names.include?('primary_media_id')

      klass.where.not(primary_media_id: nil).find_each do |record|
        current = Spree::Asset.find_by(id: record.primary_media_id)
        next if current && file_present?(current)

        # Its own images, in the order the shop shows them, first one whose file
        # is actually here.
        candidates =
          if klass == Spree::Variant
            Spree::Asset.where(viewable: record).order(:position, :id)
          else
            Spree::Asset.where(viewable: record.variants_including_master).order(:position, :id)
          end

        replacement = candidates.detect { |a| file_present?(a) }

        if replacement
          record.update_column(:primary_media_id, replacement.id)
          repointed += 1
        else
          record.update_column(:primary_media_id, nil)
          blanked += 1
        end
      end
    end

    puts "usable thumbnails: #{repointed} repointed to an image that exists"
    puts "  #{blanked} blanked, no file for any of their images" if blanked.positive?
  end

  desc 'Fill in store_id from the join tables the upgrade left behind'
  task store_id: :environment do
    conn = ActiveRecord::Base.connection
    stores = conn.select_all('SELECT id FROM spree_stores ORDER BY id').to_a
    abort 'no stores in this database' if stores.empty?
    only_store = stores.size == 1 ? stores.first['id'] : nil

    gaps(conn).each do |r|
      t = conn.quote_table_name(r[:table])
      src = SOURCES[r[:table]] || {}
      filled = 0

      if src[:join] && conn.table_exists?(src[:join])
        # The client's own answer, carried in the join table the upgrade kept.
        # DISTINCT ON so a product listed against two stores picks one
        # deterministically rather than making the UPDATE ambiguous.
        j = conn.quote_table_name(src[:join])
        filled = conn.update(<<~SQL)
          UPDATE #{t} SET store_id = j.store_id
          FROM (SELECT DISTINCT ON (#{src[:fk]}) #{src[:fk]} AS fk, store_id
                FROM #{j} WHERE store_id IS NOT NULL ORDER BY #{src[:fk]}, store_id) j
          WHERE #{t}.id = j.fk AND #{t}.store_id IS NULL
        SQL
      elsif src[:parent] && conn.table_exists?(src[:parent])
        p = conn.quote_table_name(src[:parent])
        filled = conn.update(<<~SQL)
          UPDATE #{t} SET store_id = p.store_id
          FROM #{p} p
          WHERE #{t}.#{src[:fk]} = p.id AND p.store_id IS NOT NULL AND #{t}.store_id IS NULL
        SQL
      end

      # Whatever the join table could not answer. Only safe with one store; with
      # several, picking one would put a client's products in the wrong shop,
      # which is worse than leaving them visible nowhere and saying so.
      remaining = conn.select_value("SELECT count(*) FROM #{t} WHERE store_id IS NULL").to_i
      if remaining.positive?
        if only_store
          filled += conn.update("UPDATE #{t} SET store_id = #{only_store} WHERE store_id IS NULL")
        else
          puts format('  %-28s %5d row(s) LEFT ALONE — %d stores, no join table to say which',
                      r[:table], remaining, stores.size)
        end
      end

      puts format('  %-28s %5d filled', r[:table], filled)
    end

    left = gaps(conn)
    if left.empty?
      puts "\nok — every row now belongs to a store"
    else
      puts "\nstill unassigned:"
      left.each { |r| puts format('  %-28s %5d of %d', r[:table], r[:nulls], r[:total]) }
      exit 1
    end
  end
end
