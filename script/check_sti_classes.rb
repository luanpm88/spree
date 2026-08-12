# Find every class his data points at that this Spree does not have.
#
#   DATABASE_URL=postgres://…/nz_migrate bin/rails runner script/check_sti_classes.rb
#
# Run this against EVERY shop's dump before migrating it. A missing STI class does not
# degrade into a blank field: ActiveRecord raises SubclassNotFound the moment anything
# loads the row. That is how 28 nz orders turned out to be unreadable on 5.6.1, and it was
# found by accident while rendering an email. Accident is not a strategy.
#
# ── read the output carefully, it over-reports on purpose ──────────────────────
#
# A missing class only matters if a LIVE row points at it. Spree soft-deletes, and the nz
# shop's "Standard Postage" carries ELEVEN calculator rows of which ten have deleted_at
# set. Counting distinct type values therefore claimed four missing shipping calculators
# and nearly contradicted a correct earlier finding; has_one resolves to the single live
# row, which we do have the code for.
#
# So this script answers "which classes are referenced at all". Deciding whether each one
# breaks anything means asking which row the association actually picks.

conn = ActiveRecord::Base.connection
tables = conn.tables.select { |t| conn.columns(t).any? { |c| c.name == 'type' } }.sort

puts "  #{tables.size} tables carry an STI type column"
puts

missing = []
tables.each do |t|
  rows = conn.select_all(
    "SELECT type, count(*) AS n FROM #{conn.quote_table_name(t)} WHERE type IS NOT NULL GROUP BY type ORDER BY 1"
  )
  next if rows.count.zero?

  bad = rows.filter_map do |r|
    klass = r['type'].to_s
    next if klass.empty?

    resolved = begin
      klass.safe_constantize
    rescue StandardError
      nil
    end
    [klass, r['n']] if resolved.nil?
  end

  puts format('  %-42s %-4s %s', t, rows.count, bad.any? ? 'MISSING' : 'ok')
  bad.each { |k, n| missing << [t, k, n] }
end

puts
if missing.empty?
  puts '  Every STI class in this database exists in this Spree.'
else
  puts "  #{missing.size} class(es) referenced here and absent from this Spree:"
  missing.each { |t, k, n| puts format('      %-46s %-24s rows=%s', k, "(#{t})", n) }
  puts
  puts '  Next question for each: does a LIVE row point at it, and which row does the'
  puts '  association actually resolve to? Only then is it a break.'
end
