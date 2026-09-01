import type { Metadata } from "next";
import { shopBrand } from "@/lib/blocks/brand";
import { buildHreflangLanguages } from "@/lib/metadata/alternates";
import { buildCanonicalUrl, SOCIAL_IMAGE_PATH } from "@/lib/seo";
import { getStoreUrl } from "@/lib/store";

interface CategoriesMetadataParams {
  country: string;
  locale: string;
}

export async function generateCategoriesMetadata({
  country,
  locale,
}: CategoriesMetadataParams): Promise<Metadata> {
  const storeUrl = getStoreUrl();
  const canonicalUrl = storeUrl
    ? buildCanonicalUrl(storeUrl, `/${country}/${locale}/c`)
    : undefined;
  const languages = storeUrl
    ? await buildHreflangLanguages({
        storeUrl,
        country,
        locale,
        path: "/c",
      })
    : undefined;

  return {
    title: "Categories",
    description: "Browse all product categories.",
    ...(canonicalUrl
      ? {
          alternates: {
            canonical: canonicalUrl,
            ...(languages ? { languages } : {}),
          },
        }
      : {}),
    openGraph: {
      title: "Categories",
      description: "Browse all product categories.",
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
