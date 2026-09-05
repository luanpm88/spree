import type { Metadata } from "next";
import { getCachedProduct, PRODUCT_METADATA_EXPAND } from "@/lib/data/cached";
import { cachedGetProduct } from "@/lib/data/products";
import {
  buildLocalizedAlternates,
  translationFingerprint,
} from "@/lib/metadata/alternates";
import { stripHtml } from "@/lib/seo";
import { DEFAULT_SURFACE } from "@/lib/spree";
import { getStoreUrl } from "@/lib/store";

interface ProductMetadataParams {
  country: string;
  locale: string;
  slug: string;
}

export async function generateProductMetadata({
  country,
  locale,
  slug,
}: ProductMetadataParams): Promise<Metadata> {
  let product;
  try {
    product = await getCachedProduct(slug, PRODUCT_METADATA_EXPAND);
  } catch {
    return productNotFoundMetadata();
  }

  const title = product.meta_title || product.name;
  const description = product.meta_description
    ? product.meta_description
    : product.description
      ? stripHtml(product.description).slice(0, 160)
      : `Shop ${product.name}`;

  const storeUrl = getStoreUrl();
  const localizedAlternates = storeUrl
    ? await buildLocalizedAlternates({
        storeUrl,
        country,
        locale,
        path: `/products/${product.slug}`,
        currentResourceFingerprint: productTranslationFingerprint(product),
        resolvePath: async (target) => {
          const localizedProduct = await cachedGetProduct(
            product.id,
            [],
            { country: target.country, locale: target.locale },
            DEFAULT_SURFACE,
          );
          return {
            path: `/products/${localizedProduct.slug}`,
            fingerprint: productTranslationFingerprint(localizedProduct),
          };
        },
      })
    : undefined;

  const primaryMedia = product.primary_media;
  const ogSrc =
    primaryMedia?.og_image_url ||
    primaryMedia?.original_url ||
    product.thumbnail_url ||
    null;
  const ogImage =
    ogSrc && storeUrl
      ? {
          url: `${storeUrl}/_next/image?url=${encodeURIComponent(ogSrc)}&w=1200&q=75`,
          ...(primaryMedia?.og_image_url ? { width: 1200, height: 630 } : {}),
          alt: primaryMedia?.alt || product.name,
        }
      : ogSrc
        ? { url: ogSrc, alt: primaryMedia?.alt || product.name }
        : null;

  return {
    title,
    description,
    ...(product.meta_keywords ? { keywords: product.meta_keywords } : {}),
    ...(localizedAlternates
      ? {
          alternates: {
            canonical: localizedAlternates.canonical,
            languages: localizedAlternates.languages,
          },
        }
      : {}),
    openGraph: {
      title,
      description,
      ...(localizedAlternates ? { url: localizedAlternates.canonical } : {}),
      type: "website",
      ...(ogImage ? { images: [ogImage] } : {}),
    },
    other: {
      ...(product.price?.amount
        ? { "product:price:amount": product.price.amount }
        : {}),
      ...(product.price?.currency
        ? { "product:price:currency": product.price.currency }
        : {}),
    },
  };
}

function productTranslationFingerprint(product: {
  name: string;
  slug: string;
  description: string | null;
  description_html: string | null;
  meta_title: string | null;
  meta_description: string | null;
  meta_keywords: string | null;
}): string {
  return translationFingerprint(
    product.name,
    product.slug,
    product.description,
    product.description_html,
    product.meta_title,
    product.meta_description,
    product.meta_keywords,
  );
}

/**
 * What a product that does not exist says for itself.
 *
 * Exported so it can be asserted on. The robots directive is the whole point
 * and it is one line, which is exactly the sort of line a later tidy-up removes
 * as noise. See __tests__/not-found-robots.test.ts for what it is for.
 */
export function productNotFoundMetadata(): Metadata {
  return {
    title: "Product Not Found",
    // Tell crawlers not to index it, because the status line cannot.
    //
    // The storefront runs with cacheComponents, so the static shell goes out
    // with a 200 before notFound() runs and a missing record renders under a
    // 200. That is written up in the pages route and was accepted: a real 404
    // costs turning cacheComponents off for the whole site.
    //
    // What was NOT accepted, because nobody had measured it, is that the same
    // page also carried no robots directive. Checked on the live shops on
    // 5 Sep: /pages, /products, /c and /policies all answer 200 for a slug that
    // cannot exist, and none of them said noindex, while Next's own 404 page
    // does. So a search engine could index an unlimited number of empty
    // addresses, and on /pages they came with the shop's real title.
    //
    // This does not make the status correct. It removes the harm the wrong
    // status was doing.
    robots: { index: false, follow: false },
  };
}
