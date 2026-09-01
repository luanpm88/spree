import { Subscribe } from "@/components/blocks/Subscribe";
import type { SubscribeBlock } from "@/lib/blocks/types";
import { getPolicies } from "@/lib/data/policies";

interface SubscribeSectionProps extends SubscribeBlock {
  basePath: string;
}

/**
 * Server side wrapper that hands the subscribe form its policy links.
 *
 * The form itself is a client component, so it cannot fetch. The links have to
 * be fetched rather than written down: this shop's policies are `terms-of-service`
 * and `privacy-policy`, another shop renamed one of them, and a hardcoded pair
 * already put two dead links in the footer once. Slugs are the shop owner's data
 * and he can change them in the admin any morning.
 *
 * Nothing is rendered for a link that does not resolve, so a shop without a
 * privacy policy gets a form with no consent line rather than a link to a page
 * that says it does not exist.
 */
export async function SubscribeSection({
  basePath,
  ...block
}: SubscribeSectionProps) {
  const policies = await getPolicies().catch(() => []);

  const pick = (...candidates: string[]) =>
    policies.find((p) => candidates.includes(p.slug));

  const terms = pick("terms-of-service", "terms-of-use", "terms");
  const privacy = pick("privacy-policy", "privacy");

  return (
    <Subscribe
      {...block}
      termsHref={terms ? `${basePath}/policies/${terms.slug}` : undefined}
      termsLabel={terms?.name}
      privacyHref={privacy ? `${basePath}/policies/${privacy.slug}` : undefined}
      privacyLabel={privacy?.name}
    />
  );
}
