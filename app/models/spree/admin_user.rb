class Spree::AdminUser < Spree.base_class
  include Spree::AdminUserMethods

  # :trackable added, and the reason is that its five columns were already here doing
  # nothing.
  #
  # spree_admin_users carries sign_in_count, current_sign_in_at, last_sign_in_at,
  # current_sign_in_ip and last_sign_in_ip. The generated model above did not list the
  # module, so Devise never wrote any of them. Measured on the live shop: both admin
  # accounts read last_sign_in "never" and sign_ins 0, while the client was demonstrably
  # signed in and building shipping methods at the time.
  #
  # It is not cosmetic. Spree::Api::V3::Admin::CustomerSerializer serialises all five, so
  # every admin screen that shows "last seen" was showing a permanently empty field, and a
  # shop about to take real B2B orders had no record of who signed in or from where.
  #
  # ADMIN ONLY, deliberately. app/models/spree/user.rb gets the same generated list and is
  # left alone: tracking staff logins is ordinary, storing a customer's IP address on every
  # sign-in is a privacy decision that belongs to the shop, not to us.
  devise :database_authenticatable, :registerable,
         :recoverable, :rememberable, :validatable, :trackable
end
