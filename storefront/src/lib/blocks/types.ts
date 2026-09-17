/**
 * The blocks a page is made of.
 *
 * The client's shops today are a Rails page builder: each page is a list of
 * sections he can add, reorder and edit. Spree 5.6 drops that engine, so the
 * same idea is rebuilt here as typed React blocks.
 *
 * This file is deliberately the SHAPE and not the source. Today a page's block
 * list is a TypeScript file (see `pages/`), tomorrow it comes from the CMS. The
 * renderer, the components and the props do not change when that happens, which
 * is the whole point of defining them separately now.
 *
 * Seven block types were counted with him against his real pages. Anything that
 * cannot be expressed as one of these is a new block type and therefore new
 * work, so keeping this union small and explicit is what keeps the estimate
 * honest.
 */

/** Rich text with an optional image beside it. His hero and About sections. */
export interface TextImageBlock {
  type: "text_image";
  heading?: string;
  /** Paragraphs, in order. Plain strings so the CMS can hand them over as-is. */
  body: string[];
  /**
   * The photograph, and its own dimensions.
   *
   * width and height are optional and default to 648 x 756, which every file
   * was until 25 August. On that day one shop's About image came back 648 x 792
   * while its hero stayed 648 x 756, so a single pair of numbers in the
   * component became wrong for one of them. next/image builds its candidate
   * widths from what is declared, so declaring the wrong shape is exactly the
   * fault the client reported in the first place: "the code is changing the
   * size it should be".
   */
  image?: { src: string; alt: string; width?: number; height?: number };
  /** Which side the image sits on. His hero is image right, About is image left. */
  imageSide?: "left" | "right";
  cta?: { label: string; href: string };
  /**
   * Full-bleed background. His About section is a green panel on the retail
   * shops and a black one on the wholesale shop, and anything other than
   * "default" is what makes the photograph run to the panel's edges.
   */
  background?: "default" | "muted" | "brand" | "dark";
  /**
   * This block is the page's title.
   *
   * The first line of `heading` becomes the h1 and the rest becomes a smaller
   * subtitle under it. Without this the whole heading is one h2 with a line
   * break in it, which is how the six business pages shipped: "Custom Branding"
   * and "Your Brand. Your Products. Your Way." rendered at the same 30px weight
   * 700, the page had NO h1 at all, and the section headings below were 24px, so
   * six pixels separated a page title from a section heading. His comps set the
   * title about three times the size of a section heading.
   *
   * Off by default, so the hero on every other page and every other shop is
   * untouched: a home page hero is not a page title, it is a hero.
   */
  isPageTitle?: boolean;
}

/**
 * A row of products.
 *
 * `source` is either a Spree category id (`ctg_…`) or the special value
 * `on_sale`. The special case exists because his On Sale collection is a RULE
 * BASED category, and the 5.6 Store API does not serve those at all: it returns
 * 85 of 87 categories and the two it drops are exactly the two automatic ones.
 * Rather than ask him to maintain a manual list, the block filters on price,
 * which is what "on sale" means anyway.
 */
export interface CollectionBlock {
  type: "collection";
  heading: string;
  source: { kind: "category"; id: string } | { kind: "on_sale" };
  /** Link on the right of the heading. Omitted when there is nowhere to go. */
  viewAll?: { label: string; href: string };
  limit?: number;
}

/**
 * A full width banner that slides, at the top of a page.
 *
 * His specification for the commercial shop, in his own words on task 4430:
 *
 *   "A full-width top sliding banner about 400-500px high"
 *
 * The retail shops have no such thing. Their hero is a text block beside one
 * photograph, and it is the same photograph every visit. This is a different
 * shape and it is his, so it is a block of its own rather than a flag on
 * TextImageBlock: a hero states one thing well, and this one rotates.
 *
 * ── the height ──────────────────────────────────────────────────────────────
 *
 * `height` is his 400 to 500, in pixels, and it is the DESKTOP height. On a
 * phone a fixed 450px band is most of the screen, so the component scales it
 * down rather than letting one number govern every width. Declared here so a
 * shop can say what it wants instead of a number being buried in a component.
 *
 * ── why every slide carries its own dimensions ──────────────────────────────
 *
 * next/image needs real width and height or it reserves the wrong space and the
 * page jumps as each slide loads. The client's own files were served at 800x600
 * once while the srcset was computed for a shape none of them had, which is why
 * this asks for the file's true size rather than assuming a ratio.
 *
 * A slide may carry a link, and need not. A banner that goes nowhere is still a
 * banner; a banner that pretends to be clickable and is not is worse than one
 * that does not.
 */
/**
 * An icon over a bold line over a lighter line.
 *
 * One shape, three places, because his Part 2 design draws all three the same:
 * the four in the hero, the four in the trust band and the five in the supply
 * band are identical treatments at identical sizes. Measured on the annotated
 * artwork of 13 Sep rather than read off the picture: every one of his thirteen
 * icon files is exactly 63px tall, which is the number he wrote beside them
 * three times ("Icon 63px heigh").
 *
 * ── why the intrinsic width is carried ──────────────────────────────────────
 *
 * They are a common HEIGHT set, not a common size: the thirteen files run from
 * 44px to 86px wide at that 63px height. next/image needs the file's true
 * dimensions or it reserves the wrong box and the row jumps as each one loads,
 * so each icon states its own, and the component pins the height and lets the
 * width follow. Pinning both to a square would squash nine of the thirteen.
 */
export interface IconFeature {
  icon: string;
  /** The file's true pixel width. His run 44 to 86. */
  iconWidth: number;
  /** The file's true pixel height. His are all 63. */
  iconHeight: number;
  title: string;
  /** The lighter second line. "Built to last", "20+ years of experience". */
  body?: string;
}

export interface BannerSlide {
  src: string;
  alt: string;
  width: number;
  height: number;
  /**
   * A different file for narrow screens.
   *
   * His desktop banner is 2078x757 landscape and his mobile one is 1122x1402
   * portrait: not a crop of the same file, a different photograph of the same
   * scene. Cropping the landscape one to a phone would throw away the bottles,
   * which are the product. Absent, the desktop file is used at every width,
   * which is what the seven retail shops do.
   */
  mobileSrc?: string;
  mobileWidth?: number;
  mobileHeight?: number;
  /** Optional words drawn over the image. */
  heading?: string;
  body?: string;
  /**
   * Optional destination for the whole slide, and its single button.
   *
   * The one-button form, and it is what a banner with one destination uses. Left
   * exactly as it was: `ctas` below is the Part 2 addition and no existing slide
   * moves onto it.
   */
  href?: string;
  ctaLabel?: string;
  /**
   * How the overlaid words are painted.
   *
   * "dark" is the original and stays the default: white text over a dark wash,
   * which is what any slide written before this assumed.
   *
   * "light" is his Part 2 hero: his own ink straight onto a bright photograph,
   * with no wash at all. That is not a preference, it is measured. His ink
   * (#4D5538) over the left third of his banner reads at a median contrast of
   * 6.85:1, and 0.3% of that area falls below the 4.5:1 body-text threshold. A
   * dark wash there would be painting over a photograph that does not need it.
   */
  tone?: "dark" | "light";
  /** His four hero icons, drawn in a row under the body text. */
  features?: IconFeature[];
  /**
   * More than one button. His hero draws two, "View Product Range" filled and
   * "Request a Quaote" outlined.
   *
   * `href`/`ctaLabel` above are the single-button form and are left alone: they
   * are what a banner with one destination uses, and no existing slide moves.
   */
  ctas?: { label: string; href?: string; variant?: "solid" | "outline" }[];
}

export interface BannerSliderBlock {
  type: "banner_slider";
  slides: BannerSlide[];
  /** Desktop height in pixels. His range is 400 to 500. */
  height?: number;
  /** Milliseconds between slides. 0 or absent means it does not advance itself. */
  intervalMs?: number;
  /**
   * The first slide's heading is the page's h1.
   *
   * Same switch as TextImageBlock's isPageTitle and it exists for the same
   * reason. On 13 Sep this banner BECAME the business shop's hero, replacing a
   * text block that carried the h1, so the home page went from one h1 to none
   * and nothing failed: every heading still rendered, at the size his artwork
   * asks for. Found by counting headings in a browser before this shipped.
   *
   * Only the first slide, because every slide is in the DOM at once and a page
   * with four h1 elements is not better than a page with none.
   *
   * Off by default: on a page whose title is elsewhere, a rotating banner is
   * furniture, not the title.
   */
  isPageTitle?: boolean;
}

/**
 * A full-bleed band of icons: his trust banner and his supply banner.
 *
 * Two of the three things he asked for on 13 Sep, and they are the same block
 * twice: "Trust banner with 4 icons", "Supply banner with 5 icons".
 *
 * ── why this is not FeatureList ─────────────────────────────────────────────
 *
 * FeatureList is page CONTENT: a container, py-12, an h2, a grid of items that
 * may carry prose, bullets, cards and buttons. Fifteen groups across his six
 * business pages are that shape and they are signed off.
 *
 * This is FURNITURE: a full-bleed 195px band with no heading, a tinted ground,
 * vertical rules between the items and exactly two lines under each icon. Every
 * number in that sentence is one he wrote on the artwork. Bolting a band mode
 * onto FeatureList would put a branch through all fifteen of those groups to
 * serve two bands, which is how a change to one page breaks five others.
 *
 * The `items` are IconFeature, the same type the hero row uses, because his
 * design draws them identically. Building them as one shape is what stops the
 * hero icons and the band icons drifting to different sizes later.
 */
export interface IconBannerBlock {
  type: "icon_banner";
  items: IconFeature[];
  /** Band height in pixels. His figure, written twice on the artwork, is 195. */
  minHeight?: number;
}

/**
 * One product row per main category, built from the shop's own catalogue.
 *
 * His specification for the commercial shop, third of four lines on task 4430:
 *
 *   "Products showing below under Main categories, then show 4 products per
 *    category as static or scrolling"
 *
 * ── why this is not four CollectionBlocks ───────────────────────────────────
 *
 * The retail shops name three categories in the build (`standouts`, `combos`,
 * `new`) and pass their ids in as build args. That works when a shop has three
 * rows chosen by hand and they never change.
 *
 * This shop has thirteen main categories and he intends to add more: "Once the
 * main site is up I can do all the config inside the shop and create some
 * products." Wiring thirteen build args would mean a rebuild every time he adds a
 * category, and an id typed by hand is an id that can be wrong. So the rows are
 * read from his catalogue instead, and a category he creates tomorrow appears on
 * the home page without anybody being asked.
 *
 * ── which categories count as "main" ────────────────────────────────────────
 *
 * The roots, by default, because on this shop each main category IS a taxonomy of
 * its own: thirteen roots, measured on 1 Sep. On the retail shops the roots are
 * the filter axes (Colour, Size, ECO Values) and the real categories sit under a
 * root called Categories, so `under` names that root there. Getting this wrong
 * shows a shopper a row headed Colour, which is why it is a setting and not a
 * guess.
 *
 * An empty category renders nothing at all rather than a heading over a gap. On
 * the day this ships eleven of his thirteen are empty, so without that rule the
 * page would be a column of headings.
 */
export interface CategoryRowsBlock {
  type: "category_rows";
  /** Only categories under this root permalink. Absent means the roots. */
  under?: string;
  /** Products per row. His figure is 4. */
  perRow?: number;
  /** Cap on how many rows, so a shop with fifty categories is still a page. */
  maxRows?: number;
  /** Label for the link at the right of each heading. */
  viewAllLabel?: string;
  /** Permalinks to leave out, for a category that is not a shopping row. */
  exclude?: string[];
}

/** One line across the page. His shipping and customs notice. */
export interface NoticeBlock {
  type: "notice";
  heading?: string;
  body: string;
  tone?: "info" | "warning";
}

/**
 * Heading, a line of body, and one button.
 *
 * This is what stands where the subscribe box stands on the retail shops, on a
 * shop nobody may browse without an account. Asking a stranger for an email
 * address is the wrong thing there twice over, so his replacement invites the
 * enquiry instead: "Can't Find What You Need?", and a Contact Us button.
 *
 * It is its own shape rather than a NoticeBlock with a button bolted on. A
 * notice is a statement the page makes; this one asks for a reply, and the
 * button is the whole point of it rather than an ornament.
 */
export interface EnquiryBlock {
  type: "enquiry";
  heading: string;
  body: string;
  button: { label: string; href: string };
  /**
   * A band across the page rather than a narrow centred column.
   *
   * The block was written for the foot of the wholesale home page, where a
   * narrow centred column is the design. Dropped at the foot of the six business
   * pages it became an alignment break instead: measured, every other block on
   * those pages starts at x=112 and this one started at x=368, so a wide empty
   * column ran down the left of it. That is the shape he draws boxes around.
   *
   * Off by default, so the home page it was built for does not move.
   */
  wide?: boolean;
}

/** Email capture. Rebuilt at his request, with a name field beside the email. */
export interface SubscribeBlock {
  type: "subscribe";
  heading: string;
  body?: string;
  buttonLabel: string;
  /** He asked for a name to come in with the email. Off by default. */
  askForName?: boolean;
  /** A small line above the heading. His business design: "STAY INFORMED". */
  eyebrow?: string;
  /**
   * How the block is drawn.
   *
   *   default  the retail shops: bold heading on white, pill inputs.
   *   band     his business design of 13 Sep: a tinted full-width band, a light
   *            large heading in his olive, square-cornered inputs and button.
   *
   * A variant rather than a second component because the form, the action, the
   * consent line and the result message are the same, and those are the parts
   * that have broken before.
   */
  variant?: "default" | "band";
}

/** Raw HTML, the escape hatch his current page builder gives him. */
export interface EmbedBlock {
  type: "embed";
  heading?: string;
  /** An iframe URL. His Book a Meeting page embeds his own booking app. */
  src: string;
  height?: number;
  title: string;
  /**
   * Cap the frame's width.
   *
   * His quotation form lays itself out to 768px whatever it is given. In a
   * 1216px frame that left 518 CSS pixels of empty white down the right of every
   * field, for 2,960px of page: measured, the controls used 38% of the width.
   * It is the largest gap on that page and the first thing he would box.
   */
  maxWidth?: number;
}

/**
 * A list of files to download. His wholesale Resources page.
 *
 * href is optional, and that is not laziness. His copy names each document and
 * labels the button "Download PDF" without carrying a URL, because on his own
 * shop the file is attached in the page editor. Until he sends the three files
 * the row still has to render: the customer reads what the document is, and the
 * button appears the moment there is something behind it. A button that goes
 * nowhere is worse than no button.
 */
export interface DownloadsBlock {
  type: "downloads";
  heading?: string;
  items: { title: string; description?: string; href?: string }[];
}

/**
 * Questions that open to reveal their answer.
 *
 * The client asked for this on every shop: "make it a Question, then with a
 * dropdown to see the answer". His FAQ pages are long, 596 words on one of
 * them, and a wall of text is not something anyone reads on a phone.
 *
 * Sections carry the headings he already writes in capitals, ORDERS PAYMENTS &
 * REFUNDS and so on, so the shape follows his copy rather than asking him to
 * restructure it.
 */
export interface FaqBlock {
  type: "faq";
  heading?: string;
  sections: {
    title?: string;
    items: { question: string; answer: string[] }[];
  }[];
}

/** Plain prose. Policies, Buy Local. */
export interface RichTextBlock {
  type: "rich_text";
  heading?: string;
  body: string[];
}

/**
 * A heading over a list of labelled items, each with a line or two under it.
 *
 * The eighth block type, and the first added since the original seven were
 * counted against his pages. It is here because the four business pages he sent
 * on 25 August are built almost entirely out of one shape, repeated:
 *
 *   Custom Branding        7 branding methods, then 5 numbered process steps,
 *                          then 8 product categories
 *   Custom Manufacturing   7 capabilities, then 7 numbered steps, then 12
 *                          materials, then 9 things that can be modified
 *   Product Sourcing       6 criteria, then 5 numbered steps, then 8 needs,
 *                          then 3 linked services
 *   Track Your Order       a 9 item checklist, then 3 freight cards with their
 *                          own lists and buttons
 *
 * That is 15 groups across four pages. Written as rich_text they become 15 walls
 * of prose, which is the opposite of what his mockups draw, and written as 15
 * bespoke sections they become four pages nobody can edit. One block type earns
 * its place here in a way an eighth would not have before these arrived.
 *
 * `numbered` is what makes it a process rather than a grid: his steps are
 * numbered in the copy and in the drawing, and a numbered list that renders as
 * bullets loses the ordering he is describing.
 *
 * `items[].body` is an array for the same reason every other block's is: his
 * documents carry soft line breaks inside one paragraph, and joining them into
 * a single string is what produced "Everyday momentsAt work, studying" once
 * already.
 *
 * `columns` is a hint, not a layout. The component picks a sensible grid from
 * the item count and only uses this when he has asked for a specific one, which
 * he did once: "use a 2-column checklist rather than one long bullet list".
 */
export interface FeatureListBlock {
  type: "feature_list";
  heading?: string;
  /** Sits under the heading, before the items. */
  intro?: string[];
  numbered?: boolean;
  /**
   * 5 exists for one band and it is his: the feature strip across the bottom of
   * his front page design runs Premium Materials / Sustainable Choice / Bulk
   * Pricing / Global Shipping / Dedicated Support, five across. Forced into four
   * it breaks 4+1 and the last one sits alone under a row of four, which is
   * exactly the shape he draws a box around.
   */
  columns?: 2 | 3 | 4 | 5;
  /**
   * Heading in the shop's named accent colour.
   *
   * Used on the one block he asked for it on: "I'd use  #4c5537 green here",
   * written beside Tracking Times Can Change in his Track Your Order document.
   * Falls back to the ordinary foreground on any shop that has no accent token,
   * so the five retail shops cannot pick this up by accident.
   */
  accent?: boolean;
  /**
   * A tick before each item, for a list he wrote with ticks.
   *
   * His MyProjects checklist is written "✓ Production progress", nine lines of
   * it, and his instruction is "use a 2-column checklist rather than one long
   * bullet list". The ticks are in his copy, so they are his rather than an
   * invented icon: the eight-odd icons per section in his mockups are not here
   * for exactly that reason.
   */
  ticks?: boolean;
  /** Rendered under the items, smaller and muted. His "availability varies" lines. */
  footnote?: string;
  /**
   * A panel beside the items rather than under them.
   *
   * His tracking page asks for this in words: "Production & project tracking —
   * two-column section. Immediately underneath the image: LEFT — TEXT / RIGHT —
   * ACTION PANEL", with the muted line "under the button panel". Built as two
   * stacked full width sections instead, the action panel dropped below the
   * list and indented, and the muted note ended up above the panel it is meant
   * to sit beneath.
   *
   * One use so far, and it is the only place he has drawn a two-up band and
   * written out which side is which.
   */
  aside?: {
    heading: string;
    body?: string[];
    cta?: { label: string; href: string };
    /** The smaller muted line he asks for under the button. */
    note?: string;
  };
  items: {
    title: string;
    body?: string[];
    /** Bullets inside one item. The freight cards are the only use so far. */
    bullets?: string[];
    /**
     * A line UNDER the bullets, before the button.
     *
     * Each of his three freight cards ends with its own sentence about where the
     * tracking number comes from, and they differ: sea says "we'll provide the
     * relevant tracking link or reference number", air says to use the Air
     * Waybill number from the shipping information, rail says "where supported".
     * All three were first collapsed into one line under the group, with wording
     * partly invented to cover all three, and the string by string comparison
     * against his own document is what found it.
     */
    note?: string;
    cta?: { label: string; href: string };
  }[];
}

export type Block =
  | FaqBlock
  | TextImageBlock
  | BannerSliderBlock
  | IconBannerBlock
  | CategoryRowsBlock
  | CollectionBlock
  | NoticeBlock
  | EnquiryBlock
  | SubscribeBlock
  | EmbedBlock
  | DownloadsBlock
  | FeatureListBlock
  | RichTextBlock;

export interface PageDefinition {
  /** Used for the <title> and for finding the page in the CMS later. */
  name: string;
  blocks: Block[];
}
