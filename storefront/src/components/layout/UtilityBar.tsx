import Image from "next/image";
import Link from "next/link";
import { UTILITY_BAR_BY_SHOP } from "@/lib/blocks/content";
import { shopKey } from "@/lib/shop-key";

interface UtilityBarProps {
  basePath: string;
}

/**
 * The strip above the header on the business shop.
 *
 * ── what this is, and why it is not the announcement bar ────────────────────
 *
 * AnnouncementBar renders one centred sentence, which is what the six retail
 * and wholesale shops have. The business design he sent on 4 Sep puts something
 * else in that position: three groups on one line, left, centre and right, with
 * an icon in two of them and a link in the third.
 *
 * Widening AnnouncementBar to cover both would have made every shop's bar carry
 * a layout only one of them uses. This renders nothing at all for a shop with no
 * entry in the map, so the other six are untouched by its existence.
 *
 * ── the numbers are his, from the artwork ──────────────────────────────────
 *
 * 36px tall, ground #4D5538, text Inter Regular 11pt, icons 12.66px high at
 * 1.5pt stroke, and the middle group separated by pipes. All of it is written on
 * the design rather than measured off it, which is the first time on this
 * project that has been true: every other palette here was sampled out of a JPEG
 * and two of them recorded a disagreement between the note and the pixels.
 *
 * The icons are his own SVGs from the same zip, not substitutes from a library.
 * A shield for the trust line and an envelope for contact.
 *
 * ── the copy lives in the gitignored file ──────────────────────────────────
 *
 * Same rule as the announcement bar beside it. The words are his, this
 * repository is public, and check_no_client_data is what enforces the
 * distinction rather than anybody's memory.
 */
export function UtilityBar({ basePath }: UtilityBarProps) {
  const bar = UTILITY_BAR_BY_SHOP[shopKey()];
  if (!bar) return null;

  return (
    <div
      className="w-full"
      style={{ backgroundColor: "#4D5538", color: "#FFFFFF" }}
    >
      <div className="mx-auto flex h-9 max-w-[1400px] items-center justify-between gap-4 px-4 text-[11px] sm:px-6 lg:px-8">
        {/* Left: the trust line. Hidden on small screens rather than wrapped,
            because a 36px bar cannot take a second line without becoming a
            different thing from the one he drew. */}
        <span className="hidden items-center gap-2 md:flex">
          <Image
            src="/brand/icon-shield-share-business.svg"
            alt=""
            width={13}
            height={13}
            className="h-[13px] w-[13px]"
          />
          {bar.trust}
        </span>

        {/* Centre: the four claims, pipe separated exactly as drawn. Rendered as
            separate spans with a drawn divider rather than as one string with
            "|" in it, so the divider can be dimmed without dimming the words. */}
        <span className="flex flex-1 items-center justify-center gap-2 text-center md:flex-none">
          {bar.claims.map((claim, i) => (
            <span key={claim} className="flex items-center gap-2">
              {i > 0 && (
                <span aria-hidden className="text-white/40">
                  |
                </span>
              )}
              <span className="whitespace-nowrap">{claim}</span>
            </span>
          ))}
        </span>

        {/* Right: help, then contact. The first is bold on his artwork and the
            second is not, so they are not one repeated treatment. */}
        <span className="hidden items-center gap-4 md:flex">
          <Link
            href={`${basePath}${bar.helpHref}`}
            className="flex items-center gap-1.5 font-bold hover:text-white/80"
          >
            <span aria-hidden>@</span>
            {bar.help}
          </Link>
          <Link
            href={`${basePath}${bar.contactHref}`}
            className="flex items-center gap-1.5 hover:text-white/80"
          >
            <Image
              src="/brand/icon-mail-business.svg"
              alt=""
              width={13}
              height={13}
              className="h-[13px] w-[13px]"
            />
            {bar.contact}
          </Link>
        </span>
      </div>
    </div>
  );
}
