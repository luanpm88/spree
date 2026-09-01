import Link from "next/link";
import { livery } from "@/components/layout/footerLivery";
import { SITE_LINKS } from "@/lib/blocks/content";

interface FooterInfoLinksProps {
  basePath: string;
}

/**
 * The footer column holding this shop's own pages and its outside links.
 *
 * Both lists come from the content module, per shop, because they differ: New
 * Zealand has a Buy Local page and Canada does not, and linking a shop to a page
 * it does not have produces a 404 in its own footer.
 *
 * External links carry rel="noopener" and open in a new tab, which is what his
 * current footer does for the blog.
 *
 * The column heading comes from the content module too, not from the translation
 * file. next-intl returns the KEY when a key is missing, so `t("info")` rendered
 * the literal text "footer.info" in the live footer and the `|| "Info"` fallback
 * never fired, because the key it returned was not an empty string.
 *
 * Its colours come from the shared livery rather than from classes written here.
 * They used to be written here, three hardcoded `text-black`, and when the
 * wholesale footer went dark this column stayed black on black. Every unit test
 * passed, the deploy checks passed, and the client found it by looking at his own
 * site: "The wholesale column is all black text needs to be white".
 */
export function FooterInfoLinks({ basePath }: FooterInfoLinksProps) {
  const l = livery();
  const shop = (process.env.NEXT_PUBLIC_DEFAULT_COUNTRY || "").toLowerCase();
  const links = SITE_LINKS[shop];
  if (!links) return null;

  return (
    <div>
      <h3 className={l.heading}>{links.heading}</h3>
      <ul className="mt-4 space-y-2">
        {/* One ordered list, three kinds of destination, because his column
            interleaves them: contact, about, blog, faq, then a link to their
            other shops. The blog is an outside link sitting between two of the
            shop's own pages, so
            rendering the internal ones first and the outside ones after produced
            a different column from the one he has. */}
        {links.links.map((item) => {
          if (item.href) {
            return (
              <li key={item.href}>
                <a
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={l.link}
                >
                  {item.label}
                </a>
              </li>
            );
          }
          // A route on this shop, or a content page by slug. An entry with
          // neither is skipped rather than linking to /pages/undefined.
          const href = item.path
            ? `${basePath}${item.path}`
            : item.slug
              ? `${basePath}/pages/${item.slug}`
              : undefined;
          if (!href) return null;
          return (
            <li key={href}>
              <Link href={href} className={l.link}>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
