import type { Metadata } from "next";
import { shopBrand } from "@/lib/blocks/brand";
import { buildHreflangLanguages } from "@/lib/metadata/alternates";
import { buildCanonicalUrl, SOCIAL_IMAGE_PATH } from "@/lib/seo";
import { getStoreUrl } from "@/lib/store";

interface ProductsMetadataParams {
  country: string;
  locale: string;
}

export async function generateProductsMetadata({
  country,
  locale,
}: ProductsMetadataParams): Promise<Metadata> {
  const storeUrl = getStoreUrl();
  const canonicalUrl = storeUrl
    ? buildCanonicalUrl(storeUrl, `/${country}/${locale}/products`)
    : undefined;
  const languages = storeUrl
    ? await buildHreflangLanguages({
        storeUrl,
        country,
        locale,
        path: "/products",
      })
    : undefined;

  return {
    title: "Products",
    description: "Browse our full collection of products.",
    ...(canonicalUrl
      ? {
          alternates: {
            canonical: canonicalUrl,
            ...(languages ? { languages } : {}),
          },
        }
      : {}),
    openGraph: {
      title: "Products",
      description: "Browse our full collection of products.",
      ...(canonicalUrl ? { url: canonicalUrl } : {}),
      type: "website",
      // His own social card, falling back to the framework one. He has asked
      // "Can I add the metadata code for this?" in all 6 shop tasks and it was
      // answered once. The home, category, product and store pages already
      // carried it; these did not, so a link to them shared with no picture.
      images: [shopBrand().og || SOCIAL_IMAGE_PATH],
    },
  };
}
