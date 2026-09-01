import type { Locale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { getProductReviews } from "@/lib/data/reviews";

/**
 * The reviews his customers wrote, back in front of a customer.
 *
 * ── why this exists ─────────────────────────────────────────────────────────
 *
 * Every dump carries a spree_product_reviews table with his customers' words in
 * it. Spree 5.6 has no reviews of its own and the extension that wrote them is
 * not installed here, so from the day a shop moved the reviews were in the
 * database and nowhere else. He noticed: "reviews no longer show up".
 *
 * ── it renders nothing when there is nothing ────────────────────────────────
 *
 * Not an empty "Reviews (0)" heading. A product with no reviews on his old shop
 * showed no section at all, and a heading over a blank space reads as broken.
 * Measured before building this: across all seven shops there is exactly one
 * review, so on most products this component draws nothing, which is correct.
 */
interface ProductReviewsProps {
  slug: string;
  locale: string;
}

function Stars({ rating }: { rating: number }) {
  // Whole stars only. His data has integer ratings, and a half star drawn from
  // an integer is a decoration that claims a precision the row does not carry.
  return (
    // role="img" so the label is read out. A bare span has no role and a screen
    // reader drops the aria-label, leaving five decorative shapes and no rating.
    <span className="inline-flex" role="img" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg
          key={n}
          viewBox="0 0 20 20"
          aria-hidden="true"
          className={`h-4 w-4 ${n <= rating ? "fill-current" : "fill-current opacity-20"}`}
        >
          <path d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L1.5 7.7l5.9-.9z" />
        </svg>
      ))}
    </span>
  );
}

// "August 02, 2026", the way his live shop writes it, in the shop's own locale.
// Falls back to nothing rather than to an ISO string: a raw timestamp under a
// review is the kind of half-migrated detail he spots straight away.
function reviewDate(value: string | null, locale: string) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "long",
      day: "2-digit",
    }).format(d);
  } catch {
    return null;
  }
}

export async function ProductReviews({ slug, locale }: ProductReviewsProps) {
  const { reviews, count, average } = await getProductReviews(slug);
  if (count === 0) return null;

  // Read here rather than passed in from the page: the count is only known once
  // the reviews are fetched, and "(1 review)" versus "(2 reviews)" is chosen by
  // that number.
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "products",
  });

  return (
    <section className="container mx-auto px-4 sm:px-6 lg:px-8 py-12 border-t">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-6">
        <h2 className="text-xl font-semibold">{t("reviewsHeading")}</h2>
        {average != null && (
          <p className="flex items-center gap-2 text-sm">
            {/* His live shop prints the average, then the stars, then the count:
                "5.0 ★★★★★ (1 review)". Same order here so the page he compares
                against reads the same. */}
            <span className="font-medium">{average.toFixed(1)}</span>
            <Stars rating={Math.round(average)} />
            <span className="opacity-70">{t("reviewsCount", { count })}</span>
          </p>
        )}
      </div>

      <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {reviews.map((r) => {
          const when = reviewDate(r.created_at, locale);
          return (
            <li key={r.id} className="rounded-lg border p-5">
              {r.title && <h3 className="font-medium">{r.title}</h3>}
              <div className="mt-1 flex items-center gap-2 text-sm">
                <Stars rating={r.rating} />
                {when && <span className="text-xs opacity-60">{when}</span>}
              </div>
              {r.review && (
                <p className="mt-3 text-sm leading-relaxed opacity-80">
                  {r.review}
                </p>
              )}
              {/* Only when the reviewer allowed their name to be shown. The API
                  sends null otherwise, and the shop prints nothing rather than
                  inventing a word for an anonymous person. */}
              {r.name && <p className="mt-3 text-xs opacity-60">{r.name}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
