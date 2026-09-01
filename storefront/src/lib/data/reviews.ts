"use server";

/**
 * The approved reviews for one product.
 *
 * ── why this is a plain fetch and not the SDK ────────────────────────────────
 *
 * The endpoint is ours, added in app/controllers/spree/api/v3/store, because
 * Spree 5.6 ships no reviews and his rows had nothing reading them. The SDK only
 * knows the platform's own endpoints, so this calls the API directly with the
 * same header the SDK uses, x-spree-api-key. That header is not a detail worth
 * guessing at: every earlier attempt here sent Authorization Bearer and got 401
 * back, and read the 401 as "the API returns nothing".
 *
 * ── it never throws ─────────────────────────────────────────────────────────
 *
 * A product page must render whether or not reviews are reachable. A shop that
 * 500s because a reviews call failed is worse off than one showing no reviews,
 * so anything unexpected comes back as an empty set and the section draws
 * nothing.
 */
export interface ProductReview {
  id: number;
  rating: number;
  title: string | null;
  review: string | null;
  name: string | null;
  created_at: string | null;
}

export interface ProductReviewsResult {
  reviews: ProductReview[];
  count: number;
  average: number | null;
}

const EMPTY: ProductReviewsResult = { reviews: [], count: 0, average: null };

export async function getProductReviews(
  slug: string,
): Promise<ProductReviewsResult> {
  if (!slug) return EMPTY;

  try {
    // The same two variables the SDK initialises itself from. Read here rather
    // than through the SDK because this endpoint is ours, not the platform's.
    const base = process.env.SPREE_API_URL?.replace(/\/$/, "");
    const key = process.env.SPREE_PUBLISHABLE_KEY;
    if (!base || !key) return EMPTY;

    const res = await fetch(
      `${base}/api/v3/store/products/${encodeURIComponent(slug)}/reviews`,
      {
        headers: { "x-spree-api-key": key },
        // Reviews change rarely and a stale one costs nothing. The page is
        // already cached around this.
        next: { revalidate: 300 },
      },
    );

    if (!res.ok) return EMPTY;

    const body = (await res.json()) as {
      data?: ProductReview[];
      meta?: { count?: number; average_rating?: number | null };
    };

    const reviews = Array.isArray(body.data) ? body.data : [];
    return {
      reviews,
      count: body.meta?.count ?? reviews.length,
      average: body.meta?.average_rating ?? null,
    };
  } catch {
    return EMPTY;
  }
}
