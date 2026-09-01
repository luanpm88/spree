import { SCRIPTS_BY_SHOP } from "@/lib/blocks/content";

/**
 * The search engine title and description, per shop.
 *
 * The client wrote one of each for every shop and asked for them to be applied
 * per site. They differ by more than the country name: Canada leads on the
 * bottles, New Zealand leads on the brand, and the descriptions are pitched at
 * different markets.
 *
 * They live beside his scripts rather than in the environment because that is
 * where the rest of his per shop wording already is, and because two more
 * variables in six compose files is two more places to get one wrong. It also
 * keeps them out of this public repository, which the content module is
 * gitignored for.
 */
export interface ShopSeo {
  title: string;
  description: string;
}

export function shopSeo(): ShopSeo | undefined {
  const shop = (
    process.env.NEXT_PUBLIC_DEFAULT_COUNTRY || ""
  ).toLowerCase() as keyof typeof SCRIPTS_BY_SHOP;
  const entry = SCRIPTS_BY_SHOP[shop];
  if (!entry) return undefined;

  // A shop he has not sent wording for keeps the generic title rather than
  // inheriting another country's. Empty strings count as not sent.
  const title = entry.seoTitle?.trim();
  const description = entry.seoDescription?.trim();
  if (!title && !description) return undefined;

  return { title: title || "", description: description || "" };
}
