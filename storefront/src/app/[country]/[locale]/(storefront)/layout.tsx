import type { Category } from "@spree/sdk";
import Link from "next/link";
import { connection } from "next/server";
import { cache, Suspense } from "react";
import { AnnouncementBar } from "@/components/layout/AnnouncementBar";
import { Footer, FooterCategoryLinks } from "@/components/layout/Footer";
import { Header, HeaderMobileMenu } from "@/components/layout/Header";
import { getCategories } from "@/lib/data/categories";
import { basePathFor } from "@/lib/routing";
import { enforceShopGate } from "@/lib/spree/shop-gate";

interface StorefrontLayoutProps {
  children: React.ReactNode;
  params: Promise<{ country: string; locale: string }>;
}

interface StorefrontNavigationProps {
  basePath: string;
  country: string;
  locale: string;
}

const EMPTY_CATEGORIES: Category[] = [];

function MobileNavigationFallback() {
  return (
    <div
      aria-hidden="true"
      className="size-10 rounded-md bg-gray-100 animate-pulse motion-reduce:animate-none"
    />
  );
}

function FooterCategoryLinksFallback() {
  return (
    <li aria-hidden="true">
      {/* currentColor at low opacity, not a fixed white. A white bar at 10%
          is a reasonable placeholder on the wholesale shop's dark footer and
          all but invisible on the retail shops, whose footer is light grey.
          Following the text colour makes one bar work on both. */}
      <span className="block h-4 w-24 rounded bg-current opacity-10 animate-pulse motion-reduce:animate-none" />
    </li>
  );
}

/**
 * Navigation categories are optional chrome, so defer their first load until
 * there is a real request instead of making every prerendered page contact the
 * Store API. Primitive arguments let React deduplicate category navigation
 * consumers within the request; successful responses keep using the persistent
 * cache in getCategories.
 */
const getRootCategories = cache(async (country: string, locale: string) => {
  await connection();

  return getCategories(
    {
      depth_eq: 0,
      // Four levels, not three. His navigation runs Categories > Bottles & Cups >
      // Single Wall Bottles > the individual sizes, and stopping a level short
      // dropped every leaf: the menu showed the groups and none of the products
      // people actually look for. Found by diffing his live pages against these.
      expand: ["children.children.children"],
    },
    { country, locale },
  )
    .then((res) => res.data)
    .catch((error) => {
      console.error("StorefrontLayout: failed to load categories", error);
      return EMPTY_CATEGORIES;
    });
});

function CategoryLinks({
  categories,
  basePath,
}: {
  categories: Category[];
  basePath: string;
}) {
  return (
    <ul>
      {categories.map((category) => (
        <li key={category.id}>
          <Link href={`${basePath}/c/${category.permalink}`}>
            {category.name}
          </Link>
          {category.children && category.children.length > 0 && (
            <CategoryLinks categories={category.children} basePath={basePath} />
          )}
        </li>
      ))}
    </ul>
  );
}

async function StorefrontMobileNavigation({
  basePath,
  country,
  locale,
}: StorefrontNavigationProps) {
  const rootCategories = await getRootCategories(country, locale);

  return (
    <HeaderMobileMenu rootCategories={rootCategories} basePath={basePath} />
  );
}

async function StorefrontCategoryNavigation({
  basePath,
  country,
  locale,
}: StorefrontNavigationProps) {
  const rootCategories = await getRootCategories(country, locale);

  if (rootCategories.length === 0) return null;

  return (
    <nav aria-label="Category navigation" className="sr-only">
      <CategoryLinks categories={rootCategories} basePath={basePath} />
    </nav>
  );
}

async function StorefrontFooterCategoryLinks({
  basePath,
  country,
  locale,
}: StorefrontNavigationProps) {
  const rootCategories = await getRootCategories(country, locale);

  return (
    <FooterCategoryLinks rootCategories={rootCategories} basePath={basePath} />
  );
}

export default async function StorefrontLayout({
  children,
  params,
}: StorefrontLayoutProps) {
  const { country, locale } = await params;
  const basePath = basePathFor(country, locale);

  // A shop that may not be browsed without an account checks that here, where
  // the session is verified against the API, rather than trusting the cookie
  // the middleware had to take on faith. Returns immediately on an open shop,
  // so the five retail shops pay nothing for it. See lib/spree/shop-gate.ts.
  const gate = await enforceShopGate(basePath);

  /**
   * On a closed shop, a stranger only ever reaches the sign-in pages and the
   * four policies. Those render here, inside the shop's own chrome, and that
   * chrome is not neutral: the header carries the whole category tree and a
   * search box, and the footer repeats the categories. Handing all of that to
   * someone with no account undoes the gate quietly, because nobody thinks of
   * a header as a page.
   *
   * So they get the shop's name, the page, and nothing that describes what it
   * sells. A signed-in wholesale customer sees the full navigation, and the
   * five open shops never take this branch at all.
   *
   * The footer goes with it, at his ask on 20 Aug. It carried the same category
   * links a second time, so leaving it in place would have handed a stranger the
   * catalogue underneath the sign-in form. The page ends at the form.
   */
  if (gate.gated && !gate.signedIn) {
    return (
      <>
        <Header basePath={basePath} locale={locale as Locale} />
        <main className="flex-1">{children}</main>
      </>
    );
  }

  return (
    <>
      {/* Above the header, which is where his current shop puts it. */}
      <AnnouncementBar locale={locale as Locale} />
      <Header
        basePath={basePath}
        locale={locale as Locale}
        mobileNavigation={
          <Suspense fallback={<MobileNavigationFallback />}>
            <StorefrontMobileNavigation
              basePath={basePath}
              country={country}
              locale={locale}
            />
          </Suspense>
        }
      />
      <Suspense fallback={null}>
        <StorefrontCategoryNavigation
          basePath={basePath}
          country={country}
          locale={locale}
        />
      </Suspense>
      <main className="flex-1">{children}</main>
      <Footer
        basePath={basePath}
        locale={locale as Locale}
        categoryLinks={
          <Suspense fallback={<FooterCategoryLinksFallback />}>
            <StorefrontFooterCategoryLinks
              basePath={basePath}
              country={country}
              locale={locale}
            />
          </Suspense>
        }
      />
    </>
  );
}
