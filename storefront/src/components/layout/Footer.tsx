import type { Category } from "@spree/sdk";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { POLICY_LINKS } from "@/lib/constants/policies";
import { isWholesaleEnabled } from "@/lib/spree";
import { getStoreDescription, getStoreName } from "@/lib/store";
import { CurrentYear } from "./CurrentYear";

const storeName = getStoreName();
const storeDescription = getStoreDescription();

interface FooterProps {
  basePath: string;
  locale: Locale;
  categoryLinks: ReactNode;
}

interface FooterCategoryLinksProps {
  rootCategories: Category[];
  basePath: string;
}

export function FooterCategoryLinks({
  rootCategories,
  basePath,
}: FooterCategoryLinksProps) {
  return rootCategories.map((category) => (
    <li key={category.id}>
      <Link
        href={`${basePath}/c/${category.permalink}`}
        className="text-sm text-primary-100 hover:text-white transition-colors"
      >
        {category.name}
      </Link>
    </li>
  ));
}

export async function Footer({ basePath, locale, categoryLinks }: FooterProps) {
  const t = await getTranslations({ locale, namespace: "footer" });
  const tp = await getTranslations({ locale, namespace: "policies" });
  const tc = await getTranslations({ locale, namespace: "contact" });
  const wholesaleEnabled = isWholesaleEnabled();

  return (
    <footer className="bg-primary text-gray-300">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-5">
          {/* Brand */}
          <div className="col-span-1 md:col-span-2">
            <span className="text-xl font-bold text-white">{storeName}</span>
            <p className="mt-4 text-sm text-neutral-400">
              {t("description") || storeDescription}
            </p>
          </div>

          {/* Links */}
          <div>
            <h3 className="text-sm font-medium text-primary-50">
              {t("shop")}
            </h3>
            <ul className="mt-4 space-y-3">
              <li>
                <Link
                  href={`${basePath}/products`}
                  className="text-sm text-primary-100 hover:text-white transition-colors"
                >
                  {t("allProducts")}
                </Link>
              </li>
              {categoryLinks}
            </ul>
          </div>

          {/* Account */}
          <div>
            <h3 className="text-sm font-medium text-primary-50">
              {t("account")}
            </h3>
            <ul className="mt-4 space-y-3">
              <li>
                <Link
                  href={`${basePath}/account`}
                  className="text-sm text-primary-100 hover:text-white transition-colors"
                >
                  {t("myAccount")}
                </Link>
              </li>
              <li>
                <Link
                  href={`${basePath}/account/orders`}
                  className="text-sm text-primary-100 hover:text-white transition-colors"
                >
                  {t("orderHistory")}
                </Link>
              </li>
              <li>
                <Link
                  href={`${basePath}/cart`}
                  className="text-sm text-primary-100 hover:text-white transition-colors"
                >
                  {t("cart")}
                </Link>
              </li>
              {wholesaleEnabled && (
                <li>
                  <Link
                    href={`${basePath}/wholesale`}
                    className="text-sm text-primary-100 hover:text-white transition-colors"
                  >
                    {t("wholesale")}
                  </Link>
                </li>
              )}
              {/* A contact page nothing links to is a contact page nobody finds. The
                  route existed for a while before anyone noticed there was no way in. */}
              <li>
                <Link
                  href={`${basePath}/contact`}
                  className="text-sm text-primary-100 hover:text-white transition-colors"
                >
                  {tc("title")}
                </Link>
              </li>
            </ul>
          </div>

          {/* Policies */}
          <div>
            <h3 className="text-sm font-medium text-primary-50">
              {t("policies")}
            </h3>
            <ul className="mt-4 space-y-3">
              {POLICY_LINKS.map((policy) => (
                <li key={policy.slug}>
                  <Link
                    href={`${basePath}/policies/${policy.slug}`}
                    className="text-sm text-primary-100 hover:text-white transition-colors"
                  >
                    {tp(policy.nameKey)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-8 pt-8 border-t border-neutral-800 text-xs text-neutral-400 text-center">
          {/* No framework credit. A shop's footer belongs to the shop, and a client
              paying for a storefront should not be advertising the software it runs
              on. The copyright string is translatable so each shop can word it. */}
          <p>
            &copy; <CurrentYear /> {storeName}. {t("allRightsReserved")}
          </p>
        </div>
      </div>
    </footer>
  );
}
