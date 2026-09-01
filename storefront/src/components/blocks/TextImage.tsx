import Image from "next/image";
import Link from "next/link";
import { Inline, isBullet, plain } from "@/components/blocks/Inline";
import { Button } from "@/components/ui/button";
import type { TextImageBlock } from "@/lib/blocks/types";
import { isAccountRequired } from "@/lib/store";

/**
 * Text with an optional image beside it.
 *
 * Two of the client's home page sections are this block with different settings:
 * the hero (image right, plain background, contained) and the About panel (brand
 * green, image bleeding off the panel's edges). That is the test of whether a
 * block type is pulling its weight, one component producing two sections that
 * look nothing alike.
 *
 * ── the two layouts, and why the panel is not just the hero in green ──────────
 *
 * He drew boxes on three gaps around the About panel and wrote "No space" beside
 * each: above the green band, below it, and between the photographs and the
 * right hand edge. On his own shop the picture runs to the top, bottom and right
 * edges of the coloured band and only the text side is inset. A contained grid
 * cannot do that — the container's padding is exactly the gap he boxed — so the
 * panel breaks out of the container and the text column carries the inset on its
 * own.
 *
 * Read the other way round, "No space" produced MORE gap the first time: the
 * note was taken as a complaint that the sections were touching, and a margin
 * was added above the panel. That is why it came back a second time.
 */

// The existing tokens, not new ones. --primary is already his #707757, the
// green that passes AA under white text, and --destructive is already his
// #C73528. Adding a --brand-panel with the same value would mean two names for
// one colour and two places to change at the rebrand he mentioned.
const BACKGROUNDS = {
  default: "bg-background",
  muted: "bg-accent",
  brand: "bg-primary text-primary-foreground",
  // The wholesale panel. He sent this section as a pair: a red circle-slash on
  // our green band and a green TICK on his own BLACK one. Only the strike was
  // read, so the green came off and left white, which is neither of the two
  // things in his picture. Measured off his own screenshot: rgb(0,0,0), solid
  // from the top of the band to the bottom.
  //
  // It is also what brings the photograph back to the edges. `bleed` below is
  // keyed on there being a background at all, so dropping the key had silently
  // turned the full-bleed layout off and left the 111px white gap on the right
  // that he has already boxed and written "No space" beside, twice.
  dark: "bg-black text-white",
} as const;

export function TextImage({
  heading,
  body,
  image,
  imageSide = "right",
  cta,
  background = "default",
  isPageTitle = false,
  basePath,
}: TextImageBlock & { basePath: string }) {
  const hasImage = Boolean(image?.src);
  // A block that is only a picture is a picture, not a two column layout with
  // one empty column.
  //
  // His tracking page asks for exactly that, in those words: "Use your attached
  // image full content width, immediately below the introduction. I would not
  // put any additional text over this image. It already contains enough visual
  // information." Built as an ordinary text_image it drew the photograph into
  // half the page beside a blank column, which is neither full width nor below
  // anything.
  //
  // Keyed on there being no words at all rather than on a flag, so no existing
  // block can reach it: every one of them carries a heading or a paragraph.
  const imageOnly =
    hasImage && !heading && body.length === 0 && !cta;
  // A full bleed panel, as opposed to the hero, which stays inside the page
  // container. Keyed off the background because that is what makes it a panel:
  // a coloured band has edges to run a photograph up against, white does not.
  const bleed = background !== "default" && hasImage;

  const text = (
    <>
      {/* Through the formatter like every other string on this page. A heading
          is already bold, so a **bold** run inside one changes nothing you can
          see, but rendered as a plain string the markers print themselves.
          Three shops shipped a hero reading "Welcome to **<brand>**" because
          the copy is pulled off his live pages, where that word is bold, and
          this was the one field that did not go through Inline. */}
      {/* whitespace-pre-line so a heading his copy breaks in two stays broken.
          One shop's hero is two lines in his own mock, "Drink Different." then
          "Drinkware for life's moments.", and as a single string it ran on and
          wrapped wherever the column width happened to fall. Copy with no
          newline in it renders exactly as before, so the other six shops do not
          move. */}
      {/* A page title is an h1 and a subtitle, not one h2 holding both.
          Measured on the six business pages as they first shipped: no h1 on the
          page at all, the title and its subtitle both 30px weight 700 inside one
          element, and the section headings under them 24px. Six pixels between a
          page title and a section heading, and nothing for a screen reader or a
          search engine to read as the page's subject.

          Only when the block says it is the title. Every hero on every other
          page is untouched, because a hero is not a page title. */}
      {heading && isPageTitle ? (
        (() => {
          const [first, ...rest] = heading.split("\n");
          return (
            <>
              <h1 className="mb-2 text-4xl font-bold leading-tight lg:text-5xl">
                <Inline text={first} />
              </h1>
              {rest.length ? (
                <p className="mb-5 text-xl font-medium leading-snug text-muted-foreground whitespace-pre-line">
                  <Inline text={rest.join("\n")} />
                </p>
              ) : null}
            </>
          );
        })()
      ) : heading ? (
        <h2 className="text-3xl font-bold mb-4 whitespace-pre-line">
          <Inline text={heading} />
        </h2>
      ) : null}
      {/* Through the same inline formatter as the other blocks, so a bold run or
          a link in this copy renders rather than printing its own markers on the
          page. That is not hypothetical: the FAQ answers shipped showing
          "through **Stripe** and **PayPal**" for exactly this reason, in the one
          block that had been missed. */}
      {body.map((paragraph) =>
        isBullet(paragraph) ? (
          <ul
            key={plain(paragraph).slice(0, 40)}
            className="mb-2 ml-5 list-disc leading-relaxed"
          >
            <li>
              <Inline text={paragraph.slice(2)} />
            </li>
          </ul>
        ) : (
          <p
            key={plain(paragraph).slice(0, 40)}
            // whitespace-pre-line, same as the heading above and for the same
            // reason. Several paragraphs in his documents are one paragraph
            // holding two or five LINES, joined by a soft break rather than by a
            // paragraph mark: a bold label with its description under it, and
            // the five-line "You'll remember the conversation." run. Rendered
            // without this they collapse into one long line, which is how they
            // shipped, and reading the .docx as flat text is what hid it: the
            // break carries no character, so the label and the sentence after it
            // arrive touching, "Everyday momentsAt work, studying".
            //
            // Copy with no newline renders exactly as before, so the other six
            // shops do not move.
            className="mb-4 leading-relaxed whitespace-pre-line"
          >
            <Inline text={paragraph} />
          </p>
        ),
      )}
      {cta ? (
        <Button
          asChild
          // Shape gated, colour from the theme. Only the wholesale shop has a
          // hero button at all, and its --primary is his #000000 now.
          className={`mt-2${
            isAccountRequired()
              ? " rounded-full px-8 uppercase tracking-wide"
              : ""
          }`}
        >
          {/* basePath in front, always. Without it the hero button on the
              wholesale shop points at /products rather than /b2b/en/products,
              which is a different market and, on a gated shop, straight back
              out to the sign-in page. It looks right in a screenshot and is
              wrong on the click. */}
          <Link href={`${basePath}${cta.href}`}>{cta.label}</Link>
        </Button>
      ) : null}
    </>
  );

  if (bleed) {
    return (
      // No vertical padding on the section itself: the photograph is what sets
      // the panel's height, and any padding here reappears as the green margin
      // he boxed. The text column carries the breathing room instead.
      <section className={BACKGROUNDS[background]}>
        {/* Two columns from 1280px, stacked below it.
            It used to split at 768px, and between 768 and 1279 the photograph
            was a third of a narrow panel while the text beside it was several
            hundred pixels taller, so the difference showed as panel colour. That
            is the same gap he has boxed twice on the desktop layout, and it was
            worse here on every shop, measured before anything was changed:

                768px    the five 351px band     the sixth 635px band
                1024px   the five 148px band     the sixth 427px band
                1280px   the five exact          the sixth  88px band

            Stacked, the photograph is the full width of the panel and its height
            follows its own shape, so there is nothing left over to show as
            colour. Nothing changes at 1280 and above, which is where he reviews:
            he is on a 1959px screen and the five the other five shops already filled
            their box exactly at every width from 1280 up. */}
        <div
          className={`xl:flex xl:items-stretch ${
            imageSide === "left" ? "xl:flex-row-reverse" : ""
          }`}
        >
          {/* 8 columns of 12, and no 536px cap.
              The cap came from him asking for a narrower column, and he has since
              reversed it: "it will be easier to make them bigger again and just
              leave them that size". Wider copy is also what shrinks the picture,
              because the panel is exactly as tall as the text beside it, and he
              called the picture way too big in the same breath.

              lg:pl lines the first word up with the product row headings above.
              The panel is full bleed, so it does not get the page container's
              inset for free and has to reproduce it. Measured against the row
              heading afterwards rather than assumed. */}
          <div className="flex min-w-0 flex-1 items-center px-4 py-12 sm:px-6 md:py-14 lg:px-8 lg:pl-[max(2rem,calc((100vw-1280px)/2+2rem))]">
            <div className="w-full xl:pr-10">{text}</div>
          </div>
          {/* A third of the panel, and never wider than the file itself.

              It was a flat third (col-span-4 of 12), which is 648px at a 1944px
              viewport and more than that above it. He was at 1959, so his box
              measured 653 wide against a 648 wide photograph and the browser
              stretched it. His note: "The problem with this image is that the
              code is changing the size it should be. The size this image should
              be is 648 x 756 px, then it will look clear and correct."

              max-w caps it rather than a fixed width replacing the third,
              because below about 1944px a third is SMALLER than the file and
              downscaling is sharp. Only the enlarging end was ever wrong. */}
          {/* A third of the panel, and never wider than the file itself.

              Do NOT derive this width from the panel height. It was tried, as
              `aspect-[648/756] h-full`, and it runs away: this column's width
              would depend on its own height, its height on the sibling text
              column's height, and that on the width left over. On the retail
              shops, whose 480 x 560 box already matches the file's 0.857
              exactly, the loop settled two steps out at 648 x 756 with the
              photograph no longer touching the panel edges, which is the gap he
              has boxed and written "No space" beside twice. Measured before and
              after on two shops, which is the only reason it was caught. */}
          <div className="xl:w-1/3 xl:max-w-[648px] xl:shrink-0">
            {image ? (
              <Image
                src={image.src}
                alt={image.alt}
                // The file's own dimensions. These were 800 x 600, which is a
                // different aspect ratio from the 648 x 756 on disk, so the
                // srcset was computed for a shape the photograph does not have.
                width={image.width ?? 648}
                height={image.height ?? 756}
                // Needed for the 648 in next.config.ts to be reachable: without
                // sizes, next/image builds the candidate list from `width` and
                // the device widths, and the smallest one at or above 648 is
                // 750. With it, the browser asks for 648 and the optimizer
                // passes the file through at its own size.
                sizes="(min-width: 1280px) 648px, 100vw"
                // cover, and it is safe now because the file changed, not
                // because the reasoning did.
                //
                // It was contain, deliberately. Against the old 648 x 792 file
                // cover took 29.3% off the WIDTH of this shop's panel, and that
                // artwork has words in it: what went was the left of "Made for
                // the Moments That Matter", down to "ade for the Moments". A
                // cropped photograph is a photograph; a cropped word is a
                // mistake.
                //
                // He remade the file on 25 August at 648 x 1069, which is the
                // shape of the panel rather than the shape of a product shot, so
                // the arithmetic is no longer the same arithmetic. Measured on
                // the file itself: his heading occupies x 164..523 of 648, and
                // the "Background image is AI generated" line he burns into the
                // bottom occupies x 233..422. The widest crop anywhere at or
                // above 1280px is 11.1%, at 1280 exactly, which keeps x 36..612
                // and clears his heading by 89px. At 1440 and above the box is
                // his file's own shape and nothing is cropped at all.
                //
                // The five the five shops cannot move: their box already equals
                // their file's aspect at every width from 1280 up, measured at
                // 1280, 1440, 1600 and 1920, so cover and contain are the same
                // rendering there. script/check_about_panel proves it on all
                // seven rather than trusting this paragraph.
                className="h-full w-full object-cover"
              />
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`${BACKGROUNDS[background]} py-16`}>
      {/* The same container as the product rows below, with no extra cap.
          It was held to 1176px because he asked for a narrower column, and he has
          reversed that: "Making the hero section and the about smaller does look
          better, but it now looks strange with the other parts, so it will be
          easier to make them bigger again". The strangeness was the hero sitting
          narrower than every row under it, so it lines up with them now. */}
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div
          className={`grid gap-10 items-center ${
            hasImage && !imageOnly ? "md:grid-cols-2" : "md:grid-cols-1"
          }`}
        >
          {/* Source order is text first so a screen reader and a narrow screen
              both get the words before the picture, whichever side the image is
              on visually. md:order- flips it only once there are two columns. */}
          <div className={imageSide === "left" ? "md:order-2" : ""}>{text}</div>

          {image ? (
            // Never drawn larger than the file is.
            //
            // "can you please check the hero image, it looks blurry", 26 August.
            // It is, and it is arithmetic rather than compression: measured on
            // the running shops, the column is 588px wide up to a 1440px
            // viewport and 716px from 1600 up, while every hero photograph he
            // has ever sent is 648 x 756. At his own 1959px screen the browser
            // was enlarging a 648px picture into a 716px box, 22%, and no
            // quality setting can put back detail that is not in the file.
            //
            // So the picture stops at its own width and centres in the column.
            // The column does not move, which matters because he reversed a
            // narrower hero once already: "it now looks strange with the other
            // parts, so it will be easier to make them bigger again". The 68px
            // left over is white on a white section, which is the one place a
            // gap costs nothing, unlike the About panel where it was green.
            //
            // Below 1600 nothing changes at all: the column is already narrower
            // than the file there.
            <div
              className={`${imageSide === "left" ? "md:order-1 " : ""}mx-auto w-full`}
              style={{ maxWidth: `${image.width ?? 648}px` }}
            >
              <Image
                src={image.src}
                alt={image.alt}
                // The hero photographs are the same 648 x 756 files as the About
                // ones, and these were 800 x 600 too: a 4:3 box declared for a
                // portrait picture, so every candidate width in the srcset was
                // computed for a shape none of the seven files has.
                //
                // Measured on the running sixth shop at a 1600px viewport: the
                // hero drew into 716 x 835 and fetched w=828, so a 648 wide file
                // was enlarged 28% by the optimizer and then drawn down again.
                // Not capped here, unlike the About panel: he named that one
                // image and capping the hero would narrow the column on a wide
                // screen, which is a layout change he has not asked for. The
                // measurement goes to him with the question instead.
                width={image.width ?? 648}
                height={image.height ?? 756}
                // Never ask for more than the file has.
                //
                // 50vw at his 1959px screen asks for w=1080 of a 648px wide
                // photograph, so the optimizer upscales on the server and the
                // browser draws that back down. Capping the request at the
                // file's own width means one resize, downward, which is the
                // sharp direction.
                sizes={
                  imageOnly
                    ? "(min-width: 1280px) 1280px, 100vw"
                    : `(min-width: 768px) ${image.width ?? 648}px, 100vw`
                }
                // Square on the wholesale shop. His hero photograph has no
                // corner radius: the pixel at its own top-left corner is
                // already image content. Ours carried rounded-lg, which on a
                // page whose every other edge is square reads as a different
                // design language. The 5 retail shops keep the radius, which is
                // what his retail pages have.
                className={`w-full h-auto object-cover${
                  isAccountRequired() ? "" : " rounded-lg"
                }`}
                // The hero is the largest thing above the fold on the page, so
                // it is the one image worth loading eagerly.
                priority
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
