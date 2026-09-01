import type { Metadata } from "next";
import { Renderer } from "@/components/blocks/Renderer";
import { homePage } from "@/lib/blocks/home";
import { resolveCurrency } from "@/lib/data/markets";
import { generateHomeMetadata } from "@/lib/metadata/home";
import { getStoreName } from "@/lib/store";
import { basePathFor } from "@/lib/routing";

interface HomePageProps {
  params: Promise<{
    country: string;
    locale: string;
  }>;
}

export async function generateMetadata({
  params,
}: HomePageProps): Promise<Metadata> {
  const { country, locale } = await params;
  return generateHomeMetadata({ country, locale });
}

/**
 * The home page is a list of blocks, not a hand-assembled set of sections.
 *
 * It was three fixed components before. It is now whatever `homePage()` returns,
 * which today is a file and tomorrow is the CMS. That is the difference the
 * client is paying for: adding a section to his home page stops being a code
 * change.
 */
export default async function HomePage({ params }: HomePageProps) {
  const { country, locale } = await params;
  const basePath = basePathFor(country, locale);
  const currency = await resolveCurrency(country);
  const page = homePage(getStoreName());

  return (
    <Renderer blocks={page.blocks} basePath={basePath} currency={currency} />
  );
}
