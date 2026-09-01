import { BRAND_BY_SHOP } from "@/lib/blocks/content";

/**
 * This shop's own images: logo, favicon, social card, home page photographs.
 *
 * The files sit in `public/brand`, which is gitignored, so everything here is
 * optional and every caller has to cope with nothing coming back. That is the
 * point: a build without the client's images renders a working site with no
 * logo, rather than a site with broken image icons where the logo should be.
 */
export interface ShopBrand {
  logo?: string;
  /**
   * The logo file's own pixel size.
   *
   * The header draws the mark at a fixed HEIGHT with width auto, so the width
   * comes from an aspect ratio. For an <img> that ratio is the one the browser
   * DECODED unless something pins it, and on 25 August something changed which
   * file gets decoded: the image optimizer started working, so the header began
   * receiving a resized candidate instead of the original.
   *
   * A resize rounds. 1200 x 303 asked for at 256 wide comes back 256 x 65, and
   * 256/65 is 3.9385 where 1200/303 is 3.9604. At a 48px height that is 189.03
   * wide instead of 190.09, and 190.09 is a number he measured off his own shop
   * and wrote on a screenshot. A gate caught it the same afternoon.
   *
   * So the ratio is pinned from these numbers and the decode cannot move it.
   * Three distinct logos across the seven shops, three distinct ratios, and the
   * component previously hardcoded 240 x 38, which is none of them.
   */
  logoSize?: { width: number; height: number };
  /**
   * The mark in the footer.
   *
   * Held back at first: it is mid grey artwork and the footer was the brand
   * green, which measured about 2:1 and would have repeated the contrast failure
   * the footer description already had. Rather than recolour somebody's logo in
   * CSS, it waited. He then asked for a grey footer with black text, which is
   * the background this file was drawn for, so it is in.
   */
  logoFooter?: string;
  /**
   * One file, used for the browser tab and for an iOS home screen alike.
   *
   * His retail shops sent favicon180.png and the wholesale one sent favicon260.png.
   * 180 square is exactly Apple's touch icon size, so there is nothing to gain from
   * carrying a second file: browsers downscale for the tab and iOS takes it as is.
   */
  favicon?: string;
  og?: string;
  hero?: { src: string; alt: string; width?: number; height?: number };
  about?: { src: string; alt: string; width?: number; height?: number };
}

const EMPTY: ShopBrand = {};

export function shopBrand(): ShopBrand {
  const shop = (
    process.env.NEXT_PUBLIC_DEFAULT_COUNTRY || ""
  ).toLowerCase() as keyof typeof BRAND_BY_SHOP;
  return BRAND_BY_SHOP[shop] ?? EMPTY;
}
