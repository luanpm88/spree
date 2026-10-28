
Rails.application.routes.draw do
  Spree::Core::Engine.add_routes do
    # The printable invoice (/admin/orders/:order_id/invoice) and the "every email
    # this shop sends" screen (/admin/emails) lived in the Rails admin, which Spree
    # 6.0 removes. Both are to be rebuilt in the dashboard; see
    # docs/PLAN_6-0.md section 9.1.7.

    # Newsletter signup that keeps the name the visitor typed.
    #
    # A route of our own rather than a decorator on Spree's controller. The
    # platform's endpoint accepts email only and drops anything else without
    # saying so, and nothing about that is a bug to patch: it is simply a
    # narrower endpoint than this shop needs. Adding beside it leaves the
    # original working for anything that already calls it.
    namespace :api do
      namespace :v3 do
        namespace :store do
          resources :newsletter_signups, only: [:create]

          # His customers' reviews, which came across in every dump with nothing
          # reading them: Spree 5.6 has no reviews of its own and the extension
          # that wrote them is not installed here. Read only, and nested under the
          # product so a shop can never be asked for another shop's.
          resources :products, only: [] do
            resources :reviews, only: [:index], controller: 'product_reviews'
          end
        end
      end
    end

  end
  # This line mounts Spree's routes at the root of your application.
  # This means, any requests to URLs such as /products, will go to
  # Spree::ProductsController.
  # If you would like to change where this engine is mounted, simply change the
  # :at option to something different.
  #
  # We ask that you don't use the :as option here, as Spree relies on it being
  # the default of "spree".
  mount Spree::Core::Engine, at: '/'

  # Job dashboard (Mission Control) — inspect, retry, and discard Solid Queue
  # jobs at http://localhost:3000/jobs. Guarded by its own HTTP Basic auth
  # (see config/application.rb), independent of app sessions.
  mount MissionControl::Jobs::Engine, at: "/jobs"

  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  # Can be used by load balancers and uptime monitors to verify that the app is live.
  get "up" => "rails/health#show", as: :rails_health_check

  # The app's front door is the dashboard. Spree resolves where it lives:
  # SPREE_DASHBOARD_URL when set, else the /dashboard this app serves. 302, not 301,
  # so browsers do not cache it past a change of SPREE_DASHBOARD_URL.
  root to: redirect(status: 302) { Spree::Stores::DashboardUrl.call.presence || '/dashboard' }
end
