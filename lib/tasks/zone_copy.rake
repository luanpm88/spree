# Copy one shop's shipping zones onto this shop, from a file.
#
#     DUMP_TAKEN=1 ZONES=tmp/nolocal_zones.json bin/rails zones:import
#     ZONES=tmp/nolocal_zones.json bin/rails zones:report     # read only
#
# ── why this exists ──────────────────────────────────────────────────────────
#
# His international calculators look their rates up by ZONE NAME:
#
#     zone_name = Spree::Zone.match(package.order.ship_address)&.name&.upcase
#     GLOBAL_RATES[zone_name] || GLOBAL_RATES["UNITED_KINGDOM"]
#
# There is no error path for a miss. A zone named "Saudi Arabia" upcases to
# "SAUDI ARABIA", misses the "SAUDI_ARABIA" key, and the customer is quoted UK
# freight. Nothing logs and the number looks entirely real.
#
# Measured on 24 August: one shop had 33 of its 34 zones matching. Another had
# none of them, still carrying the nine continental defaults, so every rate in
# its table was unreachable. His instruction was to copy the working set across.
#
# ── what it will not do ──────────────────────────────────────────────────────
#
# It never deletes a zone and never removes a country from one. A zone he has
# edited by hand keeps its members; only missing ones are added, and only
# missing zones are created. His words on why that matters: "sometimes we have
# countries we can't deliver to for many reasons, so we just remove them from
# this list without deleting the whole zone." Removing anything here would undo
# exactly that work.
#
# ── the dump guard ───────────────────────────────────────────────────────────
#
# DUMP_TAKEN=1 is required. This writes to his database, and a dump is the only
# thing that makes a mistake here recoverable. `zones:report` needs no guard and
# changes nothing, so the shape of the change can always be read before it runs.

require 'json'

namespace :zones do
  def zones_payload
    path = ENV['ZONES'].to_s
    abort '  ZONES=<file.json> is required (export it from the source shop)' if path.empty?
    abort "  #{path} does not exist" unless File.exist?(path)
    JSON.parse(File.read(path))
  end

  # The aggregate zone carries the source shop's NAME in it, and copying that
  # verbatim would put another shop's name in this shop's admin. That is the
  # exact class of mistake this project keeps finding: another shop's wording,
  # another shop's logo, another shop's footer. So the shop word is swapped and
  # the change is reported, rather than done silently either way.
  def local_name(name, source_shop)
    shop = ENV['SHOP'].to_s.strip
    return name if shop.empty? || source_shop.to_s.empty?
    name.sub(/\b#{Regexp.escape(source_shop)}\b/i, shop)
  end

  def plan(payload)
    source = payload['source_shop'].to_s
    payload['zones'].map do |z|
      name = local_name(z['name'], source)
      existing = Spree::Zone.find_by('lower(name) = ?', name.downcase)
      wanted = z['countries'] || []
      have = existing ? existing.countries.pluck(:iso) : []
      missing_countries = wanted - have
      unknown = wanted.reject { |iso| Spree::Country.exists?(iso: iso) }
      {
        source_name: z['name'], name: name, description: z['description'],
        existing: existing, wanted: wanted, missing: missing_countries, unknown: unknown
      }
    end
  end

  desc 'Show what zones:import would do, changing nothing'
  task report: :environment do
    rows = plan(zones_payload)
    puts "  shop: #{ENV['SHOP'].presence || '(SHOP unset)'}"
    puts
    create = rows.reject { |r| r[:existing] }
    touch  = rows.select { |r| r[:existing] && r[:missing].any? }
    same   = rows.select { |r| r[:existing] && r[:missing].empty? }
    rows.each do |r|
      state = if r[:existing].nil? then 'create'
              elsif r[:missing].any? then 'add   '
              else 'ok    '
              end
      note = r[:source_name] == r[:name] ? '' : "  (renamed from #{r[:source_name]})"
      extra = r[:missing].any? ? "  + #{r[:missing].join(',')}" : ''
      bad = r[:unknown].any? ? "  UNKNOWN ISO: #{r[:unknown].join(',')}" : ''
      kind_note = ''
      if r[:existing]
        types = r[:existing].zone_members.map(&:zoneable_type).uniq
        want_kind = types == ['Spree::Country'] ? 'country' : (types == ['Spree::State'] ? 'state' : nil)
        kind_note = "  KIND=#{r[:existing].kind} but members are #{types.join(',')}" if want_kind && r[:existing].kind != want_kind
      end
      puts format('  %s %-26s %-24s%s%s%s%s', state, r[:name], r[:description].to_s, extra, note, bad, kind_note)
    end
    puts
    puts "  #{create.size} to create, #{touch.size} to add countries to, #{same.size} already correct"
    unknown = rows.flat_map { |r| r[:unknown] }.uniq
    puts "  #{unknown.size} iso code(s) this database does not know: #{unknown.join(', ')}" if unknown.any?
  end

  desc 'Create any missing zones and add any missing countries. Never removes.'
  task import: :environment do
    unless ENV['DUMP_TAKEN'] == '1'
      abort <<~MSG
        Refusing to run without DUMP_TAKEN=1.

        This writes to the client's database. Take a dump first and prove it
        reads back:

          docker exec estate-postgres pg_dump -U postgres -Fc <db> > <file>
          docker exec -i estate-postgres pg_restore -l < <file> | head

        Then re-run with DUMP_TAKEN=1. `bin/rails zones:report` shows the whole
        change and needs no guard.
      MSG
    end

    rows = plan(zones_payload)
    created = 0
    added = 0

    ActiveRecord::Base.transaction do
      rows.each do |r|
        if r[:unknown].any?
          puts format('  skip   %-26s iso unknown here: %s', r[:name], r[:unknown].join(','))
          next
        end

        zone = r[:existing]
        if zone.nil?
          # kind, explicitly. Spree's column defaults to "state", and a zone
          # created without it while holding COUNTRY members breaks the admin's
          # edit page: the form asks each member which country it belongs to,
          # and a country has no country. 34 zones shipped that way on 24 Aug
          # and the client found it, because every check here reads the members
          # directly and never looks at the kind.
          zone = Spree::Zone.create!(name: r[:name], description: r[:description], kind: 'country')
          created += 1
          puts format('  create %-26s %s', r[:name], r[:description].to_s)
        elsif zone.description.to_s.strip.empty? && r[:description].present?
          # Only fills a blank one. His descriptions carry the delivery estimate
          # the customer sees, so overwriting one he has edited would be silent
          # data loss.
          zone.update!(description: r[:description])
          puts format('  desc   %-26s %s', r[:name], r[:description].to_s)
        end

        r[:missing].each do |iso|
          country = Spree::Country.find_by(iso: iso)
          zone.zone_members.create!(zoneable: country)
          added += 1
        end
        puts format('  add    %-26s %s', r[:name], r[:missing].join(',')) if r[:missing].any?
      end
    end

    puts
    puts "  #{created} zone(s) created, #{added} country membership(s) added, nothing removed"
  end
end
