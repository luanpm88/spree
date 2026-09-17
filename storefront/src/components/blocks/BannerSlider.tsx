"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { IconFeatureRow } from "@/components/blocks/IconFeatureRow";
import { Inline } from "@/components/blocks/Inline";
import { BAND } from "@/components/layout/footerLivery";
import { Button } from "@/components/ui/button";
import type { BannerSlide, BannerSliderBlock } from "@/lib/blocks/types";

/**
 * The full width sliding banner at the top of the commercial shop.
 *
 * His specification, on task 4430, was four lines for the whole front end and
 * this was the second of them:
 *
 *   "A full-width top sliding banner about 400-500px high"
 *
 * On 13 Sep he sent Part 2 and the banner became the hero itself: "Hero slider
 * with mobile image with heading text and 4 icons". So a slide can now carry his
 * two headings, his four icons, his two buttons and a second photograph for
 * phones. Every one of those is optional and no earlier slide moves.
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
 * Two rules, because he has now given two different numbers and both are right.
 *
 * `height` is his original 400 to 500 and governs any slide with no words on it.
 *
 * A Part 2 slide is governed by his artwork instead: he labelled the banner
 * "Full Width 2560 x 933px", so from `md` up the band is 933/2560 of the
 * viewport width, which is his drawing exactly at every width. That works out at
 * 466px on a 1280 screen, which lands inside his original 400 to 500 and is how
 * the two numbers were confirmed to be the same design rather than a change of
 * mind. It is capped at 820px so a 3440px ultrawide does not open on a 1254px
 * photograph.
 *
 * Below `md` it is his portrait photograph and the height comes from the words,
 * because a fixed band that crops his heading is worse than a tall one.
 *
 * ── why the Part 2 hero has NO dark wash, and the phone one does ────────────
 *
 * Measured, both of them, rather than judged by eye.
 *
 * His ink (#4D5538) over the left third of the desktop banner reads at a median
 * contrast of 6.85:1, and 0.3% of that area falls below the 4.5:1 body-text
 * threshold. His design lays dark text straight onto that photograph and the
 * photograph supports it. A wash there would be painting over a picture that
 * does not need it.
 *
 * His phone photograph is the same scene and does not. 57% of it falls below
 * 4.5:1, because the dark window frames and the green plant sit at almost
 * exactly his ink colour: the worst pixel measures 1.00:1, which is his text
 * exactly invisible. Washing it white recovers it, and the floor was measured
 * rather than picked: 70% still leaves 11.5% of the area failing, 80% is the
 * first value at which nothing fails at all, and the gradient below holds 88%
 * over the whole area the words occupy.
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
  isPageTitle = false,
  basePath = "",
}: BannerSliderBlock & { basePath?: string }) {
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
  // this shop was in until 13 Sep.
  if (count === 0) return null;

  // A slide carrying his hero furniture sizes itself from his artwork; a plain
  // picture slide keeps the band height he asked for originally.
  const hero = slides.some((s) => s.features?.length || s.ctas?.length);

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
      <div
        className={
          hero
            ? // The first slide is in flow and carries the minimum height, so
              // this only has to be a positioning context for the others.
              "relative"
            : "relative h-[260px] sm:h-[340px] md:h-[var(--banner-h)]"
        }
      >
        {slides.map((slide, i) => (
          <SlideView
            key={slide.src}
            slide={slide}
            first={i === 0}
            asPageTitle={isPageTitle && i === 0}
            active={i === index}
            hero={hero}
            basePath={basePath}
          />
        ))}
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

function SlideView({
  slide,
  first,
  asPageTitle,
  active,
  hero,
  basePath,
}: {
  slide: BannerSlide;
  first: boolean;
  /** Render this slide's heading as the page's h1 rather than an h2. */
  asPageTitle: boolean;
  active: boolean;
  hero: boolean;
  basePath: string;
}) {
  // The tag, not the size. His type scale is set by the classes below either
  // way; this only decides whether the shop's home page has an h1.
  const Heading = asPageTitle ? "h1" : "h2";
  const light = slide.tone === "light";
  const hasWords =
    slide.heading || slide.body || slide.features?.length || slide.ctas?.length;

  const picture = (
    <>
      {/* His phone photograph, where he has sent one. Two <Image> elements
          rather than one with an art-directed srcset: they are different
          shapes, 1122x1402 against 2078x757, so they need different intrinsic
          dimensions and next/image takes one pair per element. The hidden one
          is display:none, so the browser never fetches it. */}
      {slide.mobileSrc && slide.mobileWidth && slide.mobileHeight ? (
        <Image
          src={slide.mobileSrc}
          alt={slide.alt}
          width={slide.mobileWidth}
          height={slide.mobileHeight}
          priority={first}
          sizes="100vw"
          className="h-full w-full object-cover lg:hidden"
        />
      ) : null}
      <Image
        src={slide.src}
        alt={slide.alt}
        width={slide.width}
        height={slide.height}
        // The first one is the largest thing on the page and is above the
        // fold on every visit, so it is not lazy.
        priority={first}
        sizes="100vw"
        className={`h-full w-full object-cover ${
          slide.mobileSrc ? "hidden lg:block" : ""
        }`}
      />
    </>
  );

  const content = hasWords ? (
    // In FLOW for his hero, absolute for a plain caption slide.
    //
    // The first version had it absolute in both cases and his hero was clipped
    // at the top and the bottom: the words are taller than the band on a 1440
    // screen, and an absolutely positioned child of an overflow-hidden band
    // simply loses whatever does not fit. His heading lost its top and both of
    // his buttons were cut in half.
    //
    // In flow the band cannot be shorter than his words, so the artwork height
    // becomes a minimum rather than a guillotine, and the photograph sits behind
    // it instead of around it.
    <div className={hero ? "relative" : "absolute inset-0 flex items-center"}>
      {light ? (
        // Phone only. The desktop photograph is measured to carry his ink
        // unaided; see the note at the top of this file for both numbers.
        <div
          aria-hidden
          className="absolute inset-0 lg:hidden"
          style={{
            background:
              "linear-gradient(to bottom, rgba(255,255,255,0.94) 0%, rgba(255,255,255,0.88) 62%, rgba(255,255,255,0.55) 82%, rgba(255,255,255,0) 100%)",
          }}
        />
      ) : (
        // A wash rather than a solid panel: his photographs are the point,
        // and text laid straight onto a photograph is unreadable on half of
        // them. This is the original treatment and every earlier slide keeps it.
        <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-black/25 to-transparent" />
      )}

      <div
        className={`relative w-full px-4 sm:px-6 ${
          hero
            ? // NO centred max-width on his hero, and that is the fix for a real
              // fault rather than a preference.
              //
              // It was max-w-[1600px] centred with lg:px-8. On a 1920 screen
              // that starts the words at 192px, and his design starts them at
              // 7.5% of the width. The column therefore ran 100px further right
              // than he drew it, and his subheading finished underneath the
              // bottles: "retail, healthcare" was printed across the middle
              // bottle, and so was "Door-to-door worldwide".
              //
              // His measurements, off the 2076px artwork: the words begin at
              // x=155 and end at x=1030, so 7.5% to 49.6% of the width. Padding
              // and column are expressed as exactly that, which keeps them in
              // his proportion at every width instead of only at the one where
              // a fixed container happened to agree with him.
              // 7vw and 3.4vw are his own 145px and 70px as fractions of his
              // 2076 canvas. Centring was wrong: his content sits high in the
              // band, 145 above and 70 below, and centring put it at 146/147.
              // It matched only because the content was 77px too short.
              "py-10 lg:px-[7.5vw] lg:pt-[7vw] lg:pb-[3.4vw]"
            : "mx-auto max-w-[1280px] py-10 md:py-0 lg:px-8"
        }`}
      >
        <div
          className={`min-w-0 ${
            hero
              ? // 43vw, not his 42: a single point of slack, because at 1440 his
                // heading needs 598px of the 605 that 42vw gives and this shop
                // does not run his Gotham. The bottles start at 55% of the
                // photograph, so 7.5 + 43 = 50.5% still clears them everywhere.
                "lg:w-[43vw]"
              : "max-w-xl"
          } ${light ? "" : "text-white"}`}
          style={light ? { color: BAND.ink } : undefined}
        >
          {slide.heading && (
            // 64.5px is his figure and it is his figure at his canvas width.
            // 64.5/2076 of the viewport holds his proportion at every width and
            // stops at his number, because the band it sits in is itself a
            // fraction of the viewport. Fixed at 64.5 it broke to three lines on
            // a 1440 screen; see the note on IconFeatureRow's `fluid`.
            <Heading
              className={`font-bold leading-[1.302] whitespace-pre-line ${
                light ? "" : "drop-shadow-sm"
              }`}
              style={
                hero ? { fontSize: "clamp(30px, 3.107vw, 79.5px)" } : undefined
              }
            >
              <Inline text={slide.heading} />
            </Heading>
          )}
          {slide.body && (
            // His 26px, on the same scale: 26/2076.
            <p
              // His gaps, measured ink to ink on his artwork and expressed as
              // the same fraction of his 2076 canvas that the type uses: 41px,
              // 40px and 62px. Fixed margins left his buttons 71px above where
              // he drew them, and the drift was cumulative down the block.
              className={`leading-snug whitespace-pre-line ${
                hero
                  ? "mt-[clamp(14px,1.97vw,50.6px)]"
                  : "mt-4 text-base sm:text-lg"
              } ${light ? "" : "drop-shadow-sm"}`}
              // BLACK, not the brand olive, and it is his drawing that says so.
              //
              // The whole text column is painted BAND.ink, so this paragraph
              // inherited #4D5538 along with the heading, the icons and the
              // buttons. On his artwork it does not: sampling the darkest 60
              // pixels of the heading returns #454D31 and of these two lines
              // #000000. He annotated #4D5538 on the heading and on the filled
              // button and left this one black, which reads as deliberate.
              style={
                hero
                  ? {
                      fontSize: "clamp(15px, 1.252vw, 32.1px)",
                      ...(light ? { color: "#000000" } : {}),
                    }
                  : undefined
              }
            >
              <Inline text={slide.body} />
            </p>
          )}

          {slide.features?.length ? (
            // Left aligned as a group inside the text column, which is where
            // his design puts them, rather than centred across the banner.
            <IconFeatureRow
              items={slide.features}
              fluid
              className="mt-[clamp(16px,1.93vw,49.3px)]"
            />
          ) : null}

          {slide.ctas?.length ? (
            <div className="mt-[clamp(18px,2.99vw,76.5px)] flex flex-wrap gap-4">
              {slide.ctas.map((cta) => (
                <HeroButton key={cta.label} cta={cta} basePath={basePath} />
              ))}
            </div>
          ) : slide.href && slide.ctaLabel ? (
            <Button asChild className="mt-6">
              <span>{slide.ctaLabel}</span>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  ) : null;

  const body = hero ? (
    // Photograph BEHIND, words in flow in front. The band is then never shorter
    // than his words at any width, and his artwork height acts as a floor.
    <>
      <div className="absolute inset-0">{picture}</div>
      {content}
    </>
  ) : (
    <>
      {picture}
      {content}
    </>
  );

  return (
    <div
      // Every slide stays in the DOM and is faded, rather than being
      // unmounted. Unmounting makes the browser fetch the image again
      // each time round, and on his banners that is 400 KB a turn.
      //
      // The FIRST hero slide is in normal flow and carries his artwork height as
      // a minimum, so it is what gives the band its height. Every other slide is
      // absolute over it. On a phone it is the words that set the height, which
      // an absolutely positioned slide has nothing to give its height to.
      className={
        hero && first
          ? // 480px floor below lg, because the band cannot be allowed to shrink
            // to the height of its own words.
            //
            // Measured on the production build at 768px: his words wrap to fewer
            // lines than on a phone, so the band collapsed to 346px, and the
            // white wash is expressed in percentages OF THAT HEIGHT. The result
            // was a white box. His photograph was still loading and still
            // painting, and at 88% wash over almost all of a 346px band the
            // bottles were ghosts. A hero with no picture in it is not his hero.
            //
            // 480 is the floor and not a fixed height: at 390px the band is
            // already 498 from the words alone, so the floor never bites on a
            // phone, and at 768 it gives the photograph back the room the wash
            // takes. The hero was never looked at at 768 until the production
            // check, which is the whole reason this comment exists.
            `relative flex min-h-[480px] flex-col justify-start transition-opacity duration-700 lg:min-h-[min(36.45vw,933px)] ${
              active ? "opacity-100" : "pointer-events-none opacity-0"
            }`
          : `absolute inset-0 transition-opacity duration-700 ${
              hero ? "flex flex-col justify-start" : ""
            } ${active ? "opacity-100" : "pointer-events-none opacity-0"}`
      }
      aria-hidden={!active}
    >
      {slide.href ? (
        <Link
          href={slide.href}
          className="block h-full w-full"
          tabIndex={active ? undefined : -1}
        >
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}

/**
 * One of his two hero buttons.
 *
 * Filled is #4D5538 with white text, outlined is his ink on a white ground with
 * his ink as the border, both read off the artwork. His own destinations:
 * "View Product Range" is the products listing, and "Request a Quaote" is
 * /pages/request-a-quote, which is where every other Request a Quote button on
 * his six business pages already goes rather than a new address invented here.
 *
 * A button with no href is drawn and visibly off, the same treatment the
 * FeatureList cards use, and for the same reason: dropping it was tried once and
 * he replied asking where the button had gone.
 */
function HeroButton({
  cta,
  basePath,
}: {
  cta: { label: string; href?: string; variant?: "solid" | "outline" };
  basePath: string;
}) {
  const outline = cta.variant === "outline";
  const shape =
    "inline-flex items-center justify-center whitespace-nowrap rounded-md font-semibold transition-opacity hover:opacity-90 " +
    // EQUAL width, because he drew them equal despite the labels differing.
    //
    // Measured on his artwork: the filled button runs x160 to x430 and the
    // outlined one x453 to x718, so 271 and 266 wide with a 23px gap. Sizing
    // each by its own label gave 251 and 224, which is his design with one
    // button visibly narrower than the other. The min-width is his 270 as the
    // same fraction of his canvas the rest of the hero uses.
    "min-w-[clamp(150px,13vw,333px)] px-[clamp(20px,2.12vw,54.3px)] py-[clamp(10px,0.82vw,21px)] text-[clamp(13px,0.867vw,22.2px)]";
  // TRANSPARENT, not solid white, and his own artwork is the evidence.
  //
  // It was #FFFFFF. Sampled inside his outlined button on two text-free rows,
  // just under the top border and just above the bottom one, it measures
  // rgb(235,234,233) and rgb(231,231,229) with a standard deviation of 4.7 across
  // the area. Flat white has no deviation and would sit above 246 on every
  // channel; not one of the 23 sampled pixels does. The texture is his
  // photograph showing through.
  //
  // On the phone the white wash sits behind it anyway, so the button reads as
  // near-white there without being painted white here.
  const paint = outline
    ? {
        backgroundColor: "transparent",
        color: BAND.ink,
        border: `1px solid ${BAND.ink}`,
      }
    : {
        backgroundColor: BAND.ink,
        color: "#FFFFFF",
      };

  if (!cta.href) {
    return (
      <span
        aria-disabled="true"
        title="The link for this button has not been supplied yet"
        className={`${shape} cursor-not-allowed opacity-40`}
        style={paint}
      >
        {cta.label}
      </span>
    );
  }

  return (
    <Link
      // basePath in front of an internal link, always. Without it a link on the
      // commercial shop points at /products rather than /nz/en/products.
      href={cta.href.startsWith("http") ? cta.href : `${basePath}${cta.href}`}
      className={shape}
      style={paint}
    >
      {cta.label}
    </Link>
  );
}
