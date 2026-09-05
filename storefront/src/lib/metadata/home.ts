import type { Metadata } from "next";
import { shopBrand } from "@/lib/blocks/brand";
import { shopSeo } from "@/lib/blocks/seo";
import { buildHreflangLanguages } from "@/lib/metadata/alternates";
import { basePathFor } from "@/lib/routing";
import { buildCanonicalUrl, SOCIAL_IMAGE_PATH } from "@/lib/seo";
import {
  getStoreMetaDescription,
  getStoreSeoTitle,
  getStoreUrl,
} from "@/lib/store";

interface HomeMetadataParams {
  country: string;
  locale: string;
}

export async function generateHomeMetadata({
  country,
  locale,
}: HomeMetadataParams): Promise<Metadata> {
  // The home page is the one page his own SEO title was written for, so it wins
  // over the store name here. A shop he has not sent wording for keeps the
  // generic title rather than borrowing another country's.
  const seo = shopSeo();
  const brand = shopBrand();
  const storeName = seo?.title || getStoreSeoTitle();
  const description = seo?.description || getStoreMetaDescription();
  const storeUrl = getStoreUrl();
  const canonicalUrl = storeUrl
    ? buildCanonicalUrl(storeUrl, basePathFor(country, locale) || "/")
    : undefined;
  const languages = storeUrl
    ? await buildHreflangLanguages({
        storeUrl,
        country,
        locale,
        path: "",
      })
    : undefined;

  return {
    title: { absolute: storeName },
    description,
    ...(canonicalUrl
      ? {
          alternates: {
            canonical: canonicalUrl,
            ...(languages ? { languages } : {}),
          },
        }
      : {}),
    openGraph: {
      title: storeName,
      description,
      ...(canonicalUrl ? { url: canonicalUrl } : {}),
      type: "website",
      images: [brand.og || SOCIAL_IMAGE_PATH],
    },
  };
}
