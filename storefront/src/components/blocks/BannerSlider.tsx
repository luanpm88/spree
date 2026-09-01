"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Inline } from "@/components/blocks/Inline";
import { Button } from "@/components/ui/button";
import type { BannerSliderBlock } from "@/lib/blocks/types";

/**
 * The full width sliding banner at the top of the commercial shop.
 *
 * His specification, on task 4430, was four lines for the whole front end and
 * this was the second of them:
 *
 *   "A full-width top sliding banner about 400-500px high"
 *
 * ── it must be a banner before it is a slider ───────────────────────────────
 *
 * The first slide is rendered by the server with `priority`, and the controls
 * only appear once there is more than one. So a shop with one image gets a plain
 * full width banner with no JavaScript needed to see it, and a shop with five
 * gets the same thing that then moves. Nothing about this page depends on the
 * slider working, which matters because a hero that needs a script to appear is
 * a hero that is blank on a slow phone.
 *
 * ── the height ──────────────────────────────────────────────────────────────
 *
 * His 400 to 500 is the desktop figure and is honoured exactly there. Below that
 * it scales: a 450px band on a 390px wide phone is most of the first screen, and
 * the products he wants underneath would start below the fold on every visit. So
 * the height steps up with the viewport and reaches his number at `md`.
 *
 * ── why it does not auto advance by default ─────────────────────────────────
 *
 * `intervalMs` is opt in. A carousel that moves on its own takes the choice away
 * from the reader, and it moves under the finger of somebody who is mid tap. It
 * also stops on hover and on focus when it is enabled, and it does not run at all
 * for a visitor who has asked for reduced motion. That last one is a real setting
 * on his customers' machines, not a theoretical one.
 */
export function BannerSlider({
  slides,
  height = 450,
  intervalMs = 0,
}: BannerSliderBlock) {
  const count = slides.length;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const go = useCallback(
    (next: number) => {
      if (count === 0) return;
      setIndex(((next % count) + count) % count);
    },
    [count],
  );

  useEffect(() => {
    if (count < 2 || !intervalMs || paused) return;
    // A visitor who has asked their machine to stop animating things means it.
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    const t = setInterval(() => setIndex((i) => (i + 1) % count), intervalMs);
    return () => clearInterval(t);
  }, [count, intervalMs, paused]);

  // No slides is not an error and must not be a hole in the page. The shop
  // renders without a banner until his images are in place, which is the state
  // this shop is in the day this ships.
  if (count === 0) return null;

  return (
    <section
      aria-roledescription={count > 1 ? "carousel" : undefined}
      aria-label={count > 1 ? "Banner" : undefined}
      className="relative w-full overflow-hidden bg-muted"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      // His number is the desktop height. The two smaller steps keep the
      // products he asked for underneath it above the fold on a phone.
      style={{ ["--banner-h" as string]: `${height}px` }}
    >
      <div className="relative h-[260px] sm:h-[340px] md:h-[var(--banner-h)]">
        {slides.map((slide, i) => {
          const active = i === index;
          const content = (
            <>
              <Image
                src={slide.src}
                alt={slide.alt}
                width={slide.width}
                height={slide.height}
                // The first one is the largest thing on the page and is above the
                // fold on every visit, so it is not lazy.
                priority={i === 0}
                sizes="100vw"
                className="h-full w-full object-cover"
              />
              {(slide.heading || slide.body) && (
                <div className="absolute inset-0 flex items-center">
                  {/* A wash rather than a solid panel: his photographs are the
                      point, and text laid straight onto a photograph is
                      unreadable on half of them. */}
                  <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-black/25 to-transparent" />
                  <div className="relative mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-8">
                    <div className="max-w-xl text-white">
                      {slide.heading && (
                        <h2 className="text-3xl font-bold leading-tight drop-shadow-sm sm:text-4xl md:text-5xl whitespace-pre-line">
                          <Inline text={slide.heading} />
                        </h2>
                      )}
                      {slide.body && (
                        <p className="mt-3 text-base leading-relaxed drop-shadow-sm sm:text-lg whitespace-pre-line">
                          <Inline text={slide.body} />
                        </p>
                      )}
                      {slide.href && slide.ctaLabel && (
                        <Button asChild className="mt-6">
                          <span>{slide.ctaLabel}</span>
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          );

          return (
            <div
              key={slide.src}
              // Every slide stays in the DOM and is faded, rather than being
              // unmounted. Unmounting makes the browser fetch the image again
              // each time round, and on his banners that is 400 KB a turn.
              className={`absolute inset-0 transition-opacity duration-700 ${
                active ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
              aria-hidden={!active}
            >
              {slide.href ? (
                <Link
                  href={slide.href}
                  className="block h-full w-full"
                  tabIndex={active ? undefined : -1}
                >
                  {content}
                </Link>
              ) : (
                content
              )}
            </div>
          );
        })}
      </div>

      {count > 1 && (
        <>
          <button
            type="button"
            onClick={() => go(index - 1)}
            aria-label="Previous banner"
            className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/85 p-2 text-black shadow transition hover:bg-white focus-visible:outline focus-visible:outline-2"
          >
            <span aria-hidden>&#8592;</span>
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            aria-label="Next banner"
            className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/85 p-2 text-black shadow transition hover:bg-white focus-visible:outline focus-visible:outline-2"
          >
            <span aria-hidden>&#8594;</span>
          </button>
          <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 gap-2">
            {slides.map((slide, i) => (
              <button
                key={`dot-${slide.src}`}
                type="button"
                onClick={() => go(i)}
                aria-label={`Banner ${i + 1} of ${count}`}
                aria-current={i === index}
                className={`h-2.5 rounded-full transition-all ${
                  i === index ? "w-6 bg-white" : "w-2.5 bg-white/60"
                }`}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
