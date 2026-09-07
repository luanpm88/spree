import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { LIVERY } from "@/components/layout/footerLivery";
import { BUSINESS_FOOTER } from "@/lib/blocks/content";
import { shopFooter } from "@/lib/blocks/footer";
import { getPolicies } from "@/lib/data/policies";
import { getStoreName } from "@/lib/store";
import { CurrentYear } from "./CurrentYear";

interface BusinessFooterProps {
  basePath: string;
  locale: Locale;
  /** The shop's real root categories, for the SHOP column. */
  categoryLinks?: ReactNode;
}

/**
 * The business shop's footer, from the design he sent on 4 Sep.
 *
 * ── why this is a component and not a branch inside Footer ──────────────────
 *
 * Footer.tsx serves six shops with one shape: a brand block and four columns,
 * with the social links as a fifth. This design is a different shape. Five
 * columns, one of them new, the follow-us block moved out of the column row and
 * under it, and a brand block that gains a two line tagline, a paragraph and a
 * button.
 *
 * Threading all of that through the shared component as conditionals would have
 * put six shops one typo away from a layout none of them asked for. Footer.tsx
 * already carries the scar of a change made in one place and missed in another,
 * in its own words: a column of black links rendered on a black ground after
 * every unit test passed.
 *
 * The two footers share what should be shared. The palette comes from
 * footerLivery, so a colour still lives in exactly one file, and the policies
 * come from the same getPolicies the other one uses.
 *
 * ── the links that go nowhere, and why on purpose ──────────────────────────
 *
 * Seven of the Company and Support pages do not exist yet, measured page by
 * page. His instruction for those was exact: "Just do https://# for missing
 * pages". So they are rendered, they are visibly inert, and none of them sends
 * a customer to a page that answers with nothing.
 *
 * The eight social icons carry the same placeholder. His artwork says "Icons
 * 37px x 37px with URL links" and gives no addresses.
 *
 * ── the policies are the shop's, not the artwork's ─────────────────────────
 *
 * His column reads "Shipping & Delivery Policy" and "Product Claims Policy".
 * The shop has "Shipping Policy" and "Returns Policy". Rendering his labels
 * over the shop's slugs would have been two labels that no longer describe what
 * they open, and renaming his policy records would move their addresses and
 * break every link already pointing at them. So the shop's own four are
 * rendered and the difference goes to him as a question.
 */
export async function BusinessFooter({
  basePath,
  locale,
  categoryLinks,
}: BusinessFooterProps) {
  const t = await getTranslations({ locale, namespace: "footer" });
  const l = LIVERY.business;
  // His legal name from the gitignored config, falling back to the store name,
  // exactly as the shared footer resolves it. Never a brand spelled out here:
  // this file is tracked and the repository is public.
  const { legalName = getStoreName() } = shopFooter();
  const policies = await getPolicies();
  const f = BUSINESS_FOOTER;
  // His order, not the database's. He checked it against the page: "The polices
  // MUST go in the right order". A policy he did not list keeps its place after
  // the ones he did, so adding one never makes it disappear.
  const policyRank = (name: string) => {
    const i = (f.policyOrder as readonly string[]).indexOf(name);
    return i === -1 ? f.policyOrder.length : i;
  };
  const orderedPolicies = [...policies].sort(
    (a, b) => policyRank(a.name) - policyRank(b.name),
  );

  return (
    <footer style={l.surface}>
      <div className="container mx-auto px-4 py-14 sm:px-6 lg:px-8">
        {/* SEVEN columns: the brand block takes two, then his five.
            It was six, which left four places for five columns and wrapped
            POLICIES onto a row of its own under the brand block. Caught by
            screenshotting the deployed footer and looking at it, not by any
            test: every assertion still passed and the page still rendered. */}
        <div className="grid grid-cols-1 gap-10 md:grid-cols-7">
          <div className="md:col-span-2">
            <Image
              src="/brand/logo-footer-business-fitted.svg"
              alt=""
              width={186}
              height={152}
              // The FITTED copy, not his file, and his file is untouched beside
              // it. His export declares a canvas 595.73 wide while the artwork
              // measures 617.42, so the last letters of the wordmark were being
              // clipped by the file's own edge. The derived copy changes the
              // viewBox and nothing else. Delete it when he re-exports.
              //
              // 185.30px wide on his artwork. Height follows the file's own
              // aspect so the mark is never squashed to hit a round number.
              className="h-auto w-[185px] max-w-full"
            />
            {/* Bold 16pt over 23pt leading. Two lines, and they are two lines on
                his artwork rather than one that happens to wrap, so they are
                written as two. */}
            <p className="mt-8 text-base font-bold leading-[1.45] text-white">
              {f.tagline.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </p>
            {/* Regular 14pt over 24pt leading. */}
            <p className="mt-5 max-w-[22rem] text-sm leading-[1.7] text-white">
              {f.blurb}
            </p>
            {/* Bold 14pt inside a 1pt stroke, no fill. */}
            <Link
              href={`${basePath}${f.quote.href}`}
              className="mt-8 inline-flex items-center justify-center rounded-md border border-white px-10 py-3 text-sm font-bold text-white transition-colors hover:bg-white hover:text-[#4D5538]"
            >
              {f.quote.label}
            </Link>
          </div>

          {/* SHOP. The categories are the shop's own, not the list on the
              artwork: he copied that from the wrong file and said so. */}
          <div>
            <h3 className={l.heading}>SHOP</h3>
            <ul className="mt-4 space-y-3">
              <li>
                <Link href={`${basePath}/products`} className={l.link}>
                  {f.allProducts}
                </Link>
              </li>
              {categoryLinks}
              <li>
                <Link href={`${basePath}/products`} className={l.link}>
                  {f.viewMore}
                </Link>
              </li>
            </ul>
          </div>

          {f.columns.map((column) => (
            <div key={column.heading}>
              <h3 className={l.heading}>{column.heading}</h3>
              <ul className="mt-4 space-y-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={
                        link.href.startsWith("http")
                          ? link.href
                          : `${basePath}${link.href}`
                      }
                      className={l.link}
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* POLICIES, from the database rather than a list in the code. The
              shared footer learned that the hard way: a hardcoded pair named
              two policies this shop does not have. */}
          <div>
            <h3 className={l.heading}>POLICIES</h3>
            <ul className="mt-4 space-y-3">
              {orderedPolicies.map((policy) => (
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
          {/* FOLLOW US: under the columns, starting at SUPPORT and running to the
              right edge, which is where his artwork puts it.
              It was offset a third of the way across and he marked it: "The FOLLOW
              US needs to go right, it is way out of place." Placed by grid column
              now rather than by a percentage margin, so it stays aligned with the
              column above it if the column count ever changes. */}
          <div className="mt-12 md:col-start-6 md:col-span-2">
            <h3 className={l.heading}>{f.followUs}</h3>
            <ul className="mt-5 flex flex-wrap items-center gap-3">
              {f.social.map((icon) => (
                <li key={icon.name}>
                  <Link
                    href={icon.href}
                    aria-label={icon.name}
                    className="flex h-[37px] w-[37px] items-center justify-center transition-opacity hover:opacity-70"
                  >
                    <Image
                      src={`/brand/icon-${icon.name}-business.svg`}
                      alt=""
                      width={37}
                      height={37}
                      // His files are dark artwork, and his design draws them
                      // white on the green. Inverted here rather than by editing
                      // twelve of his SVGs: the files stay exactly as he sent
                      // them, which matters when he sends a revision.
                      className="h-[37px] w-[37px] brightness-0 invert"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* The strip under it, his #313F22, with the copyright in bold 11pt. */}
      <div style={l.bar}>
        <div className="container mx-auto px-4 py-5 text-center text-[11px] font-bold sm:px-6 lg:px-8">
          &copy; <CurrentYear /> {legalName}. {t("allRightsReserved")}
        </div>
      </div>
    </footer>
  );
}
