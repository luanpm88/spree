# Proves outgoing mail is wired up. Run it with:  make mail
#
# In local dev, compose points SMTP_HOST at the mailpit container, so nothing
# leaves your machine — read what was "sent" at http://localhost:8025.
# In production, whatever SMTP_HOST/SMTP_USERNAME/SMTP_PASSWORD you set in
# .env is used, and this really does send. Pass a recipient to check that:
#
#   docker compose exec web bin/rails runner script/smoke_mail.rb you@example.com

to = ARGV[0] || 'test@b-teka.com'
from = ENV.fetch('SMTP_FROM_ADDRESS', 'store@b-teka.com')

puts "delivery_method = #{ActionMailer::Base.delivery_method}"
puts "smtp_settings   = #{ActionMailer::Base.smtp_settings.inspect}"

msg = Mail.new do
  from    from
  to      to
  subject 'Spree SMTP smoke test'
  body    'If you can read this, outgoing mail works.'
end
msg.delivery_method :smtp, ActionMailer::Base.smtp_settings
msg.deliver!

puts "DELIVERED to #{to}"
