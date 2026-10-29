module Spree
  # Lets the Store API sort categories in the order staff set on the dashboard.
  #
  # The dashboard orders categories by moving them in the nested set (the reposition
  # action calls move_to_left_of / move_to_right_of), so that order lives in +lft+
  # and nowhere else: the +position+ column stays 0 on every row. +lft+ is not a
  # ransackable attribute in 6.0.0, so `sort=lft` is dropped silently and the list
  # comes back in whatever order Postgres reads the rows, which changes every time
  # the tree is edited. Measured 29 Oct on a copy of the business shop: after one
  # category was dragged to the top, no sort the API accepted put it there.
  #
  # Structural, so a decorator: one more attribute on the allow list, read by the
  # storefront's menu query as `sort=lft`.
  module CategoryDecorator
    def self.prepended(base)
      base.whitelisted_ransackable_attributes = (base.whitelisted_ransackable_attributes || []) | %w[lft]
    end
  end

  Category.prepend CategoryDecorator
end
