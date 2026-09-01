"use server";

import { type Policy, SpreeError } from "@spree/sdk";
import { cacheLife, cacheTag } from "next/cache";
import { getClient, getLocaleOptions } from "@/lib/spree";

export async function cachedGetPolicy(
  slugOrId: string,
  options: { locale?: string; country?: string },
): Promise<Policy | null> {
  "use cache: remote";
  cacheLife("tenMinutes");
  cacheTag("policies", `policy:${slugOrId}`);
  try {
    return await getClient().policies.get(slugOrId, options);
  } catch (error) {
    if (error instanceof SpreeError && error.status === 404) return null;
    throw error;
  }
}

export async function getPolicy(
  slugOrId: string,
  options?: { locale?: string; country?: string },
): Promise<Policy | null> {
  return cachedGetPolicy(slugOrId, options ?? (await getLocaleOptions()));
}

/**
 * Every policy this store actually has.
 *
 * ── why this is fetched and not a list in the code ───────────────────────────
 *
 * There was a hardcoded list of four slugs. Two of them did not exist on the
 * client's store: it publishes `returns` and `shipping`, the list said
 * `returns-policy` and `shipping-policy`. So the footer carried two links to a
 * "Policy Not Found" page and the sitemap advertised the same two addresses to
 * search engines. Nothing failed and nothing logged; the pages simply said they
 * did not exist.
 *
 * Policy slugs are store data, editable in the admin, and they differ between
 * shops. Anything written down here is a guess about somebody else's database
 * that goes stale the first time they rename one.
 *
 * ── why a plain fetch ────────────────────────────────────────────────────────
 *
 * The SDK exposes a single policy by slug and no way to list them. Rather than
 * work around that with a list of slugs to look up one by one, which is the same
 * guess again, this calls the endpoint the API already serves. Same base URL and
 * same key as the client, read from the same variables.
 */
export interface PolicySummary {
  slug: string;
  name: string;
}

export async function getPolicies(): Promise<PolicySummary[]> {
  "use cache: remote";
  cacheLife("tenMinutes");
  cacheTag("policies");

  const baseUrl = process.env.SPREE_API_URL?.replace(/\/$/, "");
  const key = process.env.SPREE_PUBLISHABLE_KEY;
  if (!baseUrl || !key) return [];

  try {
    const res = await fetch(`${baseUrl}/api/v3/store/policies`, {
      headers: { "X-Spree-Api-Key": key },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      data?: Array<{ slug?: string; name?: string }>;
    };
    return (body.data ?? [])
      .filter((p): p is { slug: string; name: string } =>
        Boolean(p.slug && p.name),
      )
      .map((p) => ({ slug: p.slug, name: p.name }));
  } catch {
    // A footer without its policy column is worse than one with it, but a shop
    // that will not render at all because the policies endpoint had a bad minute
    // is worse than both.
    return [];
  }
}
