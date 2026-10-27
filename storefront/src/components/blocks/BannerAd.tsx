import Image from "next/image";
import Link from "next/link";
import type { BannerAdBlock } from "@/lib/blocks/types";

interface BannerAdProps extends BannerAdBlock {
  basePath: string;
}

/**
 * His "Full-width Banner Advertisement": one image across the page.
 *
 * No artwork, no banner, on a live page. On the preview the same space is drawn
 * as a labelled frame at his banner height, so the order and the rhythm of the
 * page can be judged before the artwork exists.
 */
export function BannerAd({
  image,
  width = 1920,
  height = 400,
  alt = "",
  href,
  preview,
  basePath,
}: BannerAdProps) {
  if (!image) {
    if (!preview) return null;
    return (
      <section className="container mx-auto px-4 py-6 sm:px-6 lg:px-8">
        <div
          className="flex w-full items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 text-center text-neutral-500"
          style={{ minHeight: `${Math.round(height * 0.6)}px` }}
        >
          Full-width banner advertisement
          <br />
          (your artwork goes here)
        </div>
      </section>
    );
  }

  const picture = (
    <Image
      src={image}
      alt={alt}
      width={width}
      height={height}
      sizes="100vw"
      className="h-auto w-full"
    />
  );
  return (
    <section className="w-full">
      {href ? <Link href={`${basePath}${href}`}>{picture}</Link> : picture}
    </section>
  );
}
