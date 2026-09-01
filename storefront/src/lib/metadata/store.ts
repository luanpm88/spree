import type { Metadata } from "next";
import { shopBrand } from "@/lib/blocks/brand";
import { shopSeo } from "@/lib/blocks/seo";
import { SOCIAL_IMAGE_PATH } from "@/lib/seo";
import {
  getStoreMetaDescription,
  getStoreName,
  getStoreSeoTitle,
  getStoreUrl,
} from "@/lib/store";

function normalizeOpenGraphLocale(locale: string): string {
  const parts = locale.split(/[-_]/);
  if (parts.length < 2) return locale;
  return `${parts[0].toLowerCase()}_${parts[1].toUpperCase()}`;
}

interface StoreMetadataParams {
  locale: string;
}

export async function generateStoreMetadata({
  locale,
}: StoreMetadataParams): Promise<Metadata> {
  const seo = shopSeo();
  const brand = shopBrand();
  const storeUrl = getStoreUrl();

  // The supplied title is a whole home page title, "<shop> | <what they sell>",
  // so it is the DEFAULT and not the template. Feeding it to the template would
  // title the FAQ page "FAQ | <shop> | <what they sell>". Inner pages get the
  // shop name only.
  const homeTitle = seo?.title || getStoreSeoTitle();
  const titleSuffix = getStoreName();
  const metaDescription = seo?.description || getStoreMetaDescription();
  const metaKeywords = process.env.STORE_META_KEYWORDS;
  const twitter = process.env.STORE_TWITTER;

  let metadataBaseSpread: Partial<{ metadataBase: URL }> = {};
  if (storeUrl) {
    try {
      metadataBaseSpread = { metadataBase: new URL(storeUrl) };
    } catch {
      metadataBaseSpread = {};
    }
  }

  return {
    ...metadataBaseSpread,
    title: {
      template: `%s | ${titleSuffix}`,
      default: homeTitle,
    },
    description: metaDescription,
    ...(metaKeywords ? { keywords: metaKeywords } : {}),
    // His own favicon, in place of nothing: the site declared no icon at all and
    // browsers fell back to the framework's default, so every shop wore Vercel's
    // triangle on its tab. One file covers the tab and the iOS home screen both.
    ...(brand.favicon
      ? { icons: { icon: brand.favicon, apple: brand.favicon } }
      : {}),
    openGraph: {
      siteName: getStoreName(),
      locale: normalizeOpenGraphLocale(locale),
      type: "website",
      // The card each shop's links show when pasted into a chat. His are drawn per
      // shop, with that country's own artwork and domain on them, so one shared
      // card would put Canada's picture on the Australian shop's previews.
      images: [brand.og || SOCIAL_IMAGE_PATH],
    },
    twitter: {
      card: "summary_large_image",
      ...(twitter
        ? {
            site: twitter.startsWith("@") ? twitter : `@${twitter}`,
          }
        : {}),
    },
  };
}
