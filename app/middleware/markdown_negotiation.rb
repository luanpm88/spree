# Serve any HTML page as Markdown when the caller asks for it.
#
#   curl -H 'Accept: text/markdown' https://shop.example/products/x
#
# Brought across from the client's 5.4 shops, where it sits alongside llms.txt
# and a robots.txt written for AI crawlers. The three work together: robots.txt
# says which agents may read the shop, llms.txt tells them what the shop is, and
# this hands them the page without the markup.
#
# ── it needs a storefront to act on ──────────────────────────────────────────
#
# This only rewrites responses whose Content-Type is text/html. Spree 5.6 ships
# no Rails storefront, so on a 5.6 install the only HTML it can see is the
# admin, which no crawler should be reading anyway. Carried across so nothing is
# lost, and so it is ready the moment there is a shop front again, but on 5.6 it
# is inert by design rather than by accident.
#
# Wired up in config/application.rb.
class MarkdownNegotiation
  def initialize(app)
    @app = app
  end

  def call(env)
    status, headers, response = @app.call(env)

    accept = env['HTTP_ACCEPT'].to_s
    return [status, headers, response] unless accept.include?('text/markdown')

    content_type = headers['Content-Type'].to_s
    return [status, headers, response] unless content_type.include?('text/html')

    body = +''
    response.each { |chunk| body << chunk }

    markdown = html_to_markdown(body)

    headers['Content-Type'] = 'text/markdown; charset=utf-8'
    headers['Content-Length'] = markdown.bytesize.to_s

    [status, headers, [markdown]]
  end

  private

  def html_to_markdown(html)
    # Strip head, scripts, styles, nav, footer
    html.gsub!(/<head>.*?<\/head>/mi, '')
    html.gsub!(/<script[^>]*>.*?<\/script>/mi, '')
    html.gsub!(/<style[^>]*>.*?<\/style>/mi, '')
    html.gsub!(/<nav[^>]*>.*?<\/nav>/mi, '')
    html.gsub!(/<footer[^>]*>.*?<\/footer>/mi, '')
    html.gsub!(/<header[^>]*>.*?<\/header>/mi, '')

    # Headings
    html.gsub!(/<h1[^>]*>(.*?)<\/h1>/mi) { "# #{$1.strip}\n\n" }
    html.gsub!(/<h2[^>]*>(.*?)<\/h2>/mi) { "## #{$1.strip}\n\n" }
    html.gsub!(/<h3[^>]*>(.*?)<\/h3>/mi) { "### #{$1.strip}\n\n" }
    html.gsub!(/<h4[^>]*>(.*?)<\/h4>/mi) { "#### #{$1.strip}\n\n" }

    # Links
    html.gsub!(/<a[^>]+href="([^"]*)"[^>]*>(.*?)<\/a>/mi) { "[#{$2.strip}](#{$1})" }

    # Bold and italic
    html.gsub!(/<strong[^>]*>(.*?)<\/strong>/mi) { "**#{$1.strip}**" }
    html.gsub!(/<b[^>]*>(.*?)<\/b>/mi) { "**#{$1.strip}**" }
    html.gsub!(/<em[^>]*>(.*?)<\/em>/mi) { "*#{$1.strip}*" }
    html.gsub!(/<i[^>]*>(.*?)<\/i>/mi) { "*#{$1.strip}*" }

    # Lists
    html.gsub!(/<li[^>]*>(.*?)<\/li>/mi) { "- #{$1.strip}\n" }
    html.gsub!(/<\/ul>/mi, "\n")
    html.gsub!(/<\/ol>/mi, "\n")

    # Paragraphs and line breaks
    html.gsub!(/<br\s*\/?>/mi, "\n")
    html.gsub!(/<\/p>/mi, "\n\n")
    html.gsub!(/<p[^>]*>/mi, '')

    # Strip remaining tags
    html.gsub!(/<[^>]+>/, '')

    # Decode HTML entities
    html.gsub!('&amp;', '&')
    html.gsub!('&lt;', '<')
    html.gsub!('&gt;', '>')
    html.gsub!('&quot;', '"')
    html.gsub!('&#39;', "'")
    html.gsub!('&nbsp;', ' ')

    # Clean up excessive whitespace
    html.gsub!(/\n{3,}/, "\n\n")
    html.strip!

    html
  end
end