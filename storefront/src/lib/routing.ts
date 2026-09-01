import { cleanUrlsEnabled } from "@/lib/store";

/**
 * The prefix every internal link is built from.
 *
 * One function rather than the same template literal in fourteen route files.
 * Routes live under /{country}/{locale}, and the client chose to keep that shape
 * when the alternative was put to him: his shops sell in one language today, and
 * he wants the room to sell in more without moving every address a second time.
 *
 * Everything downstream takes `basePath` as a prop and concatenates.
 *
 * This is NOT the only place that knows what the prefix looks like, and saying
 * so here was wrong. extractBasePath() in lib/utils/path is the other: 17 client
 * components recover the prefix from the current URL rather than take it as a
 * prop. Both have to agree, and under clean URLs both return "".
 */
export function basePathFor(country: string, locale: string): string {
  // Empty under clean URLs, and this one line is why every internal link
  // follows. 33 components take basePath as a prop and concatenate it, so there
  // is no second place that knows the prefix exists.
  //
  // Every consumer copes with "" already, which was checked rather than hoped:
  // pathWithinMarket("/x", "") returns "/x", so all three gate predicates keep
  // working; isWithinMarket("/x", "") admits any local path, which is right when
  // there is only one market in the URL space and cross-origin has already been
  // rejected by resolveLocalPath; and buildAccountLoginHref("") builds
  // "/account".
  if (cleanUrlsEnabled()) return "";
  return `/${country}/${locale}`;
}
