import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import type { RemotePattern } from "next/dist/shared/lib/image-config";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

/**
 * Allow product/asset images served by the configured Spree backend. Spree
 * returns Active Storage URLs on its own host (which may differ from
 * SPREE_API_URL's — e.g. store URL vs API URL, http vs https, with or without a
 * port), so we allow the SPREE_API_URL hostname over both protocols and any
 * port rather than hardcoding specific hosts. Set SPREE_IMAGES_URL when images
 * are served from a different host than the API — e.g. spree.sh puts images
 * behind a CDN (console.spree.sh) — and it takes precedence over SPREE_API_URL.
 * The pathname stays scoped to Active Storage. Falls back to `localhost` when
 * neither variable is set (dev).
 */
function spreeImagePatterns(): RemotePattern[] {
  const raw = (
    process.env.SPREE_IMAGES_URL || process.env.SPREE_API_URL
  )?.trim();
  let hostname = "localhost";
  if (raw) {
    try {
      hostname = new URL(raw).hostname;
    } catch {
      // Malformed URL — keep the localhost fallback.
    }
  }
  const pathname = "/rails/active_storage/**";
  return [
    { protocol: "http", hostname, pathname },
    { protocol: "https", hostname, pathname },
  ];
}

const nextConfig: NextConfig = {
  /**
   * /sitemap.xml is the address robots.txt names and the one already submitted
   * to Search Console. `generateSitemaps` in src/app/sitemap.ts moves the real
   * files to /sitemap/{id}.xml and leaves that address answering 404, silently.
   * This puts a sitemap index back on it. See src/app/sitemap-index/route.ts.
   *
   * beforeFiles, so the rewrite is consulted ahead of the filesystem instead of
   * only after a 404 has already been decided.
   */
  async rewrites() {
    return {
      beforeFiles: [{ source: "/sitemap.xml", destination: "/sitemap-index" }],
      afterFiles: [],
      fallback: [],
    };
  },

  /**
   * Pages that have been retired, sent to what replaced them.
   *
   * "Please remove this page and URL as we changed over to the global shop page
   * that is in the footer", 26 August, about a per-shop shop-listing page that
   * four of the shops carried.
   *
   * Deleting the page is not on its own enough to remove the URL. This
   * storefront runs with cacheComponents, so the static shell goes out with a
   * 200 before notFound() can change the status line: measured on a slug that
   * has never existed, /pages/no-such-page-xyz answers 200. A retired page would
   * therefore sit in search results answering 200 with a not-found body, which
   * is a worse outcome than leaving it alone.
   *
   * A permanent redirect says the right thing to a person and to a crawler, and
   * anything already linking to the old address lands on the map rather than on
   * nothing. permanent: true is a 308, which unlike a 301 is guaranteed not to
   * be rewritten to a GET by an intermediary.
   *
   * :country and :locale are named rather than wildcarded so this cannot swallow
   * a path it was not meant for.
   */
  async redirects() {
    // The list itself lives in src/lib/blocks/retired-urls.json, which is
    // gitignored: a source path and a destination both name the client, and this
    // repository is public. Same treatment as the copy file beside it, and it
    // travels the same way, through CLIENT_ASSETS in script/commercial.
    //
    // Under src/ rather than at the storefront root, because that is where
    // script/check_deploy_assets looks. It scans `app config storefront/src
    // storefront/public`, so a gitignored file one level up is invisible to the
    // only gate that proves the deploy carries it, and the failure mode below is
    // exactly the one that gate exists to stop.
    //
    // Absent, the build still succeeds with no redirects rather than failing,
    // because a missing redirect degrades to the status quo. That is the wrong
    // default for anything that could ship a shop silently misconfigured, so
    // script/check_deploy_assets is what makes sure the file arrives.
    //
    // `redirects` applies to every shop. `by_shop` applies only to the shop it
    // names, and it exists because one file is read by every shop's build, so a
    // path that is retired on one shop and LIVE on another cannot go in the
    // shared list.
    //
    // That is not hypothetical. One category path answers a bare unbranded 404
    // on four shops, because the category behind it is rule based and the 5.6
    // Store API does not serve rule based categories at all. On a fifth shop the
    // same path is an ordinary category with seventeen products in it. A shared
    // entry would have redirected the working one away from its own products.
    //
    // The shop is NEXT_PUBLIC_DEFAULT_COUNTRY, a build arg, so it is set here at
    // build time exactly as it is inside the app.
    try {
      const { readFileSync } = await import("node:fs");
      const raw = readFileSync(new URL("./src/lib/blocks/retired-urls.json", import.meta.url), "utf8");
      const parsed = JSON.parse(raw) as {
        redirects?: { from: string; to: string }[];
        by_shop?: Record<string, { from: string; to: string }[]>;
      };
      const shop = (process.env.NEXT_PUBLIC_DEFAULT_COUNTRY || "").toLowerCase();
      const forShop = shop ? (parsed.by_shop?.[shop] ?? []) : [];
      return [...(parsed.redirects ?? []), ...forShop].map((r) => ({
        source: r.from,
        destination: r.to,
        // 308 rather than 301: unlike a 301 it is guaranteed not to be rewritten
        // to a GET by an intermediary.
        permanent: true,
      }));
    } catch {
      return [];
    }
  },

  output: "standalone",
  allowedDevOrigins: ["shop.lvh.me", "*.trycloudflare.com", "192.168.33.13"],
  env: {
    NEXT_PUBLIC_SENTRY_DSN: process.env.SENTRY_DSN || "",
  },
  transpilePackages: ["@spree/sdk"],
  reactCompiler: true,
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-dialog",
    ],
  },
  turbopack: {
    root: __dirname,
  },
  cacheComponents: true,
  cacheLife: {
    tenMinutes: {
      stale: 300, // 5 minutes client stale window
      revalidate: 600, // 10 minutes until background revalidation
      expire: 3600, // 1 hour max before recompute on idle entries
    },
  },
  images: {
    qualities: [25, 50, 75, 85, 100],
    dangerouslyAllowLocalIP: true, // Allow localhost images in development
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    // 648 is his About panel photograph, and it is in this list for a reason
    // worth writing down.
    //
    // He sent a devtools panel showing that file at its intrinsic 648 x 756
    // rendered into a 653 x 762 box, and wrote "the code is changing the size it
    // should be ... then it will look clear and correct". The stretched box was
    // half of it. The other half is here: the optimizer can only serve a width
    // that appears in one of these two lists, the smallest candidate at or above
    // 648 was 750, and resizing a 648 wide source up to 750 is a genuine
    // upscale. Every request for that photograph was being enlarged by 16% and
    // then drawn back down, which is exactly the softness he could see.
    //
    // Both of his other shops' About files are 648 x 756 as well, so one entry
    // covers all seven builds.
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384, 648],
    remotePatterns: [
      // Derived from SPREE_IMAGES_URL (if set) or SPREE_API_URL.
      ...spreeImagePatterns(),
      // Hosted demo / tunnel backends whose image host differs from SPREE_API_URL.
    ],
  },
};

const configWithIntl = withNextIntl(nextConfig);

export default process.env.SENTRY_DSN
  ? withSentryConfig(configWithIntl, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,

      // Upload a larger set of source maps for prettier stack traces (increases build time)
      widenClientFileUpload: true,

      // Automatically delete source maps after uploading to Sentry
      // so they are not served publicly
      sourcemaps: {
        deleteSourcemapsAfterUpload: true,
      },

      // Disables the Sentry SDK build-time telemetry
      telemetry: false,
    })
  : configWithIntl;
