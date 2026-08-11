# Run every pending migration ONE AT A TIME against a copy of a client database, and
# report what happened to each, instead of stopping at the first failure.
#
#   DATABASE_URL=postgres://…/nz_migrate bin/rails rehearsal:migrate
#
# Why not db:migrate: it aborts on the first error, so a schema that is going to hit
# twenty problems reveals exactly one per run. This keeps going and produces the whole
# map in a single pass, which is the difference between "it failed" and "here is the
# work".
#
# Three outcomes per migration:
#
#   ran      applied cleanly
#   already  its effect is already present (table exists, column exists). Recorded as
#            applied so later migrations that depend on it are not blocked.
#   FAILED   something else. These are the real findings.
#
# NEVER point this at a live database. It migrates in place.
namespace :rehearsal do
  # Errors meaning "this has already been done". Recognised by message rather than by
  # class, because Rails wraps them all in StatementInvalid.
  ALREADY = [
    /already exists/i,
    /relation .* already exists/i,
    /column .* of relation .* already exists/i,
    /duplicate column/i
  ].freeze

  desc 'Fix what stops the 5.6 migrations before running them'
  task cleanup: :environment do
    abort 'refusing to run without DATABASE_URL set explicitly' if ENV['DATABASE_URL'].blank?
    conn = ActiveRecord::Base.connection

    # 5.6 puts a unique index on (slug, sluggable_type, locale) in friendly_id_slugs.
    # The nz shop has six groups that violate it, and every one is a live record
    # colliding with slugs left behind by DELETED taxons. friendly_id keeps historical
    # slugs so old URLs keep working, but it does not remove them when the record goes,
    # so they accumulate and eventually block the index.
    #
    # Deleting orphans only. Checked before writing this: no group contains two LIVE
    # records, so nothing that still exists loses a slug or a working URL.
    orphans = conn.select_value(<<~SQL)
      SELECT count(*) FROM friendly_id_slugs f
      LEFT JOIN spree_taxons   t ON f.sluggable_type='Spree::Taxon'   AND t.id=f.sluggable_id
      LEFT JOIN spree_products p ON f.sluggable_type='Spree::Product' AND p.id=f.sluggable_id
      WHERE (f.sluggable_type='Spree::Taxon'   AND t.id IS NULL)
         OR (f.sluggable_type='Spree::Product' AND p.id IS NULL)
    SQL

    if orphans.to_i.zero?
      puts 'friendly_id_slugs: no orphans'
    else
      # Refuse rather than guess if two live records share a slug. That is a decision
      # about which URL the client keeps, not something to resolve silently.
      live_dupes = conn.select_value(<<~SQL)
        WITH live AS (
          SELECT f.* FROM friendly_id_slugs f
          LEFT JOIN spree_taxons   t ON f.sluggable_type='Spree::Taxon'   AND t.id=f.sluggable_id
          LEFT JOIN spree_products p ON f.sluggable_type='Spree::Product' AND p.id=f.sluggable_id
          WHERE (f.sluggable_type='Spree::Taxon'   AND t.id IS NOT NULL)
             OR (f.sluggable_type='Spree::Product' AND p.id IS NOT NULL)
             OR f.sluggable_type NOT IN ('Spree::Taxon','Spree::Product'))
        SELECT count(*) FROM (
          SELECT slug, sluggable_type, locale FROM live GROUP BY 1,2,3 HAVING count(*)>1) x
      SQL
      abort "#{live_dupes} slug collisions between records that BOTH still exist. Needs a human decision." if live_dupes.to_i.positive?

      conn.execute(<<~SQL)
        DELETE FROM friendly_id_slugs f
        USING (SELECT f2.id FROM friendly_id_slugs f2
               LEFT JOIN spree_taxons   t ON f2.sluggable_type='Spree::Taxon'   AND t.id=f2.sluggable_id
               LEFT JOIN spree_products p ON f2.sluggable_type='Spree::Product' AND p.id=f2.sluggable_id
               WHERE (f2.sluggable_type='Spree::Taxon'   AND t.id IS NULL)
                  OR (f2.sluggable_type='Spree::Product' AND p.id IS NULL)) d
        WHERE f.id = d.id
      SQL
      puts "friendly_id_slugs: removed #{orphans} orphaned slugs, no live record affected"
    end

    # BackfillFriendlyIdSlugLocale does this:
    #
    #   FriendlyId::Slug.unscoped.update_all(locale: Spree::Store.default.default_locale)
    #
    # Every slug row, one locale, no condition. It exists to fill in NULLs on shops
    # that predate locale-aware slugs. Run it on a shop that already has correct
    # locales and it flattens them: the nz shop has 313 en-NZ and 184 en rows and not
    # one NULL, so it would rewrite all 184 en slugs to en-NZ, collide against the new
    # unique index, and destroy every English URL on the way.
    #
    # Skipped only when the data proves it is unnecessary. If there are NULL locales
    # the migration is doing its job and is left alone.
    nulls = conn.select_value("SELECT count(*) FROM friendly_id_slugs WHERE locale IS NULL").to_i
    version = '20260317146000'
    if nulls.positive?
      puts "friendly_id_slugs: #{nulls} rows have no locale, leaving the backfill to run"
    elsif conn.select_value("SELECT count(*) FROM schema_migrations WHERE version='#{version}'").to_i.positive?
      puts 'BackfillFriendlyIdSlugLocale: already recorded'
    else
      locales = conn.select_all("SELECT locale, count(*) c FROM friendly_id_slugs GROUP BY 1 ORDER BY 2 DESC").to_a
      conn.execute("INSERT INTO schema_migrations (version) VALUES ('#{version}') ON CONFLICT DO NOTHING")
      puts "BackfillFriendlyIdSlugLocale: SKIPPED. No NULL locales, and it would overwrite " \
           "#{locales.map { |r| "#{r['c']} #{r['locale']}" }.join(', ')}"
    end
  end

  desc 'Apply pending migrations one at a time and report each outcome'
  task migrate: :environment do
    db = ActiveRecord::Base.connection.current_database
    abort 'refusing to run without DATABASE_URL set explicitly' if ENV['DATABASE_URL'].blank?
    puts "database: #{db}"
    puts "tables before: #{table_count}"
    puts ''

    ctx = ActiveRecord::MigrationContext.new(ActiveRecord::Migrator.migrations_paths)

    ran = []
    already = []
    failed = []

    # Repeat until a pass achieves nothing. Some migrations need a table that a LATER
    # migration creates, so one ordered pass reports failures that are only sequencing:
    # BackfillFriendlyIdSlugLocale wants spree_markets, which is created further down
    # the list. Looping resolves those without anyone deciding by hand what to retry.
    pass = 0
    loop do
      pass += 1
      applied = ActiveRecord::Base.connection.select_values('select version from schema_migrations').map(&:to_s).to_set
      pending = ctx.migrations.reject { |m| applied.include?(m.version.to_s) }
      break if pending.empty?

      puts "pass #{pass}: #{pending.size} pending"
      progress_before = ran.size + already.size
      failed = []

      pending.each do |m|
        ActiveRecord::Base.connection.transaction(requires_new: true) do
          ActiveRecord::Migration.suppress_messages { m.migrate(:up) }
        end
        mark(m.version)
        ran << m
        print '.'
      rescue StandardError => e
        msg = e.message.to_s.lines.first.to_s.strip
        if ALREADY.any? { |re| msg =~ re }
          mark(m.version)
          already << [m, msg]
          print 'o'
        else
          failed << [m, msg]
          print 'x'
        end
      end

      puts ''
      # No progress means the rest are genuinely stuck, not merely out of order.
      break if (ran.size + already.size) == progress_before
    end

    puts ''
    puts "ran      #{ran.size}"
    puts "already  #{already.size}"
    puts "FAILED   #{failed.size}"
    puts "tables after: #{table_count}"

    unless failed.empty?
      puts ''
      puts 'FAILURES'
      failed.each { |m, msg| puts "  #{m.version} #{m.name}\n    #{msg[0, 160]}" }
    end

    puts ''
    puts 'DATA AFTER'
    %w[spree_orders spree_products spree_users spree_line_items].each do |t|
      next unless ActiveRecord::Base.connection.table_exists?(t)
      puts format('  %-22s %s', t, ActiveRecord::Base.connection.select_value("select count(*) from #{t}"))
    end
  end

  def table_count
    ActiveRecord::Base.connection.select_value(
      "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"
    )
  end

  # Recorded even for "already" so that a later migration depending on this one is not
  # re-run forever. The schema is what matters, not who created it.
  def mark(version)
    ActiveRecord::Base.connection.execute(
      "insert into schema_migrations (version) values ('#{version}') on conflict do nothing"
    )
  end
end
