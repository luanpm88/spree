import { cache } from "react";
import type { Surface } from "@/lib/spree";
import { getCategory } from "./categories";
import { getProduct } from "./products";

/** Expand list used on the product detail page. */
export const PRODUCT_PAGE_EXPAND = [
  "default_variant",
  "variants",
  "media",
  "option_types",
  "custom_fields",
  "categories.ancestors",
];

/** Slim expand used by generateProductMetadata (needs only the primary image for og:image). */
export const PRODUCT_METADATA_EXPAND = ["primary_media"];

/**
 * Minimal set of Product fields required to render a <ProductCard> and
 * fire listing analytics. Passed via the SDK's `fields` param on listing
 * fetches so Spree returns a narrowed payload — this shrinks the cached
 * entry, the RSC→client serialization, and the streaming HTML size.
 *
 * `categories` is included so `mapProductToGA4Item` can populate the
 * GA4 `item_category` attribute on view_item_list / select_item events.
 */
// ── why this list no longer names thumbnail_url's column dependencies ────────
//
// `fields` does not only trim the JSON. Spree narrows the SQL SELECT to match,
// and thumbnail_url is not a column: the serializer computes it from
// product.primary_media, which needs primary_media_id in the row. Ask for
// thumbnail_url without it and Active Record raises
//
//     ActiveModel::MissingAttributeError: missing attribute 'primary_media_id'
//
// which the serializer swallows into a null. The API answers 200, every product
// comes back with thumbnail_url: null, the card renders no img tag at all, and
// the shop shows grey boxes. The client found it before we did: "frontend is all
// blank for me".
//
// primary_media_id is listed explicitly for that reason. It is never read by the
// storefront; it is here so the column is in the SELECT.
export const PRODUCT_CARD_FIELDS = [
  "primary_media_id",
  "id",
  "name",
  "slug",
  "thumbnail_url",
  "purchasable",
  "default_variant_id",
  "price",
  "original_price",
  "categories",
  // The second photograph, for the hover swap on a card.
  //
  // His current shop fades the first image out on hover to reveal the next one,
  // and he asked for the same here: "my wife spent a lot of time getting photos
  // and setting this up". A card only has thumbnail_url otherwise, which is one
  // picture and no second to swap to.
  //
  // `media` rather than `images`: expand=images comes back empty on this API,
  // and expand=media is what actually carries the urls.
  "media",
];

export const getCachedProduct = cache(
  (slugOrId: string, expand: string[], surface: Surface = "dtc") =>
    getProduct(slugOrId, { expand }, surface),
);

export const getCachedCategory = cache(
  (idOrPermalink: string, expand: string[]) =>
    getCategory(idOrPermalink, { expand }),
);
