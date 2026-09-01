/**
 * The shape of the content module, with placeholder words.
 *
 * ── why this file exists ─────────────────────────────────────────────────────
 *
 * `content.ts` sits next to this one and is gitignored, because it holds a real
 * client's copy, his brand, his founder's story and his third party site
 * tokens, and this repository is public. Without a committed example, anyone
 * cloning this repository gets four unresolved imports and a build that fails
 * before it renders anything.
 *
 * Copy this file to `content.ts` and replace the words. Keep the exports and
 * their shapes: `home.ts`, `pages.ts`, `SiteScripts.tsx` and `seo.ts` are typed
 * against them.
 *
 * ── why the words are not in here ────────────────────────────────────────────
 *
 * Structure and wording are deliberately separate. Which blocks a page has, and
 * in what order, is code. What they SAY is content, and content moves to a CMS
 * later. When it does, this file is deleted and nothing that renders it
 * changes.
 *
 * Everything is keyed by shop, using the same lowercase country code as
 * `NEXT_PUBLIC_DEFAULT_COUNTRY`. That is not decoration: the first build of the
 * real site served one country's home page words on another country's shop,
 * because the copy had been read off one site and reused. The client caught it.
 */

/** Home page copy, per shop. Consumed by `home.ts`. */
export const HOME_BY_SHOP = {
  us: {
    hero: {
      heading: "Welcome to the store",
      body: [
        "One paragraph per entry, in order.",
        "A line starting with '- ' renders as a bullet.",
      ],
      ctaLabel: "Shop now",
    },
    rows: {
      standouts: "Standout products",
      onSale: "On sale",
      combos: "Combos",
      newProducts: "New arrivals",
      viewAll: "View all",
      viewAllNew: "View all new",
      viewAllSale: "See what is on offer",
    },
    about: {
      heading: "About us",
      body: ["Who you are, in a paragraph or three."],
    },
    notice: {
      heading: "Shipping",
      body: "One line across the page. Shipping times, customs, anything short.",
    },
    subscribe: {
      heading: "Stay in touch",
      body: "What they get for handing over an email address.",
      buttonLabel: "Subscribe",
    },
  },
} as const;

/**
 * Content pages, per shop, keyed by URL slug.
 *
 * The page SETS differ between shops, not only the words: one shop has a
 * "buy-local" page and another does not. Linking a shop to a page it does not
 * have puts a 404 in its own footer, so each shop lists only its own.
 *
 * The `faq` slug is parsed rather than printed: see `parseFaq` in `pages.ts`.
 * Lines in capitals become section headings and lines starting `Q:` become
 * questions, so the flat list below turns into an accordion.
 */
export const PAGES_BY_SHOP: Record<
  string,
  Record<string, { heading: string; body: readonly string[] }>
> = {
  us: {
    about: {
      heading: "About us",
      body: ["One paragraph per entry."],
    },
    faq: {
      heading: "Frequently asked questions",
      body: [
        "ORDERS AND SHIPPING",
        "Q: When will my order arrive?",
        "Two to five working days.",
        "Q: Do you ship overseas?",
        "Yes, to most countries.",
      ],
    },
  },
};

/**
 * The footer's own column: this shop's pages, and its links off site.
 *
 * Per shop for the same reason as the page set above.
 */
export const SITE_LINKS: Record<
  string,
  {
    heading: string;
    /**
     * One ordered list, not pages and then outside links.
     *
     * A real footer column ran contact, about, blog, faq, shops: the blog is an
     * outside link sitting in the middle of the shop's own pages. Rendering the
     * internal ones first and the outside ones after put the blog below the faq,
     * which is a different column from the one being copied.
     *
     * `slug` becomes /pages/<slug>, `path` is a route on this shop used as given,
     * `href` is somewhere else entirely and opens in a new tab.
     */
    links: { label: string; slug?: string; path?: string; href?: string }[];
  }
> = {
  us: {
    heading: "Company",
    links: [
      { label: "Contact us", path: "/contact" },
      { label: "About us", slug: "about" },
      { label: "Blog", href: "https://example.com/blog" },
      { label: "FAQ", slug: "faq" },
    ],
  },
};

/**
 * Third party scripts and search engine wording, per shop.
 *
 * `head` and `bodyEnd` are injected as raw HTML, exactly as pasted from the
 * provider. Analytics and pixels belong in `head`; chat widgets and anything
 * else that can wait belong in `bodyEnd`, so neither holds up the first paint.
 *
 * These are per shop and NOT shared. Each site has its own analytics property,
 * its own pixel and its own chat inbox, so one copy reused across shops files
 * every country's traffic under one country's account.
 *
 * `seoTitle` is a whole home page title and is used as the default, not as the
 * template: inner pages are titled "Page | Store name" from the store name
 * alone. Leave both SEO fields empty to fall back to the generic title.
 */
export const SCRIPTS_BY_SHOP: Record<
  string,
  { head: string; bodyEnd: string; seoTitle: string; seoDescription: string }
> = {
  us: {
    head: '<script src="https://analytics.example.com/script.js" async defer></script>',
    bodyEnd: '<script src="https://chat.example.com/widget.js" async></script>',
    seoTitle: "Store name | What you sell",
    seoDescription:
      "One sentence a search engine can show under the title. Around 150 characters.",
  },
};

/**
 * This shop's images. Files go in `public/brand`, which is gitignored for the
 * same reason as this module: they are the client's brand, not this project's.
 *
 * Per shop, not one set shared. A social card carries the shop's own artwork
 * and its own domain, so one card reused across shops shows the wrong country
 * in every link preview but one.
 *
 * Everything is optional and every consumer copes with it missing: a build with
 * no images renders a working site showing the shop name as text, rather than a
 * site full of broken image icons.
 */
export const BRAND_BY_SHOP: Record<
  string,
  {
    logo?: string;
    logoFooter?: string;
    favicon?: string;
    og?: string;
    hero?: { src: string; alt: string };
    about?: { src: string; alt: string };
  }
> = {
  us: {
    logo: "/brand/logo.png",
    favicon: "/brand/favicon.png",
    og: "/brand/og-us.jpg",
    hero: { src: "/brand/hero-us.jpg", alt: "What you sell" },
    about: { src: "/brand/about.jpg", alt: "Your workshop, your team" },
  },
};

/**
 * The footer's legal name and social links, per shop.
 *
 * `legalName` is the copyright line and it is NOT the store name. A shop can
 * call itself one thing in the header and something longer in the copyright.
 * The value to use is whatever sits in spree_stores.name for that shop.
 */
export const FOOTER_BY_SHOP: Record<
  string,
  { legalName?: string; social?: { label: string; href: string }[] }
> = {
  us: {
    legalName: "Store name | What you sell",
    social: [{ label: "Instagram", href: "https://example.com" }],
  },
};
