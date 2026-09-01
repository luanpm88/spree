import type { Category } from "@spree/sdk";
import { User } from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { CartButton } from "@/components/layout/CartButton";
import { SearchToggle } from "@/components/layout/SearchToggle";
import { Button } from "@/components/ui/button";
import { shopBrand } from "@/lib/blocks/brand";
import { isWholesaleEnabled } from "@/lib/spree";
import { getStoreName } from "@/lib/store";

const LazyMobileMenu = dynamic(
  () =>
    import("@/components/layout/MobileMenu").then((mod) => ({
      default: mod.MobileMenu,
    })),
  {
    loading: () => (
      <div className="inline-flex items-center justify-center h-10 w-10" />
    ),
  },
);

const LazyRegionPreferences = dynamic(
  () =>
    import("@/components/layout/RegionPreferences").then((mod) => ({
      default: mod.RegionPreferences,
    })),
  {
    loading: () => <div className="size-11" aria-hidden="true" />,
  },
);

const storeName = getStoreName();

interface HeaderProps {
  basePath: string;
  locale: Locale;
  /**
   * The category navigation. Optional because a shop that is closed to visitors
   * without an account renders its sign-in and policy pages without it: the
   * category tree describes the catalogue, and describing the catalogue to
   * someone with no account is what that shop exists not to do.
   */
  mobileNavigation?: ReactNode;
}

interface HeaderMobileMenuProps {
  rootCategories: Category[];
  basePath: string;
}

export function HeaderMobileMenu({
  rootCategories,
  basePath,
}: HeaderMobileMenuProps) {
  return (
    <LazyMobileMenu
      rootCategories={rootCategories}
      basePath={basePath}
      wholesaleEnabled={isWholesaleEnabled()}
    />
  );
}

export async function Header({
  basePath,
  locale,
  mobileNavigation,
}: HeaderProps) {
  const t = await getTranslations({ locale, namespace: "header" });
  // The shop's own logo, with the environment variable kept as an override so a
  // storefront built outside this engagement can still point at a file of its own.
  const logoUrl = process.env.NEXT_PUBLIC_LOGO_URL || shopBrand().logo || "";
  // The shared wordmark's size is the fallback, because NEXT_PUBLIC_LOGO_URL can
  // point at a file this file knows nothing about. Five of the seven shops use
  // that wordmark, so it is the least wrong default there is.
  const logoSize = shopBrand().logoSize ?? { width: 557, height: 91 };
  const wholesaleEnabled = isWholesaleEnabled();

  // One header, every shop: burger left, logo centred.
  //
  // There was a per-shop horizontal menu here — logo hard left, three category
  // links across, the word SEARCH beside the glyph — built off his shot 05 and
  // measured against it to the pixel. Shot 05 is a photograph of his CURRENT
  // shop, sent as context, and it was read as a specification. He replied: "Not
  // sure why the menu got changed, this design is from the old shop, please
  // change this back to the new shop menu like all the others."
  //
  // So the rule that was missing, written down where the mistake was made: a
  // screenshot of the site he is replacing is evidence of what he is leaving,
  // not of what he is asking for. A note drawn ON a shot of OUR build is the
  // specification; a bare shot of his own is background.
  //
  // The word beside the search glyph and the 203px logo cap came from the same
  // shot in the same pass, so they go with it.

  return (
    <SearchToggle
      basePath={basePath}
      // A header with no navigation is a header on a closed shop's sign-in or
      // policy page, and search reads the same catalogue the navigation would
      // have described. The two travel together.
      searchable={mobileNavigation !== undefined}
      left={mobileNavigation}
      center={
        <Link href={basePath || "/"} className="flex items-center min-w-0">
          {/* The logo used to be hardcoded to /spree.png, so every shop built from
              this storefront wore the framework's logo. Falls back to the shop's own
              name as text, which is never wrong, rather than to somebody else's mark.
              Set NEXT_PUBLIC_LOGO_URL and drop the file in public/ to use an image.

              Height is fixed in CSS and the width follows the file, because his mark
              is a wide wordmark, about six to one. The old 90x32 box was nearly
              square, so it fitted the logo into a third of the height it had. */}
          {logoUrl ? (
            <Image
              src={logoUrl}
              alt={storeName}
              // The file's own size, per shop, not one pair of numbers for all
              // seven. It was 240 x 38, which is 6.32 to one and is none of the
              // three logos on this estate: they are 3.96, 6.12 and 6.37.
              width={logoSize.width}
              height={logoSize.height}
              // Pinned, so the width cannot follow whichever candidate happens
              // to decode. Drawn at a fixed height with width auto, an <img>
              // takes its ratio from the DECODED file, and a resized candidate
              // rounds: 1200 x 303 asked for at 256 comes back 256 x 65, which
              // is 3.9385 rather than 3.9604, which is 189.03 wide rather than
              // the 190.09 he measured off his own shop and wrote on a
              // screenshot. It moved the day the image optimizer started
              // working, and a gate on his stated values caught it.
              style={{
                aspectRatio: `${logoSize.width} / ${logoSize.height}`,
              }}
              className="h-[var(--logo-h)] w-auto max-w-[var(--logo-max-w)] object-contain"
              fetchPriority="high"
              loading="eager"
            />
          ) : (
            <span className="text-lg font-bold tracking-tight truncate">
              {storeName}
            </span>
          )}
        </Link>
      }
      rightStart={
        <div className="hidden lg:flex lg:items-center lg:gap-1">
          {/* Trade portal entry point — understated, secondary to the catalog nav.
              Only shown when the wholesale addon is enabled. */}
          {wholesaleEnabled && (
            <Link
              href={`${basePath}/wholesale`}
              className="px-2 py-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors whitespace-nowrap"
            >
              {t("wholesale")}
            </Link>
          )}
          <LazyRegionPreferences variant="header" />
        </div>
      }
      rightEnd={
        <>
          {/* Account - desktop only */}
          <div className="hidden md:block">
            <Button variant="ghost" size="icon-lg" asChild>
              <Link href={`${basePath}/account`} aria-label={t("account")}>
                <User className="size-5" />
              </Link>
            </Button>
          </div>

          {/* Cart */}
          <CartButton />
        </>
      }
    />
  );
}
