module Spree
  # Every email this shop can send.
  #
  # ── what this answers ────────────────────────────────────────────────────
  #
  # The client asked "does the reimbursement email work or not, I cannot
  # remember", and nobody could answer, because nothing had ever built one.
  # `bin/rails emails:smoke` was written for that question and answers it on a
  # terminal for 7 emails. This is the list behind the same answer on a screen,
  # for all of them.
  #
  # ── enumerate from the classes, not from a glob of the view paths ────────
  #
  # Measured in this container on 22 Sep, development, SHOP_KEY unset:
  #
  #   ActionMailer::Base.view_paths            12 roots
  #   ActionMailer::Base.descendants           14 non-abstract mailers
  #   emails found                             26
  #
  # The first draft of this file said "four view roots" and "21 emails". Both
  # were guesses and both were wrong, and the second one was wrong in a way that
  # matters: the 5 missing were Devise::Mailer's, which this shop does use
  # (`:recoverable` is on Spree.user_class), and one of them is the password
  # reset a customer gets when they cannot log in.
  #
  # Three separate traps live in this method, all of them measured:
  #
  #   a) A `**/*.erb` walk of the view roots reads 749 files to report 26, and
  #      picks up `app/views/shops/<shop>/spree/order_mailer/…` as a mailer
  #      prefix of its own — 7 phantom rows on a shop with overrides,
  #      duplicating rows that already exist. Globbing only the directories the
  #      mailer classes actually name cannot produce a prefix no class answers
  #      to.
  #
  #   b) A hand-rolled filename regex reads `welcome_email.fr.html.erb` as the
  #      action "welcome_email.fr", because the action group is greedy, and
  #      drops `confirm_email.html+mobile.erb` entirely. spree_i18n is in this
  #      bundle. ActionView's own parser is used instead.
  #
  #   c) `action_methods` is not an enumeration source. Spree::BaseMailer never
  #      calls `abstract!`, so its 8 public helpers (`mail`, `money`,
  #      `current_store`, `with_store_locale`, …) land in the action_methods of
  #      every Spree mailer, along with every class_attribute this app adds.
  #      Measured: 105 entries across the mailers, 104 of them noise. As a
  #      filter on a template already found it is exactly right, which is how it
  #      is used below.
  #
  # ── the list is per shop, and the screen says so ─────────────────────────
  #
  # `config/initializers/shop_views.rb` prepends `app/views/shops/<SHOP_KEY>` to
  # ActionMailer's view paths, so a shop with its own templates resolves some of
  # these 26 to its own directory and the `source` column differs. Two shops
  # from one image legitimately show different rows. Stated on the screen,
  # because otherwise the first person to compare two of them files it as a bug.
  class EmailCatalogue
    Entry = Struct.new(:key, :mailer, :action, :formats, :source, keyword_init: true) do
      # "Confirm" out of "spree/order_mailer/confirm_email".
      def name
        action.to_s.sub(/_email\z/, '').sub(/_instructions\z/, '').humanize
      end

      # "Order" out of "spree/order_mailer/confirm_email". The group heading.
      def group
        mailer.to_s.demodulize.underscore.sub(/_mailer\z/, '').humanize
      end

      # Stable, URL-safe, and reversible: the key with slashes swapped for
      # double dashes. A single dash would collide with `password_reset_email`.
      def id
        key.tr('/', '~')
      end

      # Where the template that will actually render lives, said in words a
      # merchant can act on. "Your shop" means somebody here wrote it; a gem
      # path means it is Spree's own and nobody has touched it.
      def source_label
        return 'this shop' if source.to_s.include?('/views/shops/')
        return 'your app' if source.to_s == Rails.root.join('app', 'views').to_s

        source.to_s[%r{/gems/([^/]+)/}, 1] || source.to_s
      end

      # A single-part message is invisible to whoever sends it and is the first
      # thing a spam filter looks at, so the absence of a text part is a fact the
      # list carries rather than something you find by clicking.
      def text?
        formats.include?(:text)
      end
    end

    class << self
      def all
        @all ||= discover
      end

      def find(id)
        all.find { |e| e.id == id || e.key == id }
      end

      def reset!
        @all = nil
      end

      private

      def discover
        # Development autoloads lazily. Measured: before this line
        # `ActionMailer::Base.descendants` is 5 of 14 and every spree_core
        # mailer is missing, so the screen would be short in development and
        # right in production, which is the worst way round. Production has
        # eager_load on and this is a no-op.
        Rails.application.eager_load! unless Rails.application.config.eager_load

        mailers = ActionMailer::Base.descendants.reject(&:abstract?)
        parser = ActionView::Resolver::PathParser.new
        found = {}

        # view_paths is ordered the way Rails searches it, so the FIRST root
        # that holds a template is the file that will really render. Later roots
        # must not add formats to it: an action that is html-only in the shop's
        # own directory but html+text in the shared one would otherwise report
        # html+text, which is a claim about a file that will never be reached.
        ActionMailer::Base.view_paths.each do |resolver|
          root = resolver.to_s
          mailers.each do |mailer|
            Dir.glob(File.join(root, mailer.mailer_name, '*')).each do |file|
              basename = File.basename(file)
              next if basename.start_with?('_')

              parsed = parser.parse(basename)
              action = parsed.path.name
              format = parsed.details.format
              next if format.nil?
              next unless mailer.action_methods.include?(action)

              key = "#{mailer.mailer_name}/#{action}"
              entry = found[key] ||= Entry.new(
                key: key, mailer: mailer.name, action: action.to_sym,
                formats: [], source: root
              )
              entry.formats |= [format] if entry.source == root
            end
          end
        end

        found.values.sort_by(&:key)
      end
    end
  end
end
