import type { Metadata } from "next";
import { Renderer } from "@/components/blocks/Renderer";
import { businessFrontPage } from "@/lib/blocks/front-page";
import { resolveCurrency } from "@/lib/data/markets";
import { basePathFor } from "@/lib/routing";
import { getStoreName } from "@/lib/store";

interface PreviewProps {
  params: Promise<{ country: string; locale: string }>;
}

/**
 * The new business front page, before it replaces the live one.
 *
 * Its own address, not a flag on the home page: the live home page is not
 * touched until he approves this one, and the two can be compared side by side.
 * Kept out of search engines and linked from nowhere.
 */
export const metadata: Metadata = {
  title: "Front page preview",
  robots: { index: false, follow: false },
};

export default async function FrontPagePreview({ params }: PreviewProps) {
  const { country, locale } = await params;
  const basePath = basePathFor(country, locale);
  const currency = await resolveCurrency(country);
  const page = businessFrontPage(getStoreName(), { preview: true });
  return (
    <Renderer blocks={page.blocks} basePath={basePath} currency={currency} />
  );
}
