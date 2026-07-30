# Demo / staging accounts, one per job function.
#
#   bin/rails demo:seed_users                      # create everything
#   bin/rails demo:seed_users PASSWORD=…           # set your own password
#   bin/rails demo:accounts                        # just print the table
#
# Idempotent: re-running updates passwords and re-attaches roles rather than
# erroring on duplicates.
#
# The permission sets behind each role live in config/initializers/spree.rb.
# Creating a Spree::Role row grants NOTHING on its own — the role name has to be
# assigned permission sets there, otherwise the user signs in and sees an empty
# admin.

namespace :demo do
  # role name => [display name, what this person does]
  STAFF = {
    'admin'       => ['Quản trị hệ thống',   'toàn quyền, kể cả cấu hình và phân quyền'],
    'manager'     => ['Quản lý cửa hàng',    'đơn, sản phẩm, khuyến mãi, tồn kho, xem khách'],
    'catalog'     => ['NV sản phẩm',         'chỉ sản phẩm + tồn kho'],
    'fulfillment' => ['NV xử lý đơn',        'xử lý đơn, xem hàng/tồn/khách'],
    'sales_b2b'   => ['NV bán sỉ (B2B)',     'đơn sỉ, giá, quản lý khách & nhóm khách'],
    'support'     => ['CSKH',                'chỉ xem — không sửa được gì']
  }.freeze

  desc 'Create one admin user per role, plus a B2B and a retail customer'
  task seed_users: :environment do
    password = ENV.fetch('PASSWORD', 'spree123456')
    domain   = ENV.fetch('DOMAIN', 'b-teka.com')
    store    = Spree::Store.default

    abort 'No default store — run bin/rails db:prepare first.' if store.nil? || store.new_record?

    puts "Store: #{store.name} (#{store.code})"
    puts

    # ── staff ────────────────────────────────────────────────────────────────
    puts 'Admin users'
    STAFF.each_key do |role_name|
      role = Spree::Role.find_or_create_by!(name: role_name)
      email = "#{role_name}@#{domain}"

      user = Spree.admin_user_class.find_or_initialize_by(email: email)
      user.password = user.password_confirmation = password
      user.save!

      # add_role is idempotent for an already-assigned role.
      user.add_role(role.name, store) unless user.has_spree_role?(role.name, store)

      granted = begin
        Spree.permissions.permission_sets_for(role_name).map { |s| s.name.split('::').last }
      rescue StandardError
        []
      end
      warn "  ! #{role_name} has NO permission sets — see config/initializers/spree.rb" if granted.empty?

      puts format('  %-34s %-12s %s', email, role_name, granted.join(', '))
    end

    # ── customers ────────────────────────────────────────────────────────────
    puts
    puts 'Customers (storefront)'

    b2b_group = Spree::CustomerGroup.find_or_create_by!(name: 'Wholesale', store: store) do |g|
      g.description = 'Khách B2B đã được duyệt'
    end

    [
      ['wholesale@example.com', b2b_group, 'khách B2B — có giá sỉ'],
      ["retail@#{domain}",      nil,       'khách lẻ — giá niêm yết']
    ].each do |email, group, note|
      cust = Spree.user_class.find_or_initialize_by(email: email)
      cust.password = cust.password_confirmation = password
      cust.save!

      if group && !group.users.exists?(cust.id)
        group.users << cust
        note += ' (đã gán nhóm Wholesale)'
      end

      puts format('  %-34s %-12s %s', email, group ? 'wholesale' : 'retail', note)
    end

    puts
    puts "Mật khẩu cho tất cả tài khoản trên: #{password}"
    puts 'ĐỔI NGAY nếu đây không phải máy local.'
  end

  desc 'Print the demo accounts and what each role can do'
  task accounts: :environment do
    puts format('%-34s %-13s %s', 'EMAIL', 'ROLE', 'PERMISSION SETS')
    puts '-' * 100
    Spree.admin_user_class.order(:email).each do |u|
      roles = u.spree_roles.pluck(:name)
      sets = roles.flat_map do |r|
        Spree.permissions.permission_sets_for(r).map { |s| s.name.split('::').last }
      rescue StandardError
        []
      end
      puts format('%-34s %-13s %s', u.email, roles.join(','), sets.uniq.join(', '))
    end

    puts
    puts format('%-34s %s', 'CUSTOMER', 'GROUPS')
    puts '-' * 100
    Spree.user_class.order(:email).limit(30).each do |u|
      groups = u.customer_groups.pluck(:name) rescue []
      next if groups.empty? && !u.email.match?(/wholesale|retail/)

      puts format('%-34s %s', u.email, groups.presence&.join(',') || '(none)')
    end
  end
end
