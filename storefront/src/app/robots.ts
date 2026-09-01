import type { MetadataRoute } from "next";
import { getStoreUrl, isAccountRequired } from "@/lib/store";
import { generateSitemaps } from "./sitemap";

// Keep the sitemap index in sync with catalog growth instead of freezing the
// chunk list at deployment time.
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const baseUrl = (getStoreUrl() || "").replace(/\/$/, "") || undefined;

  /**
   * A shop nobody may browse without an account has nothing to index, and must
   * not describe itself.
   *
   * The requirement for the wholesale shop is that a URL forwarded to someone
   * without an account shows them nothing. A robots.txt that says "allow /" and
   * then names a sitemap of every product address defeats that on its own, and
   * it defeats it in the way that lasts: a crawler that has read the list keeps
   * the addresses whether or not the file is corrected afterwards.
   *
   * Returned before generateSitemaps() is called rather than after, because
   * that call reaches the catalogue and there is no reason to count a catalogue
   * this file is not allowed to describe.
   */
  if (isAccountRequired()) {
    return {
      rules: [{ userAgent: "*", disallow: "/" }],
      ...(baseUrl ? { host: baseUrl } : {}),
    };
  }

  const sitemaps = await generateSitemaps();

  return {
    rules: [
      {
        userAgent: "meta-externalagent",
        disallow: ["/"],
      },
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/*/account",
          "/*/account/*",
          "/*/cart",
          "/*/checkout",
          "/*/checkout/*",
          "/*?*sort=*",
          "/*?*page=*",
          "/*?*filter*=*",
        ],
      },
    ],
    ...(baseUrl
      ? {
          sitemap: sitemaps.map((s) => `${baseUrl}/sitemap/${s.id}.xml`),
          host: baseUrl,
        }
      : {}),
  };
}
