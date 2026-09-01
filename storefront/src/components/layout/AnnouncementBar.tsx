import { getTranslations } from "next-intl/server";
import { Inline } from "@/components/blocks/Inline";
import { ANNOUNCEMENT_BY_SHOP } from "@/lib/blocks/content";
import { shopKey } from "@/lib/shop-key";

interface AnnouncementBarProps {
  locale: Locale;
}

/**
 * The thin line above the header.
 *
 * On the client's current shop this sits before the opening `<header>` tag, not
 * in the footer, and it was missing here entirely. It came out of a line by line
 * comparison of his live pages against these ones: the same sentence was absent
 * from every page, which is what marks it as site furniture rather than page
 * copy.
 *
 * Translatable, so a shop that wants nothing there sets it empty and the bar
 * disappears instead of rendering a strip of blank green.
 */
export async function AnnouncementBar({ locale }: AnnouncementBarProps) {
  const t = await getTranslations({ locale, namespace: "announcement" });
  // His words for this shop if it has any, otherwise the shared line. One
  // string for six shops was right until two of them wanted different words:
  // his wholesale bar names the portal, the retail bars carry his
  // sustainability line.
  const shop = shopKey();
  const text = ANNOUNCEMENT_BY_SHOP[shop] ?? t("text");
  if (!text) return null;

  // The colours come from the theme, not from a branch here.
  //
  // This was `isAccountRequired() ? black : pale green`, which is a two-way
  // switch, and there are three answers now: his sixth shop wants #EAEEED with
  // #3D3D3D text. A third arm would have worked and the fourth would not,
  // because that shop also wants a coloured HEADER, and a boolean about whether
  // a shop needs an account was never going to know about that. Both live in
  // globals.css beside the rest of the palette.
  //
  // Through the inline formatter, because his bar sets the second half of the
  // sentence in bold and the first half plain. Rendered as a plain string the
  // markers would print themselves, which is how the FAQ answers once shipped
  // reading "through **Stripe** and **PayPal**".
  return (
    <div className="bg-[var(--bar)] text-[var(--bar-foreground)]">
      <p className="container mx-auto px-4 py-2 text-center text-xs sm:text-sm tracking-widest">
        <Inline text={text} />
      </p>
    </div>
  );
}
