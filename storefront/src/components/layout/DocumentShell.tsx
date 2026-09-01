import { GoogleTagManager } from "@next/third-parties/google";
import { Roboto } from "next/font/google";
import { Suspense } from "react";
import {
  BodyEndScripts,
  BodyStartScripts,
  HeadScripts,
} from "@/components/layout/SiteScripts";
import { localeDirection } from "@/i18n/locales";
import { shopTheme } from "@/lib/blocks/theme";

const gtmId = process.env.GTM_ID;
const spreeApiOrigin = (() => {
  try {
    return process.env.SPREE_API_URL
      ? new URL(process.env.SPREE_API_URL).origin
      : undefined;
  } catch {
    return undefined;
  }
})();

// Roboto, the client's font on every shop. Loaded through next/font so the files
// are served from this domain rather than fetched from Google on each visit,
// which also means one less third party in the critical path.
//
// The weights are the ones the design uses: body, medium for buttons and labels,
// bold for headings. Asking for the whole family would ship four more files
// nobody renders.
const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

interface DocumentShellProps {
  children: React.ReactNode;
  locale: string;
}

/** Shared document markup for each root layout. */
export function DocumentShell({ children, locale }: DocumentShellProps) {
  return (
    // data-theme carries the palette.
    //
    // He asked for this in one sentence: "This shop has it own theme, BLACK.
    // Make sure the whole shop is converted to this theme." Then listed 10
    // places our olive was still showing, on pages as far apart as the sign-in
    // form and the checkout Apply button, all of them downstream of --primary.
    //
    // Changing them one className at a time is what was tried first, and it
    // reaches only the pages somebody thought to look at. A token override under
    // one attribute reaches every page, including the ones nobody has opened.
    <html
      lang={locale}
      dir={localeDirection(locale)}
      data-theme={shopTheme()}
      suppressHydrationWarning
    >
      {/* biome-ignore lint/style/noHeadElement: this shell is used only by Next.js root layouts */}
      <head>
        {spreeApiOrigin && (
          <>
            <link rel="preconnect" href={spreeApiOrigin} />
            <link rel="dns-prefetch" href={spreeApiOrigin} />
          </>
        )}
        {/* His analytics collector and social proof pixel, in the head as on his
            current shop. */}
        <HeadScripts />
      </head>
      {gtmId && <GoogleTagManager gtmId={gtmId} />}
      <body
        className={`${roboto.variable} antialiased min-h-screen flex flex-col`}
      >
        {/* First thing inside the body, where his tracker task puts it. One shop
            runs a cookie consent banner here, and consent that arrives after the
            page has already loaded everything is not consent. */}
        <BodyStartScripts />
        <Suspense fallback={null}>{children}</Suspense>
        {/* Vercel's Analytics and SpeedInsights used to sit here. They ship a
            script tag pointing at /_vercel/insights/script.js, which only exists
            when Vercel is doing the hosting. These shops run on the client's own
            server, so every page load fetched two paths that answered 404 and
            reported nothing to anyone. Removed rather than left as noise in his
            network tab. */}
        {/* Chat and email, last, so neither holds up the first paint. */}
        <BodyEndScripts />
      </body>
    </html>
  );
}
