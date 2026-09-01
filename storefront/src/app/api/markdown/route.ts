import { type NextRequest, NextResponse } from "next/server";
import { htmlToMarkdown } from "@/lib/markdown/from-html";

/**
 * Hand a page over as Markdown.
 *
 * Not reached directly. The middleware rewrites here when a caller asks for
 * `Accept: text/markdown`, keeping the address the caller typed.
 *
 * ── why it fetches the page rather than rendering it ────────────────────────
 *
 * Next middleware runs before the page is rendered and cannot read a response
 * body, so it cannot convert one. The alternative is to rebuild each page's
 * content from the data behind it, which means a second implementation of every
 * page that then drifts from the first.
 *
 * So this asks the server for its own page, exactly as a visitor would, and
 * converts what comes back. One implementation, and the Markdown can never
 * describe a page different from the one on screen.
 *
 * ── the loop this must not create ───────────────────────────────────────────
 *
 * The fetch below carries `Accept: text/html` deliberately. Without it the
 * middleware would see text/markdown on the internal request too and rewrite
 * that one here as well, and the server would call itself until it fell over.
 * The middleware also skips this path outright, so there are two guards and
 * neither depends on the other.
 */
// No route segment config here on purpose. This project builds with
// cacheComponents, which rejects `export const dynamic`, and the build fails with
// "Ecmascript file had an error" pointing at the export rather than saying why. A
// handler that reads the request is dynamic without being told to be.

export async function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get("path") || "/";

  // Only ever a path on this shop. A caller who reaches this handler directly
  // must not be able to make the server fetch somewhere else and hand back the
  // result as though it were ours.
  if (!target.startsWith("/") || target.startsWith("//")) {
    return new NextResponse("bad path", { status: 400 });
  }

  // 127.0.0.1, not the public origin.
  //
  // The first version fetched request.nextUrl.origin, which is the shop's real
  // hostname. Inside the container that means leaving the box, crossing
  // Cloudflare, coming back through nginx and only then reaching the process that
  // made the call. Cloudflare answered 502 while the very same request straight to
  // the container answered 200, which is how this was found.
  //
  // The page is one hop away on loopback. Take that hop.
  const port = process.env.PORT || "3000";
  const url = new URL(target, `http://127.0.0.1:${port}`);

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: {
        // See above: this is what stops the middleware sending it back here.
        accept: "text/html",
        // Loopback loses the Host header, and this storefront renders per host.
        // Without this the page comes back built for the wrong shop.
        host: request.headers.get("host") ?? "",
        // A gated shop must stay gated. Passing the caller's cookies through
        // means the page is rendered for whoever asked, so a stranger gets the
        // sign-in page as Markdown rather than the catalogue.
        cookie: request.headers.get("cookie") ?? "",
        "user-agent": request.headers.get("user-agent") ?? "",
      },
      // manual, so a gated shop answers a Markdown request the same way it
      // answers an HTML one. Following the bounce quietly produced 200 with an
      // empty body on the closed shop, which leaks nothing but tells a crawler
      // the page exists and is empty rather than that it needs an account.
      redirect: "manual",
    });
  } catch {
    return new NextResponse("could not read the page", { status: 502 });
  }

  // A redirect belongs to the caller, not to this handler. The sign-in bounce on a
  // closed shop is the clearest example: the answer to "show me this page" is
  // "sign in first", in either representation.
  //
  // Not quite identical, and worth saying so rather than claiming otherwise: the
  // gate builds its ?redirect= from the path it saw, which here is the internal
  // one, so a Markdown caller is sent back to / after signing in where an HTML
  // caller returns to the page they asked for. Immaterial to a crawler, and the
  // part that matters is the same: a stranger reads no catalogue either way.
  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get("location");
    if (location) {
      return new NextResponse(null, {
        status: upstream.status,
        headers: { location, vary: "Accept" },
      });
    }
  }

  if (!upstream.ok) {
    // Pass the page's own answer through. A 404 asked for as Markdown is still a
    // 404, and answering 200 with an empty document would tell a crawler the
    // page exists.
    return new NextResponse(`the page answered ${upstream.status}`, {
      status: upstream.status,
    });
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    // The Ruby this replaces only ever rewrote text/html, and so does this.
    const body = await upstream.arrayBuffer();
    return new NextResponse(body, {
      status: upstream.status,
      headers: { "content-type": contentType },
    });
  }

  const markdown = htmlToMarkdown(await upstream.text());

  return new NextResponse(markdown, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      // Same address, two representations. Without this a cache can hand the
      // HTML to a crawler asking for Markdown, or the other way round.
      vary: "Accept",
    },
  });
}
