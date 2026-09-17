import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { LIVERY } from "@/components/layout/footerLivery";
import { shopBrand } from "@/lib/blocks/brand";
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
  // The path and its size come from the same brand config the other six shops
  // read, rather than being written into this component. It was written in
  // here, pointing at a file derived from his, which nothing uses now: a path
  // written in two places is how one of them goes stale.
  const { logoFooter, logoFooterSize = { width: 596, height: 489 } } =
    shopBrand();
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
          {/* 16px of inside padding, from his note of 7 Sep: "We need to add
              some padding, maybe 15 - 20?" with an arrow at this block's left
              edge in his dev tools screenshot.
              Measured before changing it: the block had padding 0 on all four
              sides, and both the logo and the paragraph sat at exactly its left
              boundary, 0px gap. 16 is the middle of the range he gave and the
              nearest Tailwind step. */}
          <div className="md:col-span-2 md:p-4">
            {logoFooter && (
              <Image
                src={logoFooter}
                alt=""
                width={logoFooterSize.width}
                height={logoFooterSize.height}
                // His own export, unmodified. Nothing derives from his artwork
                // any more.
                //
                // What was here until 8 Sep was a copy of his 4 Sep SVG with a
                // wider viewBox, because that file declared a canvas 595.73
                // wide while its artwork measured 617.42 and clipped the last
                // letters of its own wordmark. He re-exported on 7 Sep and
                // re-sent it on 8 Sep, and the new file is correct: rendered
                // side by side with the old one at 185px, both words of the
                // wordmark are whole.
                //
                // Two things measured about it and deliberately left alone. It
                // is a raster, 596px wide against the 185px it renders at, so
                // 3.2x density and sharp on any screen. And it is cropped to
                // its own artwork with no margin, the last column and last row
                // stopping at alpha 191 rather than ramping to 0, which is
                // three quarters of one pixel at 596 wide and under a quarter
                // of a pixel where it is drawn. The breathing room he asked for
                // comes from the block's padding below, not from his file.
                //
                // 185.30px wide on his artwork. Height follows the file's own
                // aspect so the mark is never squashed to hit a round number.
                className="h-auto w-[185px] max-w-full"
              />
            )}
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
                {column.links.map((link) =>
                  // Same split as the social row below: a link off this site,
                  // including his https://# placeholders, is a plain anchor, and
                  // only a link INTO the shop goes through the router.
                  link.href.startsWith("http") ? (
                    <li key={link.label}>
                      <a href={link.href} className={l.link}>
                        {link.label}
                      </a>
                    </li>
                  ) : (
                    <li key={link.label}>
                      <Link href={`${basePath}${link.href}`} className={l.link}>
                        {link.label}
                      </Link>
                    </li>
                  ),
                )}
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
              column above it if the column count ever changes.

              Three columns, not two. Two put it exactly under SUPPORT, which is
              where his artwork starts it, but eight 37px icons plus their gaps
              need more width than two columns of this grid give, and they
              wrapped onto a second row. His drawing has them on one line, so the
              line wins and the block starts one column earlier. */}
          <div className="mt-12 md:col-start-5 md:col-span-3">
            <h3 className={l.heading}>{f.followUs}</h3>
            {/* It wraps. It used to be flex-nowrap, and the reason given was
                "so a row that no longer fits fails visibly in review rather
                than quietly folding onto a second line".
                That reasoning was wrong, and measuring it is what showed how.
                It does not fail visibly. Eight 37px icons and their seven gaps
                need 380px; a 390px phone offers 358 inside the container, so
                the row does not shrink or break, it pushes the document wider
                than the screen. Measured on the LIVE shop on 13 Sep:
                  390px  scrollWidth 396 vs 390   sideways scroll
                  768px  scrollWidth 838 vs 768   sideways scroll, 70px
                  430px and 1024px  no overflow
                A whole page that scrolls sideways on a phone is a worse fault
                than a second row of icons, and it is the one that shipped.
                His drawing still gets its single line everywhere it fits. */}
            <ul className="mt-5 flex flex-wrap items-center gap-3">
              {f.social.map((icon) => (
                <li key={icon.name}>
                  {/* A plain anchor, not next/link.
                      These are his placeholders until he sends the real
                      profiles, "Just do https://# for missing", and they are
                      outside this site either way. next/link tried to PREFETCH
                      each one and the router refused it fifteen times per page
                      in the console: "Cannot prefetch 'https://#' because it
                      cannot be converted to a URL". Nothing broke and nothing
                      rendered wrong, which is why it took a browser check to
                      see it at all. An external link does not want the router. */}
                  <a
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
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* The strip under it, his #313F22, with the copyright in bold 11pt. */}
      <div style={l.bar}>
        {/* Regular, not bold.
            His artwork annotated this line "Inter Bold 11pt" and that is what
            was built. On 7 Sep he sent a picture of the line with a new note on
            it, "Inter Regular 11pt", and said "change from bold to Regular".
            His second instruction wins over his first drawing. */}
        <div className="container mx-auto px-4 py-5 text-center text-[11px] sm:px-6 lg:px-8">
          &copy; <CurrentYear /> {legalName}. {t("allRightsReserved")}
        </div>
      </div>
    </footer>
  );
}
