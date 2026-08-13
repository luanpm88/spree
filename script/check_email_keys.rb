# Every wording key the email templates ask for, checked against the locale that is
# actually loaded, plus every %{placeholder} checked against the arguments the template
# passes.
#
#   bin/rails runner script/check_email_keys.rb
#   LOCALE=en-CA bin/rails runner script/check_email_keys.rb
#
# ── why this exists ──────────────────────────────────────────────────────────
#
# Two failures keep recurring on these shops and neither one is loud.
#
#   1. A missing key. Spree.t does not raise. It returns
#      <span class="translation_missing">Humanized Key</span>, so the email still sends
#      and still looks like an email. The shop finds out from a customer.
#
#   2. A renamed placeholder. The shop rewrote a sentence and changed %{number} to
#      %{order}, or %{support_url} to %{contact_url}. I18n raises
#      MissingInterpolationArgument for a name the string uses, which takes the WHOLE
#      email down, and it ignores a spare argument silently. Four of these were found by
#      hand in one afternoon, one at a time, each behind the previous one.
#
# Rendering catches them one per run because the first raise hides the rest. This reads
# the templates and the locale directly, so it reports all of them at once.
#
# It does not open a browser and does not need fixtures.
LOCALE = (ENV['LOCALE'].presence || I18n.default_locale).to_sym
VIEW_GLOBS = %w[
  app/views/spree/order_mailer/**/*.erb
  app/views/spree/customer_mailer/**/*.erb
  app/views/spree/reimbursement_mailer/**/*.erb
  app/views/spree/user_mailer/**/*.erb
].freeze

# Spree.t(:key, scope: [:a, :b], arg: …, other: …)
# The tail must be allowed to span lines. Ending it at the first newline made the
# checker report a multi-line call as missing an argument that was simply on the
# next line, which is the one failure mode a checker must not have.
CALL = /Spree\.t\(\s*:([a-z0-9_]+)\s*,\s*scope:\s*\[([^\]]*)\](.*?)(?=\)\s*%>|\)\s*$)/m

files = VIEW_GLOBS.flat_map { |g| Dir.glob(Rails.root.join(g)) }.sort
abort 'no mailer templates found' if files.empty?

missing = []
unused  = []
extra   = []
seen    = 0

files.each do |path|
  rel = Pathname.new(path).relative_path_from(Rails.root).to_s
  src = File.read(path)

  src.scan(CALL) do |key, scope_src, tail|
    seen += 1
    scope = scope_src.scan(/:([a-z0-9_]+)/).flatten.map(&:to_sym)
    full  = (['spree'] + scope.map(&:to_s) + [key]).join('.')

    # Arguments this call passes. Nested Spree.t(…) inside the tail contributes its own
    # `scope:` which is not an argument to THIS call, so drop that one name.
    # :default, :count and friends are I18n's own options, not interpolations. Counting
    # them made the report cry wolf on every blank-safe call in the codebase.
    I18N_OPTIONS = %i[scope default locale raise throw count separator delimiter format] unless defined?(I18N_OPTIONS)
    args = tail.scan(/([a-z0-9_]+):/).flatten.map(&:to_sym) - I18N_OPTIONS

    value = I18n.exists?(full, LOCALE) ? I18n.t(full, locale: LOCALE, default: nil) : nil
    if value.nil?
      missing << [rel, full]
      next
    end
    next unless value.is_a?(String)

    placeholders = value.scan(/%\{([a-z0-9_]+)\}/).flatten.map(&:to_sym).uniq
    (placeholders - args).each { |p| unused << [rel, full, p] }   # raises at render time
    (args - placeholders).each { |a| extra  << [rel, full, a] }   # harmless, but a smell
  end
end

pad = ->(s, n) { s.to_s.ljust(n) }
puts "locale: #{LOCALE}    templates: #{files.size}    Spree.t calls read: #{seen}"
puts

if missing.any?
  puts "MISSING KEYS — render as a translation_missing span, the email still sends (#{missing.size})"
  missing.uniq.sort_by(&:last).each { |f, k| puts "  #{pad.call(k, 56)} #{f}" }
  puts
end

if unused.any?
  puts "MISSING ARGUMENTS — I18n RAISES, the whole email fails to render (#{unused.size})"
  unused.uniq.sort_by { |r| r[1] }.each { |f, k, p| puts "  #{pad.call(k, 44)} needs %{#{pad.call(p, 14)} #{f}" }
  puts
end

if extra.any?
  puts "ARGUMENTS THE WORDING DOES NOT USE — harmless now, usually a renamed placeholder (#{extra.size})"
  extra.uniq.sort_by { |r| r[1] }.each { |f, k, a| puts "  #{pad.call(k, 44)} passes :#{pad.call(a, 14)} #{f}" }
  puts
end

hard = missing.size + unused.size
puts(hard.zero? ? "ok — no missing key and no missing argument in #{LOCALE}" : "#{hard} problem(s) that reach a customer")
exit(hard.zero? ? 0 : 1)
