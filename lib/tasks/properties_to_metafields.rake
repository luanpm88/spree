# Carry product properties across to metafields.
#
#   bin/rails properties:export FILE=tmp/properties.json    # on the OLD schema
#   bin/rails properties:import FILE=tmp/properties.json    # on the NEW schema
#   bin/rails properties:verify FILE=tmp/properties.json    # prove nothing was lost
#
# Spree 5.6 removed Spree::Property and Spree::ProductProperty. Metafields replace
# them, with a different table and a different shape, and no conversion ships with
# the release. A migration that ignores this drops every product specification
# without raising anything: the tables simply are not there afterwards.
#
# Split into export and import ON PURPOSE. The two schemas may never coexist, since
# the upgrade can drop the old tables in the same run that creates the new ones, so a
# single in-place task would have nowhere to stand. A file in between also means the
# export can be taken from a copy, checked by eye, and imported later.
#
# Raw SQL on the export side because Spree::Property no longer exists to model it.
namespace :properties do
  # NOT under tmp/. In the docker setup tmp/ is a named volume that shadows the bind
  # mount, so a file written there vanishes with a `run --rm` container and never
  # appears on the host. See docs/DISCOVERIES.md.
  DEFAULT_FILE = 'db/properties.json'.freeze

  desc 'Export product properties to JSON (run against the OLD schema)'
  task export: :environment do
    file = ENV.fetch('FILE', DEFAULT_FILE)
    conn = ActiveRecord::Base.connection

    unless conn.table_exists?('spree_product_properties')
      abort 'spree_product_properties does not exist here. Run this against the old schema.'
    end

    # Slug as well as id. Ids survive an in-place migration, but not an export into a
    # freshly built shop, and matching on the wrong one silently attaches a product's
    # specifications to a different product.
    rows = conn.select_all(<<~SQL).to_a
      SELECT pr.id           AS product_id,
             pr.slug         AS product_slug,
             pr.name         AS product_name,
             p.name          AS property_name,
             p.presentation  AS property_presentation,
             pp.value        AS value,
             pp.position     AS position
      FROM spree_product_properties pp
      JOIN spree_properties p ON p.id = pp.property_id
      JOIN spree_products  pr ON pr.id = pp.product_id
      WHERE pr.deleted_at IS NULL
      ORDER BY pr.id, pp.position, p.name
    SQL

    payload = {
      'exported_at' => Time.current.utc.iso8601,
      'source' => conn.current_database,
      'counts' => {
        'rows' => rows.size,
        'products' => rows.map { |r| r['product_id'] }.uniq.size,
        'properties' => rows.map { |r| r['property_name'] }.uniq.size
      },
      'rows' => rows
    }

    FileUtils.mkdir_p(File.dirname(file))
    File.write(file, JSON.pretty_generate(payload))
    puts "exported #{rows.size} properties on #{payload['counts']['products']} products " \
         "across #{payload['counts']['properties']} types -> #{file}"
  end

  desc 'Import the JSON into metafields (run against the NEW schema)'
  task import: :environment do
    file = ENV.fetch('FILE', DEFAULT_FILE)
    abort "no such file: #{file}" unless File.exist?(file)
    payload = JSON.parse(File.read(file))
    rows = payload.fetch('rows')

    # LongText, not ShortText. Their values run to 485 characters and nearly all of
    # them are multi-line bullet lists; ShortText is for a word or two.
    type = 'Spree::Metafields::LongText'
    # 'properties', because that is the namespace the client's own half-finished
    # conversion already used. Inventing a new one produced a second copy of every
    # value sitting beside the first, which is worse than not converting at all.
    namespace = ENV.fetch('METAFIELD_NAMESPACE', 'properties')

    definitions = {}
    created_defs = 0
    rows.map { |r| [r['property_name'], r['property_presentation']] }.uniq.each do |name, presentation|
      key = name.to_s.parameterize.underscore
      d = Spree::MetafieldDefinition.find_or_initialize_by(key: key, namespace: namespace,
                                                          resource_type: 'Spree::Product')
      if d.new_record?
        d.assign_attributes(name: presentation.presence || name, metafield_type: type, display_on: 'both')
        d.save!
        created_defs += 1
      end
      definitions[name] = d
    end

    created = 0
    updated = 0
    missing = []

    rows.each do |r|
      # Slug first. An in-place migration keeps ids, but an import into a shop built
      # separately will not, and a wrong match is worse than a miss because it is silent.
      product = Spree::Product.find_by(slug: r['product_slug']) || Spree::Product.find_by(id: r['product_id'])
      if product.nil?
        missing << "#{r['product_slug']} (#{r['product_name']})"
        next
      end

      d = definitions.fetch(r['property_name'])
      m = Spree::Metafield.find_or_initialize_by(metafield_definition_id: d.id,
                                                 resource_type: 'Spree::Product',
                                                 resource_id: product.id)
      was_new = m.new_record?
      m.type = type
      m.value = r['value']
      m.save!
      was_new ? created += 1 : updated += 1
    end

    puts "definitions: #{created_defs} created, #{definitions.size} in total"
    puts "metafields:  #{created} created, #{updated} updated"
    # created vs updated is the whole story on a shop that already converted part of
    # this by hand: created is the gap nobody knew about, updated is what was already
    # there. Reported separately for that reason.
    puts "  #{created} of these had no metafield at all before this ran" if created.positive?
    unless missing.empty?
      puts "MISSING PRODUCTS (#{missing.uniq.size}):"
      missing.uniq.first(20).each { |m| puts "  #{m}" }
    end
  end

  desc 'Verify every exported property landed, product by product'
  task verify: :environment do
    file = ENV.fetch('FILE', DEFAULT_FILE)
    abort "no such file: #{file}" unless File.exist?(file)
    rows = JSON.parse(File.read(file)).fetch('rows')

    ok = 0
    bad = []
    rows.each do |r|
      product = Spree::Product.find_by(slug: r['product_slug']) || Spree::Product.find_by(id: r['product_id'])
      key = r['property_name'].to_s.parameterize.underscore
      d = Spree::MetafieldDefinition.find_by(key: key, resource_type: 'Spree::Product')
      m = d && product && Spree::Metafield.find_by(metafield_definition_id: d.id,
                                                   resource_type: 'Spree::Product', resource_id: product.id)
      # Compare the VALUE, not merely that a row exists. A metafield that arrived
      # empty would otherwise count as success.
      if m && m.value.to_s == r['value'].to_s
        ok += 1
      else
        bad << "#{r['product_slug']} / #{key}: #{m ? 'value differs' : 'missing'}"
      end
    end

    puts "verified #{ok}/#{rows.size} properties"
    if bad.empty?
      puts 'ok — every exported property is present with the same value'
    else
      puts "#{bad.size} problem(s):"
      bad.first(25).each { |b| puts "  #{b}" }
      exit 1
    end
  end
end
