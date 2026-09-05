import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Renderer } from "@/components/blocks/Renderer";
import { contentPage, pageSeo, pageSlugs } from "@/lib/blocks/pages";
import { basePathFor } from "@/lib/routing";
import { getStoreName } from "@/lib/store";

interface ContentPageProps {
  params: Promise<{ country: string; locale: string; slug: string }>;
}

/**
 * One route for every content page.
 *
 * His pages live at /pages/<slug> today, so the same URLs keep working: about,
 * faq, buy-local and the hidden thank-you page. Keeping the paths identical
 * matters more than it looks, because those URLs are in his footer, in search
 * results and in the llms.txt he wrote for AI crawlers.
 */
export async function generateStaticParams() {
  return pageSlugs().map((slug) => ({ slug }));
}

/**
 * Missing pages answer 200, not 404, and it is not fixable here.
 *
 * The storefront runs with cacheComponents, Next's partial prerendering: the
 * static shell goes out immediately with a 200 and the dynamic part streams in
 * behind it. By the time `notFound()` runs the status line has already been
 * sent, so a missing page renders the 404 body under a 200. Search engines read
 * that as a real, empty page.
 *
 * The obvious fix, `export const dynamicParams = false`, is rejected at build
 * time: "Route segment config dynamicParams is not compatible with
 * nextConfig.cacheComponents". So a real 404 costs turning cacheComponents off
 * for the whole site, which is a performance trade nobody has asked for.
 *
 * Left as it is, deliberately, and written down instead. It affects every
 * dynamic route here, products and categories included, not only this one.
 */

export async function generateMetadata({
  params,
}: ContentPageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = contentPage(slug);
  // Not `return {}`. That inherited the layout's title template, so a slug
  // that cannot exist answered 200 under the shop's own real title with no
  // robots directive: the most indexable shape of the four. See the note
  // above for why the status itself cannot be fixed here.
  if (!page) return { robots: { index: false, follow: false } };

  // His own title and description where he has written them, which he does at
  // the foot of each of the four business pages. They are complete titles,
  // "Custom Branding for Business Products | <shop>", already carrying the
  // shop's own name, so they are absolute: letting the layout template append
  // the name again would title the page "... | <shop> | <shop>", which is the
  // same fault the heading rule below already exists for.
  const seo = pageSeo(slug);
  if (seo?.title) {
    return {
      title: { absolute: seo.title },
      ...(seo.description ? { description: seo.description } : {}),
    };
  }

  // Several page headings already end in the shop's own name, "Common FAQs –
  // <shop>". Letting the layout's template append it again titles that page
  // "Common FAQs – <shop> | <shop>", which is what the first build did. When the
  // heading already says it, the title stands alone.
  const storeName = getStoreName();
  const alreadyNamed = page.name
    .toLowerCase()
    .includes(storeName.toLowerCase());

  return {
    title: alreadyNamed ? { absolute: page.name } : page.name,
    ...(seo?.description ? { description: seo.description } : {}),
  };
}

export default async function ContentPage({ params }: ContentPageProps) {
  const { country, locale, slug } = await params;
  const page = contentPage(slug);
  if (!page) notFound();

  return (
    <Renderer blocks={page.blocks} basePath={basePathFor(country, locale)} />
  );
}
