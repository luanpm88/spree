import { THEME_BY_SHOP } from "@/lib/blocks/content";
import { shopKey } from "@/lib/shop-key";

/**
 * Which palette this build wears, as the value of `data-theme` on `<html>`.
 *
 * Undefined for a shop with no theme of its own, so the five retail shops keep
 * the palette in `:root` untouched.
 *
 * ── why this is a module of its own ──────────────────────────────────────────
 *
 * It was a private function inside DocumentShell, which was right while the
 * theme only had to reach the attribute. Two things now need to know the answer
 * in TypeScript rather than in CSS: the footer, whose livery is not only colours
 * but which case its links are set in, and anything else that has to branch on
 * the palette rather than be painted by it.
 *
 * Copying four lines into footerLivery.ts would have worked and would have been
 * the second place the mapping lived. That is precisely the shape of the fault
 * footerLivery's own header documents: a colour spelled out in two files, one of
 * which got converted, and a column of black links shipped on a black ground.
 *
 * The map itself stays in the gitignored content file, because its KEYS are the
 * client's shop names. Only the values, "black" and "green-blue", are his own
 * words for his own themes and safe in a tracked file. That distinction is not
 * academic: three separate commits had to be unpicked for putting a shop-name
 * key in tracked source, and this repo is public.
 */
export function shopTheme(): string | undefined {
  const shop = shopKey();
  return THEME_BY_SHOP[shop];
}
