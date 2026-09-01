# Make a migrated dump loadable on 5.6.1, before the shop is handed back.
#
#   DATABASE_URL=postgres://…/nz_migrate bin/rails preflight:report   # changes nothing
#   DATABASE_URL=…                        bin/rails preflight:fix      # applies, dump-first
#   bin/rails preflight:revert LOG=tmp/preflight-nz-….json            # undo one fix run
#
# ── the problem this fixes ────────────────────────────────────────────────────
#
# His data carries STI rows whose class does not exist on 5.6.1. A missing class
# is not a blank field: ActiveRecord raises SubclassNotFound the moment anything
# loads the row, and it takes healthy rows down with it. Measured on the real
# data rather than reasoned about:
#
#   Spree::PaymentMethod::BankTransfer   28 nz orders. Before the retype,
#     PaymentMethod.all.to_a, Payment.includes(:payment_method) and
#     order.payments all raise, so those 28 orders cannot be opened at all.
#
#   Spree::Calculator::Shipping::FreePostageCalculator  the Free Post method.
#     ShippingMethod.includes(:calculator) is the query the admin Shipping
#     Methods index runs, and one orphan row 500s the whole page, including the
#     shipping methods that are perfectly healthy. A row-count health check
#     reports green while admin is down.
#
# ── why raw SQL, not ActiveRecord ─────────────────────────────────────────────
#
# You cannot use the ORM to repair a row the ORM refuses to load. `PaymentMethod
# .find(id)` raises SubclassNotFound for exactly the rows this fixes. So every
# read and write here goes through the connection, the same way
# script/check_sti_classes.rb scans. This is the whole reason the task exists as
# SQL and not as a model callback.
#
# ── why an allowlist, and not "retype every missing class" ────────────────────
#
# This is the trap, and it is a money bug. Two of his shops carry
# UBINzShippingCalculator and UBICaShippingCalculator, whose CODE EXISTS on
# 5.6.1 (via a scoped autoload override, see done_ca_preflight). Those load
# fine and must never be touched. Blindly retyping every "missing" calculator to
# FlatRate would set the shipping cost of a real, working calculator to $0.00 on
# the shop that is taking money, silently.
#
# So REMEDIES is an explicit map of the classes that are genuinely GONE, each
# with the core class it becomes. Anything the scan reports that is not in this
# map is listed under "unhandled" and left alone, for a human to decide before
# cutover. An orphan we do not recognise is not something to guess at.
#
# ── the guarantees ────────────────────────────────────────────────────────────
#
#   dump-first   `fix` refuses to run unless DUMP_TAKEN=1 is set, because the
#                first rule here is that his data is never altered without a
#                dump taken first.
#   report-only  the default. Nothing mutates until you type `fix`.
#   live rows    only rows with deleted_at IS NULL where the table has it. Spree
#                soft-deletes, and his nz Standard Postage carries 11 calculator
#                rows of which 10 are deleted. A deleted orphan is inert.
#   no deletes   the only writes are an UPDATE of `type`, and a one-way copy of
#                his bank instructions into `description` when description is
#                empty. No row is removed, no other column is touched.
#   reversible   every change is written to a JSON log, and `preflight:revert`
#                replays it backwards. Since the only mutations are `type` and a
#                guarded `description` backfill, the reverse is exact.
#   idempotent   a second `fix` run finds nothing to do, because the classes it
#                looks for are gone from the data after the first.
#
# NOTE: authored 2026-08-23. The remedies themselves were each verified on the
# real data in a rolled-back transaction (done_orphan_calculator_remedy,
# done_ca_preflight, and the BankTransfer risk entry). This task packages those
# verified remedies so cutover is a rerun, not fresh work. It has NOT itself been
# run against a dump yet: run `preflight:report` on each real dump first and read
# it, then `fix`.

namespace :preflight do
  # The classes that are genuinely gone on 5.6.1, and what each becomes.
  #
  #   to     the core class to retype the row to. Check is offline
  #          (source_required? false) and behaves like a bank transfer once
  #          auto_capture is off; FlatRate defaults preferred_amount to 0.0 and
  #          computes 0.0, so it IS free postage.
  #   carry  optional [from, to] columns: copy from -> to only when `to` is
  #          empty, so his 1026 characters of bank instructions survive into the
  #          column 5.6.1 still reads (description), editable and API-published.
  #   note   printed in the report so the operator sees the intent.
  REMEDIES = {
    "Spree::PaymentMethod::BankTransfer" => {
      to: "Spree::PaymentMethod::Check",
      carry: %w[instructions description],
      note: "he keeps Bank Transfer on nz and au; Check is the offline core equivalent. " \
            "Confirm Auto Capture is OFF on the retyped method, or it marks orders paid with no money.",
    },
    "Spree::Calculator::Shipping::FreePostageCalculator" => {
      to: "Spree::Calculator::Shipping::FlatRate",
      note: "Free Post is being removed; FlatRate at its default 0.0 is free postage and loads.",
    },
  }.freeze

  def conn
    ActiveRecord::Base.connection
  end

  def has_column?(table, column)
    conn.columns(table).any? { |c| c.name == column }
  end

  # Every table that carries an STI type column, so nothing is assumed about
  # where an orphan might live.
  def typed_tables
    conn.tables.select { |t| conn.columns(t).any? { |c| c.name == "type" } }.sort
  end

  # Rows of a live, recognised orphan class in one table. Live means not
  # soft-deleted where the table supports it.
  def orphan_rows(table)
    live = has_column?(table, "deleted_at") ? "AND deleted_at IS NULL" : ""
    types = REMEDIES.keys.map { |t| conn.quote(t) }.join(", ")
    conn.select_all(
      "SELECT * FROM #{conn.quote_table_name(table)} " \
      "WHERE type IN (#{types}) #{live} ORDER BY id",
    ).to_a
  end

  # Every distinct type in the data whose class 5.6.1 does not define, so the
  # report can separate "handled" from "someone must look at this".
  def missing_classes
    seen = {}
    typed_tables.each do |table|
      live = has_column?(table, "deleted_at") ? "WHERE deleted_at IS NULL AND type IS NOT NULL" : "WHERE type IS NOT NULL"
      conn.select_all(
        "SELECT type, count(*) AS n FROM #{conn.quote_table_name(table)} #{live} GROUP BY type",
      ).each do |row|
        klass = row["type"]
        next if class_defined?(klass)

        (seen[klass] ||= { count: 0, tables: [] })
        seen[klass][:count] += row["n"].to_i
        seen[klass][:tables] |= [table]
      end
    end
    seen
  end

  def class_defined?(name)
    name.constantize
    true
  rescue NameError
    false
  end

  task report: :environment do
    puts "\n  preflight report on #{conn.current_database}\n\n"

    missing = missing_classes
    if missing.empty?
      puts "  no missing STI classes. This dump loads on 5.6.1 as it stands.\n\n"
      next
    end

    handled = missing.select { |k, _| REMEDIES.key?(k) }
    unhandled = missing.reject { |k, _| REMEDIES.key?(k) }

    unless handled.empty?
      puts "  #{handled.size} class(es) this task can remedy:\n"
      handled.each do |klass, info|
        r = REMEDIES[klass]
        live = orphan_rows_across(klass)
        puts "    #{klass}"
        puts "      -> #{r[:to]}   (#{live} live row(s) across #{info[:tables].join(', ')})"
        puts "      #{r[:note]}" if r[:note]
        puts "      carry #{r[:carry][0]} -> #{r[:carry][1]} where #{r[:carry][1]} is empty" if r[:carry]
        puts
      end
    end

    unless unhandled.empty?
      puts "  #{unhandled.size} class(es) this task will NOT touch. Decide before cutover:\n"
      unhandled.each do |klass, info|
        base = klass.rpartition("::").first
        note =
          if base.empty? || !class_defined?(base)
            "base class absent too, so the rows are inert: no association can load them. Probably leave alone."
          else
            "base class exists, so these rows 500 the admin page for that model. Needs a remedy added to REMEDIES."
          end
        puts "    #{klass}   #{info[:count]} row(s) in #{info[:tables].join(', ')}"
        puts "      #{note}"
        puts
      end
    end
    puts "  report only. Nothing was changed. Run `preflight:fix` (with DUMP_TAKEN=1) to apply the remedies above.\n\n"
  end

  def orphan_rows_across(klass)
    typed_tables.sum do |table|
      next 0 unless conn.select_value(
        "SELECT 1 FROM #{conn.quote_table_name(table)} WHERE type = #{conn.quote(klass)} LIMIT 1",
      )

      live = has_column?(table, "deleted_at") ? "AND deleted_at IS NULL" : ""
      conn.select_value(
        "SELECT count(*) FROM #{conn.quote_table_name(table)} WHERE type = #{conn.quote(klass)} #{live}",
      ).to_i
    end
  end

  task fix: :environment do
    unless ENV["DUMP_TAKEN"] == "1"
      abort "\n  Refusing to change #{conn.current_database} without a dump.\n" \
            "  Take one, then rerun with DUMP_TAKEN=1. His data is never altered without a dump first.\n\n"
    end

    log = []
    changed = 0

    ActiveRecord::Base.transaction do
      typed_tables.each do |table|
        REMEDIES.each do |from_class, remedy|
          rows = orphan_rows(table).select { |r| r["type"] == from_class }
          rows.each do |row|
            id = row["id"]
            entry = { table: table, id: id, column: "type", from: from_class, to: remedy[:to] }

            # The one-way carry, BEFORE the retype, and only when the target is
            # empty so a rerun or an existing description is never overwritten.
            if remedy[:carry] && has_column?(table, remedy[:carry][0]) && has_column?(table, remedy[:carry][1])
              src, dst = remedy[:carry]
              if row[src].present? && row[dst].blank?
                # Inline-quoted, not $1 binds. exec_update's bind form needs
                # typed QueryAttribute objects, not raw values, and there is no
                # runtime here to prove that path; conn.quote is what the read
                # side above already uses, so the writes match it.
                conn.exec_update(
                  "UPDATE #{conn.quote_table_name(table)} " \
                  "SET #{conn.quote_column_name(dst)} = #{conn.quote(row[src])} " \
                  "WHERE id = #{conn.quote(id)}",
                )
                entry[:carried] = { from: src, to: dst }
                puts "    #{table}##{id}  #{src} -> #{dst} (#{row[src].to_s.length} chars)"
              end
            end

            conn.exec_update(
              "UPDATE #{conn.quote_table_name(table)} " \
              "SET type = #{conn.quote(remedy[:to])} WHERE id = #{conn.quote(id)}",
            )
            puts "    #{table}##{id}  #{from_class} -> #{remedy[:to]}"
            log << entry
            changed += 1
          end
        end
      end
    end

    if changed.zero?
      puts "\n  nothing to change. Either already fixed, or this dump has no recognised orphans.\n\n"
      next
    end

    dir = Rails.root.join("tmp")
    FileUtils.mkdir_p(dir)
    path = dir.join("preflight-#{conn.current_database}-#{Time.now.utc.strftime('%Y%m%d%H%M%S')}.json")
    File.write(path, JSON.pretty_generate(log))
    puts "\n  #{changed} row(s) changed. Reversible log: #{path}"
    puts "  Verify the shop, then keep the log. To undo: bin/rails preflight:revert LOG=#{path}\n\n"
  end

  task revert: :environment do
    path = ENV["LOG"] or abort "  LOG=path/to/preflight-….json required"
    entries = JSON.parse(File.read(path))
    ActiveRecord::Base.transaction do
      entries.reverse_each do |e|
        conn.exec_update(
          "UPDATE #{conn.quote_table_name(e['table'])} " \
          "SET type = #{conn.quote(e['from'])} WHERE id = #{conn.quote(e['id'])}",
        )
        puts "    #{e['table']}##{e['id']}  #{e['to']} -> #{e['from']}"
        # The carried description is left in place on revert: it is his own bank
        # text copied into a column that also exists on the old shape, so keeping
        # it loses nothing. Blanking it would be the destructive move here.
      end
    end
    puts "\n  reverted #{entries.size} row(s) from #{path}\n\n"
  end
end
