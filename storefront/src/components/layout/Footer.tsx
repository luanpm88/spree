import type { Category } from "@spree/sdk";
import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { FooterInfoLinks } from "@/components/layout/FooterInfoLinks";
import { livery } from "@/components/layout/footerLivery";
import { shopBrand } from "@/lib/blocks/brand";
import { shopFooter } from "@/lib/blocks/footer";
import { getPolicies } from "@/lib/data/policies";
import { isWholesaleEnabled } from "@/lib/spree";
import { getStoreName } from "@/lib/store";
import { CurrentYear } from "./CurrentYear";
import { shopKey } from "@/lib/shop-key";

const storeName = getStoreName();

/**
 * The order he ticked on 20 Aug: terms, privacy, returns, shipping.
 *
 * Matched on the stem rather than the whole slug, because his shops spell the
 * last two differently and both spellings are real data he can edit in admin:
 * the wholesale shop has returns-policy and shipping-policy, the five retail
 * shops have returns and shipping. The list used to hold only the retail
 * spelling, so on the wholesale shop two of the four matched nothing.
 */
const POLICY_ORDER_BY_SHOP: Record<string, string[]> = {
  b2b: ["terms", "privacy", "returns", "shipping"],
};

/**
 * What the other 5 shops render today, and keep rendering.
 *
 * He ticked terms before privacy on the WHOLESALE footer. That is one shop's
 * review and this footer is shared by 6, so applying it everywhere would have
 * reordered 5 retail footers on their next build off the back of a screenshot
 * about a sixth. Retail keeps privacy first until he is asked.
 */
const POLICY_ORDER_DEFAULT = ["privacy", "terms", "returns", "shipping"];

function policyOrder(): string[] {
  const shop = shopKey();
  return POLICY_ORDER_BY_SHOP[shop] ?? POLICY_ORDER_DEFAULT;
}

/**
 * Where a policy sits in that order.
 *
 * The comment this replaces claimed unknown slugs were "pushed to the end
 * explicitly". They were not: the sort was a bare indexOf difference, and
 * indexOf returns -1 for an unknown slug, which sorts it ahead of everything.
 * That is precisely what the client photographed — his wholesale footer led
 * with Returns Policy and Shipping Policy and finished with Terms of Service,
 * which is the two unmatched slugs first and the two matched ones after.
 *
 * It came back a second time on 24 Aug, on the sixth shop, and not because the
 * fix was wrong: `git checkout --` on this file to undo an unrelated edit threw
 * away every unstaged change in it, this block among them. A file with weeks of
 * unstaged work in it is not a file to restore from the index.
 */
function policyRank(slug: string, order: string[]): number {
  const i = order.findIndex((stem) => slug.startsWith(stem));
  return i === -1 ? order.length : i;
}

interface FooterProps {
  basePath: string;
  locale: Locale;
  /**
   * The category navigation. Optional because a shop that is closed to visitors
   * without an account renders its sign-in and policy pages without it: the
   * category tree describes the catalogue, and describing the catalogue to
   * someone with no account is what that shop exists not to do.
   */
  categoryLinks?: ReactNode;
}

interface FooterCategoryLinksProps {
  rootCategories: Category[];
  basePath: string;
  /**
   * The order the client's own artwork lists them in, by name.
   *
   * Optional, and the six shops that do not pass it keep the order their own
   * shop returns. The business design lists its categories in a deliberate
   * sequence and he checked the page against it: "The category list is not in
   * the order of the image provided."
   *
   * Names not in this list keep their existing order and follow the ones that
   * are, so a category added after he wrote the list appears rather than
   * disappearing.
   */
  order?: readonly string[];
}

export function FooterCategoryLinks({
  rootCategories,
  basePath,
  order,
}: FooterCategoryLinksProps) {
  const l = livery();
  // The children of "Categories", not the roots.
  //
  // The roots are the taxonomies: Categories, Collections, Product Type, Size /
  // Capacity, Colour, ECO Values. Four of those are the axes his filters are
  // built from and listing them in the footer sends a shopper to a page of
  // facets. What belongs here is what sits under Categories: Bottles & Cups,
  // Containers | Covers | Lid & Parts, Shop Specials, which is what his own
  // footer lists.
  const found =
    rootCategories.find((c) => c.permalink === "categories")?.children ??
    rootCategories;

  // Sorted by his sequence when one is given, otherwise left exactly as the
  // shop returned them. A name he did not list sorts after every name he did
  // and keeps its relative position, so nothing vanishes because he wrote the
  // list before the category existed.
  const categories = order
    ? [...found].sort((a, b) => {
        const rank = (name: string) => {
          const i = order.indexOf(name);
          return i === -1 ? order.length : i;
        };
        return rank(a.name) - rank(b.name);
      })
    : found;

  return categories.map((category) => (
    <li key={category.id}>
      <Link href={`${basePath}/c/${category.permalink}`} className={l.link}>
        {category.name}
      </Link>
    </li>
  ));
}

export async function Footer({ basePath, locale, categoryLinks }: FooterProps) {
  const t = await getTranslations({ locale, namespace: "footer" });
  const wholesaleEnabled = isWholesaleEnabled();
  const { legalName = storeName, social = [] } = shopFooter();
  const { logoFooter } = shopBrand();
  const l = livery();
  // Fetched, not a list in the code. The hardcoded one named two policies this
  // store does not have, so the footer carried two links to a page that said it
  // did not exist. Slugs are store data and the shop owner can rename them.
  const policies = await getPolicies();

  return (
    <footer
      // Three liveries, chosen in footerLivery.ts. Retail is the grey he asked
      // for, the closed wholesale shop is dark like his own, and the sixth shop
      // is his green sampled out of the mock he sent on 23 August.
      //
      // Not an inline hex here. It was, and this footer then carried #EDEDED in
      // one file while FooterInfoLinks carried text-black in another, which is
      // how a column of black links shipped on a black ground after every test
      // passed. Anything drawing inside the footer reads its colours from that
      // one module.
      style={l.surface}
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Seven columns. The brand block spans two, then his five: Products,
            Account, Company, Terms and Policies, Follow us. It was six, with the
            social links sitting in the bottom bar instead of in a column of their
            own, which is not how his footer is laid out. */}
        <div className="grid grid-cols-1 gap-8 md:grid-cols-7">
          {/* Brand */}
          <div className="col-span-1 md:col-span-2">
            {/* His own mark, per shop. Named per shop rather than shared: a
                single logofooter.png would put one brand's logo on another's
                footer, and six of these shops share this component. */}
            {logoFooter ? (
              <Image
                src={logoFooter}
                alt={storeName}
                width={400}
                height={311}
                // w-48, not h-20. The column is about 320px wide and the mark
                // was rendering 103px of it, which he marked "Make bigger, it
                // looks to small". Sized by width so it fills the column it sits
                // in rather than by height, which is what left it small: the
                // artwork is wider than it is tall, so a height cap is the
                // dimension that does not control how much space it takes.
                className="w-48 h-auto object-contain"
              />
            ) : (
              <span className={l.wordmark}>{storeName}</span>
            )}
            {/* The logo on its own. He drew a box round the store description
                under it and said "it is just the logo like the other image": his
                own footer carries the mark and nothing else in that column, and
                the logo artwork already says "choices change our planet", so the
                sentence underneath was a second tagline under the first.

                The description is still fetched and still used for meta tags. It
                is only this column that drops it. */}
          </div>

          {/* Links */}
          <div>
            <h3 className={l.heading}>{t("shop")}</h3>
            {/* His order: On sale first, then the real top level categories. It
                used to be "All Products" followed by every root taxonomy, which
                put Product Type, Size / Capacity, Colour and ECO Values in the
                footer. Those are the axes his filters are built from, not places
                to send a shopper, and he marked the column wrong. */}
            <ul className="mt-4 space-y-3">
              {l.showOnSale && (
                <li>
                  <Link
                    href={`${basePath}/c/collections/on-sale`}
                    className={l.link}
                  >
                    {t("onSale")}
                  </Link>
                </li>
              )}
              {categoryLinks}
            </ul>
          </div>

          {/* Account */}
          <div>
            <h3 className={l.heading}>{t("account")}</h3>
            <ul className="mt-4 space-y-3">
              <li>
                <Link href={`${basePath}/account`} className={l.link}>
                  {t("account")}
                </Link>
              </li>
              <li>
                {/* /account, not /account/login: there is no login route. The
                    middleware bounced a signed-out visitor from the second to the
                    first, but a signed-in one got a 404 (measured 29 Oct). The
                    account page is the sign-in form to the first and their
                    account to the second. */}
                <Link href={`${basePath}/account`} className={l.link}>
                  {t("login")}
                </Link>
              </li>
              {/* Gated, not deleted. His Final List: "Remove the Subscribe link
                  in the footer of the NZ, AU, US, CA, and nolocal shop. I will
                  rebuild this page again later." The page is not going, the link
                  to it is, so the conditional stays and one word in the livery
                  brings it back on all of them at once. */}
              {l.showSubscribe && (
                <li>
                  <Link href={`${basePath}/pages/subscribe`} className={l.link}>
                    {t("subscribe")}
                  </Link>
                </li>
              )}
              {wholesaleEnabled && (
                <li>
                  <Link href={`${basePath}/wholesale`} className={l.link}>
                    {t("wholesale")}
                  </Link>
                </li>
              )}
            </ul>
          </div>

          {/* This shop's own pages and its outside links. Per shop, from the
              content module, because the page sets differ between shops: one
              country has a Buy Local page and another does not, and linking a
              shop to a page it does not have puts a 404 in its own footer. */}
          <FooterInfoLinks basePath={basePath} />

          {/* Policies */}
          <div>
            <h3 className={l.heading}>{t("policies")}</h3>
            {/* Order per shop, see POLICY_ORDER_BY_SHOP. The API returns them in
                its own order and anything it does not name falls to the end
                rather than being dropped or, as it once did, sorted to the
                front. */}
            <ul className="mt-4 space-y-3">
              {[...policies]
                .sort(
                  (a, b) =>
                    policyRank(a.slug, policyOrder()) -
                    policyRank(b.slug, policyOrder()),
                )
                .map((policy) => (
                  <li key={policy.slug}>
                    <Link
                      href={`${basePath}/policies/${policy.slug}`}
                      className={l.link}
                    >
                      {policy.name}
                    </Link>
                  </li>
                ))}
            </ul>
          </div>
          {/* Follow us, as a column. His footer has it beside the others rather
              than as a strip under everything. */}
          {social.length > 0 && (
            <div>
              <h3 className={l.heading}>{t("followUs")}</h3>
              <ul className="mt-4 space-y-3">
                {social.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={l.link}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Below the line goes darker, with white text on it. His words: "black or
          dark gray with white text below the line".

          The value comes from the livery, because the three footers answer this
          differently: the retail one wants contrast against grey, the wholesale
          one is flat black with no seam at all, and the sixth shop's strip is a
          deliberate shade lighter than the panel above it, sampled at #579280
          against a #065146 ground.

          Outside the container on purpose: inside it the bar stops at the
          container's max width and leaves shoulders either side, which is a band
          across the middle rather than a strip along the bottom. */}
      <div className="py-6 text-xs text-center" style={l.bar}>
        {/* No framework credit. A shop's footer belongs to the shop, and a client
            paying for a storefront should not be advertising the software it runs
            on. The copyright string is translatable so each shop can word it.

            The name here is the legal one, which is longer than the name in the
            header: his shops sign the copyright with the full line held in
            spree_stores.name. Falls back to the header name when a shop has not
            set one. */}
        <p className="container mx-auto px-4 sm:px-6 lg:px-8">
          &copy; <CurrentYear /> {legalName}. {t("allRightsReserved")}
        </p>
      </div>
    </footer>
  );
}
