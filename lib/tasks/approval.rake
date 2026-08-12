# Which customer group means which approval outcome.
#
#   bin/rails approval:status
#   bin/rails 'approval:mark[more_information,More Information]'
#   bin/rails 'approval:mark[not_approved,Not Approved]'
#   bin/rails 'approval:clear[not_approved]'
#
# Quote the whole argument when a group name contains a space, or the shell splits it.
#
# ── why a rake task and not an admin screen ────────────────────────────────
#
# This is set once per shop, by whoever sets the shop up, and it is the sort of setting
# that should be awkward to change by accident: getting it wrong hands the trade price
# list to a customer the shop declined. A rake task leaves a command in someone's
# history; a form leaves nothing.
#
# ── why names in, ids out ─────────────────────────────────────────────────
#
# The client was promised that renaming a group in the admin cannot quietly turn a
# declined customer into an approved one. That holds because this resolves his name to
# an id ONCE, here, and stores the id. Nothing afterwards ever reads the name.

namespace :approval do
  # abort writes to stderr, which is unbuffered, while puts goes to buffered stdout. Left
  # alone, the failure line prints BEFORE the list of existing groups it is telling you to
  # read, which is the opposite of useful. Measured, not guessed: the first run of
  # approval:mark with a bad name printed its advice above its evidence.
  $stdout.sync = true

  NON_APPROVING = %w[more_information not_approved].freeze

  desc 'Show which customer group means which approval outcome'
  task status: :environment do
    store = Spree::Store.default
    abort '  no default store' if store.nil?

    roles = store.approval_group_roles
    puts
    puts "  #{store.name}"
    puts

    if roles.empty?
      puts '  Nothing configured, so EVERY customer group grants trade pricing.'
      puts '  That is the same behaviour as before this feature existed.'
    else
      NON_APPROVING.each do |role|
        id = roles[role]
        group = id && Spree::CustomerGroup.find_by(id: id)
        state = if id.nil?
                  'not set'
                elsif group.nil?
                  "id #{id} — GROUP NO LONGER EXISTS"
                else
                  "id #{id} — #{group.name.inspect}"
                end
        puts "  #{role.ljust(18)} #{state}"
      end
    end

    puts
    puts '  Every group, and what membership of it means:'
    Spree::CustomerGroup.order(:id).each do |g|
      role = store.approval_role_for(g.id)
      meaning = role == :approves ? 'trade prices' : "NO trade prices (#{role})"
      puts "      id=#{g.id.to_s.ljust(4)} #{g.name.to_s.ljust(24)} #{meaning}"
    end
    puts
  end

  desc 'Point an approval outcome at a customer group, by name, storing its id'
  task :mark, [:role, :name] => :environment do |_t, args|
    role = args[:role].to_s.strip
    name = args[:name].to_s.strip

    unless NON_APPROVING.include?(role)
      abort "  role must be one of: #{NON_APPROVING.join(', ')}. Got #{role.inspect}."
    end
    abort '  give a group name' if name.empty?

    store = Spree::Store.default
    abort '  no default store' if store.nil?

    # Refuses rather than storing a guess. A bogus id would read as "no special role",
    # which means the group would grant trade pricing: the exact failure this whole
    # mechanism exists to prevent, arrived at by a typo.
    group = store.customer_groups.find_by(name: name) || Spree::CustomerGroup.find_by(name: name)
    if group.nil?
      puts "  no customer group named #{name.inspect}. Existing groups:"
      Spree::CustomerGroup.order(:id).each { |g| puts "      #{g.id}  #{g.name}" }
      abort '  create it in the admin first, then run this again.'
    end

    roles = store.approval_group_roles.merge(role => group.id)
    store.preferred_approval_group_roles = roles
    store.save!

    puts "  #{role} -> #{group.name.inspect} (id #{group.id})"
    puts '  Stored by id, so renaming the group in the admin changes nothing here.'
    puts '  Run bin/rails approval:status to see the whole picture.'
  end

  desc 'Stop treating a group as an approval outcome, so it grants trade pricing again'
  task :clear, [:role] => :environment do |_t, args|
    role = args[:role].to_s.strip
    unless NON_APPROVING.include?(role)
      abort "  role must be one of: #{NON_APPROVING.join(', ')}. Got #{role.inspect}."
    end

    store = Spree::Store.default
    abort '  no default store' if store.nil?

    roles = store.approval_group_roles.except(role)
    store.preferred_approval_group_roles = roles
    store.save!

    puts "  #{role} cleared."
    puts '  WARNING: whichever group that was now grants trade pricing again.'
  end
end
