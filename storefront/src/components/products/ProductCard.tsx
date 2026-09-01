"use client";

import type { Product } from "@spree/sdk";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { memo } from "react";
import { HiddenPricePrompt } from "@/components/products/HiddenPricePrompt";
import { ProductImage } from "@/components/ui/product-image";
import { trackSelectItem } from "@/lib/analytics/gtm";
import { isAccountRequired } from "@/lib/store";

interface ProductCardProps {
  product: Product;
  basePath?: string;
  categoryId?: string;
  index?: number;
  listId?: string;
  listName?: string;
  fetchPriority?: "high" | "low" | "auto";
  /** Optional currency used for analytics; omit to skip the select_item event. */
  currency?: string;
}

export const ProductCard = memo(function ProductCard({
  product,
  basePath = "",
  categoryId,
  index,
  listId,
  listName,
  fetchPriority,
  currency,
}: ProductCardProps) {
  const t = useTranslations("products");
  const imageUrl = product.thumbnail_url || null;

  // The second photograph, revealed on hover.
  //
  // His current shop fades the first image out to show the next one, and he asked
  // for the same: the second shot is usually the lid, the fitting, or the bottle
  // from the back, and it is the reason to hover at all.
  //
  // Only when the product actually has a second one. A card that fades its only
  // image out on hover shows an empty grey square, which is worse than no effect.
  const media = (
    product as {
      media?: {
        position?: number;
        medium_url?: string;
        large_url?: string;
        alt?: string;
      }[];
    }
  ).media;
  const second =
    media && media.length > 1
      ? [...media].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[1]
      : undefined;
  const hoverUrl = second?.medium_url || second?.large_url || null;

  // Current display price
  const displayPrice = product.price?.display_amount;

  const currentAmountCents = product.price?.amount_in_cents;
  const originalAmountCents = product.original_price?.amount_in_cents;
  const compareAtAmountCents = product.price?.compare_at_amount_in_cents;
  const onSale =
    (currentAmountCents != null &&
      originalAmountCents != null &&
      currentAmountCents < originalAmountCents) ||
    (compareAtAmountCents != null &&
      currentAmountCents != null &&
      currentAmountCents < compareAtAmountCents);

  const strikethroughPrice = onSale
    ? ((product.original_price?.display_amount &&
      product.original_price.display_amount !== displayPrice
        ? product.original_price.display_amount
        : product.price?.display_compare_at_amount) ?? null)
    : null;

  const handleClick = () => {
    if (index != null && listId && listName && currency) {
      trackSelectItem(product, listId, listName, index, currency);
    }
  };

  return (
    <div className="group relative">
      {/* Image */}
      <div className="relative aspect-square bg-gray-100 rounded-md overflow-hidden">
        {/* Underneath, so the fade reveals it. Swapping the src instead would
            leave an empty frame while the second file downloads. */}
        {hoverUrl ? (
          <ProductImage
            src={hoverUrl}
            alt={second?.alt || product.name}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 50vw, 300px"
            iconClassName="w-16 h-16"
          />
        ) : null}
        <ProductImage
          src={imageUrl}
          alt={product.name}
          fill
          // Hover does one thing: fade to the product's second photograph. When
          // there is no second photograph it does nothing at all.
          //
          // It used to zoom the only image by 5% instead, which is a hover effect
          // on something that is not another product image. "Only hover on
          // product images if it can be done?" So the fallback is gone rather
          // than replaced: half the cards zooming and half swapping reads as two
          // different behaviours on one row.
          className={
            hoverUrl
              ? "object-cover transition-opacity duration-500 group-hover:opacity-0"
              : "object-cover"
          }
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 50vw, 300px"
          iconClassName="w-16 h-16"
          fetchPriority={fetchPriority}
        />
        {/* Upper case on the wholesale shop, where his own badge reads SALE.
            The word stays a translation key so each shop can say it in its own
            language; only the casing is ours. */}
        {onSale && (
          <span
            className={`absolute top-2 left-2 text-white text-xs font-medium px-2 py-1${
              isAccountRequired()
                ? // A full pill in his own brick red, not a rounded rectangle in
                  // Tailwind's red-500. Measured off his screenshot at
                  // rgb(172,64,54); --destructive is already his #C73528 and the
                  // difference is JPEG, so the token is used rather than a second
                  // near-identical red being invented.
                  //
                  // Only closing the CASE last time is why this comes back: the
                  // record said "his SALE in capitals; ours Sale", so the word was
                  // fixed and the shape and colour were never looked at.
                  " uppercase tracking-wide rounded-full bg-destructive"
                : " rounded bg-red-500"
            }`}
          >
            {t("sale")}
          </span>
        )}
      </div>
      {/* Content */}
      <div className="p-4">
        {/* One line on the wholesale shop, ellipsised, which is what his cards
            do. Ours wrapped to two, and on a row where one name wrapped and
            three did not it pushed that card's price a line below the other
            three, so the row lost its baseline. That was never recorded as a
            difference; it was found by looking at the rest of his picture
            rather than only at the marks on it. */}
        <h3
          className={`text-sm font-medium text-gray-900 group-hover:text-primary transition-colors ${
            isAccountRequired() ? "line-clamp-1" : "line-clamp-2"
          }`}
        >
          {/* Stretched link: the ::after overlay keeps the whole card clickable
              without wrapping the content in an <a> — HiddenPricePrompt renders
              its own link, and anchors can't nest. */}
          <Link
            href={`${basePath}/products/${product.slug}${categoryId ? `?category_id=${categoryId}` : ""}`}
            className="after:absolute after:inset-0"
            onClick={handleClick}
          >
            {product.name}
          </Link>
        </h3>

        {/* Struck price FIRST on the wholesale shop, then the price being
            charged, in his red. His two sale cards both read
            "$334.80  NZFrom: $267.84" in that order, the old one grey and struck
            and the new one red. Ours had it the other way round with the new
            price in black, which is the retail convention and is what the 5
            retail shops keep.

            The record for this shot said only "his reads NZFrom: $387.84; ours
            reads $387.84", so the label was noticed and the order, the colour
            and the weight were not.

            The NZFrom / NZ$ prefix itself is NOT set here. His own two rows in
            one screenshot disagree: Wholesale Opportunities reads "NZFrom:" and
            New arrivals reads "NZ$", both on non-sale cards. That is a question
            for him, not something to pick. */}
        <div
          className={`mt-2 flex items-center gap-2${
            isAccountRequired() ? " flex-row-reverse justify-end" : ""
          }`}
        >
          {displayPrice ? (
            <span
              className={`text-lg font-semibold ${
                isAccountRequired() && onSale && strikethroughPrice
                  ? "text-destructive"
                  : "text-gray-900"
              }`}
            >
              {displayPrice}
            </span>
          ) : (
            // Null price: a deliberate hide inside a HiddenPricingProvider
            // (renders a sign-in prompt), otherwise renders nothing.
            <HiddenPricePrompt />
          )}
          {onSale && strikethroughPrice && (
            <span className="text-sm text-gray-500 line-through">
              {strikethroughPrice}
            </span>
          )}
        </div>

        {!product.purchasable && (
          <span className="mt-2 text-sm text-gray-500">{t("outOfStock")}</span>
        )}
      </div>
    </div>
  );
});
