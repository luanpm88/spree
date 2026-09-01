import dynamic from "next/dynamic";
import Link from "next/link";
import { Suspense } from "react";
import { ProductCardSkeleton } from "@/components/products/ProductCardSkeleton";
import { Button } from "@/components/ui/button";
import type { CollectionBlock } from "@/lib/blocks/types";
import { getCategory, getCategoryProducts } from "@/lib/data/categories";
import { getProducts } from "@/lib/data/products";
import { isAccountRequired } from "@/lib/store";

const LazyProductCarousel = dynamic(
  () =>
    import("@/components/products/ProductCarousel").then((mod) => ({
      default: mod.ProductCarousel,
    })),
  { loading: () => <CarouselSkeleton /> },
);

function CarouselSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
      {[...Array(4)].map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}

interface CollectionProps extends CollectionBlock {
  basePath: string;
  currency?: string;
}

/**
 * Fetches the products for a block.
 *
 * ── why on_sale is not just another category ─────────────────────────────────
 *
 * His On Sale collection is a RULE BASED category (`automatic = true`), and the
 * 5.6 Store API does not serve those: it returns 85 of his 87 categories and the
 * two it drops are exactly the two automatic ones. Asking for it by id gets
 * nothing back, with no error.
 *
 * So this block asks the API for products and keeps the ones carrying a
 * compare-at price, which is what being on sale means. The client chose this
 * over converting the collection to a manual list, because it keeps working
 * without him maintaining anything.
 *
 * The over-fetch is deliberate. There is no on-sale filter in the API, so the
 * filtering happens here, and asking for `limit` items would return `limit`
 * items of which only some are discounted. 100 covers the largest shop (93
 * products) in one request.
 *
 * ── the field this actually reads, and the two that look right ───────────────
 *
 * `product.original_price` is null on every product, including ones that ARE
 * discounted: a clearance item priced 8.10 against 16.20 still reports null
 * there. And `product.price` is an OBJECT, not a number, so `Number(price)` is
 * NaN and a comparison against it is false for everything.
 *
 * The sale sits inside that object, as `compare_at_amount_in_cents`. Cents
 * because they are integers: comparing "8.1" against "16.2" as floats works
 * until a price lands on a value that does not round cleanly.
 *
 * The first version of this block used the two obvious fields and rendered
 * nothing at all, on a shop with 23 discounted products.
 */
// `fields` narrows the columns; `expand` is what brings a relationship back at
// all. They are separate parameters and naming `media` in `fields` does nothing
// on its own: measured against the running shop, /products?limit=2 returns no
// media key whatsoever, with or without the fields list, and the same request
// with expand=media returns 2 and 3 images for the first two products.
//
// Without it the cards on the home page have one photograph each, so the hover
// swap silently does nothing there while working perfectly on every category
// page, which is exactly how the client reported it: "it works in the spree
// section but not on the front page".
// Not `as const`: that makes expand a readonly tuple, and the param wants a
// mutable string[].
const CARD_QUERY: { expand: string[] } = {
  // fields is deliberately NOT passed here.
  //
  // `fields` does not only trim the JSON, Spree narrows the SQL SELECT to match.
  // thumbnail_url is not a column: the serializer computes it from
  // product.primary_media, which needs primary_media_id in the row. Without it
  // Active Record raises MissingAttributeError, the serializer turns that into a
  // null, and every product card renders with no img tag at all. The API answers
  // 200 and nothing is logged, which is how a shop went live showing grey boxes.
  //
  // The payload is larger. A shop with photographs is worth more than the bytes.
  // fields: PRODUCT_CARD_FIELDS,
  expand: ["media"],
};

async function fetchProducts(source: CollectionBlock["source"], limit: number) {
  if (source.kind === "category") {
    const response = await getCategoryProducts(source.id, {
      limit,
      ...CARD_QUERY,
    });
    return response.data ?? [];
  }

  const response = await getProducts({
    limit: 100,
    ...CARD_QUERY,
  });
  const onSale = (response.data ?? []).filter((product) => {
    const price = product.price as
      | { amount_in_cents?: number; compare_at_amount_in_cents?: number | null }
      | undefined;
    const now = price?.amount_in_cents;
    const before = price?.compare_at_amount_in_cents;
    return (
      typeof now === "number" && typeof before === "number" && before > now
    );
  });
  return onSale.slice(0, limit);
}

export async function Collection({
  heading,
  source,
  viewAll,
  limit = 8,
  basePath,
  currency,
}: CollectionProps) {
  const products = await fetchProducts(source, limit);

  // Where the heading's link goes.
  //
  // It used to be /products for every row, so all four rows on the home page led
  // to the same full catalogue. The client caught it: "need to go to the correct
  // link", on two of them, and "check all links for this section".
  //
  // Resolved from the category this row is already showing rather than written
  // into the page definition. A permalink written by hand is a permalink that
  // goes stale the first time somebody renames a collection in the admin, and
  // this block is the one piece of code that certainly knows which category it
  // is rendering.
  let href = viewAll?.href;
  if (viewAll && source.kind === "category") {
    try {
      const category = await getCategory(source.id);
      if (category?.permalink) href = `/c/${category.permalink}`;
    } catch {
      // Keep the row and its supplied link rather than losing the whole section
      // because one lookup failed.
    }
  }

  // A carousel with nothing in it is worse than no carousel: it reads as a
  // broken page. This is also the failure mode of every problem found during
  // the migration — a category whose counter said zero, products not published
  // to a channel — so the block refuses to render an empty row rather than
  // showing a heading over a blank space.
  if (products.length === 0) return null;

  return (
    // A hairline above each row on the wholesale shop. His rows are separated by
    // one, measured off his own screenshot at rgb(235,235,235) running the full
    // width of the row, and ours had none: a full scan of every row between the
    // header and the footer returned zero rules.
    //
    // An explicit colour rather than the border token, because they are not the
    // same colour. The token resolves to rgb(229,232,217), which carries his
    // brand's green tint; his rule here is neutral grey.
    <section
      className={`container mx-auto px-4 sm:px-6 lg:px-8 py-12${
        isAccountRequired() ? " border-t border-t-[#EBEBEB]" : ""
      }`}
    >
      <div className="flex items-center justify-between mb-8">
        {/* Upper case on the five retail shops, which is how his own rows are
            set and what he asked to have copied. His wholesale shop sets the
            same headings in sentence case and he crossed ours out on 20 Aug.
            Keyed on the gate, the same axis the footer livery uses. */}
        <h2
          className={`text-2xl font-bold tracking-wide${
            isAccountRequired() ? "" : " uppercase"
          }`}
        >
          {heading}
        </h2>
        {/* A pill, not a text link with an arrow. His own rows carry a filled
            olive button on the right of the heading, and he asked for this
            section copied as it is. The label is upper cased here rather than in
            the content file so the words stay readable for whoever edits them. */}
        {viewAll ? (
          <Button
            asChild
            // Olive on the retail shops, his brand colour, filled, which is
            // what he asked for there. Black on the wholesale shop: his own is
            // black and he crossed the olive one out.
            // Pure black, his own token. His storefront :root sets
            // --button: #000000 and --primary: #000000, and his EXPLORE
            // CATEGORY pill interior samples (0,0,0). Ours was bg-foreground,
            // #1C1D19, a green-cast near-black, so the page carried two blacks
            // and the one on the element he ticked was not his.
            // Shape only. The colour comes from the theme now: --primary is
            // #000000 under [data-shop="b2b"] and his olive under :root, so the
            // default variant is already right on both. It was hardcoded here
            // first, one element at a time, which is how the same olive kept
            // turning up on pages nobody had patched.
            className="rounded-full px-6 shrink-0 uppercase tracking-wide"
          >
            <Link href={`${basePath}${href}`}>{viewAll.label}</Link>
          </Button>
        ) : null}
      </div>
      <Suspense fallback={<CarouselSkeleton />}>
        <LazyProductCarousel
          products={products}
          basePath={basePath}
          currency={currency}
        />
      </Suspense>
    </section>
  );
}
