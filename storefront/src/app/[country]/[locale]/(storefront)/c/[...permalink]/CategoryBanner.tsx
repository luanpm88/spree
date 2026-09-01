import type { Category } from "@spree/sdk";
import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import { Breadcrumbs } from "@/components/navigation/Breadcrumbs";

interface CategoryBannerProps {
  category: Category;
  basePath: string;
  locale: string;
}

export async function CategoryBanner({
  category,
  basePath,
  locale,
}: CategoryBannerProps) {
  "use cache: remote";
  cacheLife("minutes");
  cacheTag("category-banner");

  return (
    <>
      {/* The 350px band belongs to the picture, so it only exists when there is
          one. Empty, it drew a tall grey box above every category with the title
          stranded at the bottom of it, and he boxed it: "Add this image block, it
          looks unfinished without an image."

          He is adding the pictures himself, category by category, so this has to
          read correctly in both states rather than only once he has finished. A
          category with no image now starts at its breadcrumbs. */}
      <div
        className={
          category.image_url
            ? "flex flex-col justify-end min-h-[350px] bg-gray-50 bg-cover bg-center"
            : "flex flex-col justify-end pt-6"
        }
        style={
          category.image_url
            ? { backgroundImage: `url(${category.image_url})` }
            : undefined
        }
      >
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <Breadcrumbs
            category={category}
            basePath={basePath}
            locale={locale}
          />

          <div className="mb-4">
            <h1 className="text-4xl font-bold text-gray-900">
              {category.name}
            </h1>
          </div>

          {/* Description.
              description_html first, and only then the plain field.

              The client writes these in the admin rich text editor: a bold
              heading, paragraphs, and a bulleted list of what a clearance item
              may have. The API returns BOTH a `description` and a
              `description_html`, and this rendered the plain one inside a <p>.
              On his stock clearance category that showed nothing at all, so a
              page he had written 767 characters of copy for came out with only
              its title.

              The HTML comes from his own admin editor, which is the same trust
              boundary as every other page his shop serves, and it is the only
              form that carries the bold and the list he typed. The plain field
              stays as the fallback, wrapped in whitespace-pre-line so a value
              with newlines keeps them. */}
          {category.description_html ? (
            <div
              className="mb-4 text-gray-600 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1 [&_div]:mb-2"
              dangerouslySetInnerHTML={{ __html: category.description_html }}
            />
          ) : (
            category.description && (
              <p className="mb-4 text-gray-600 whitespace-pre-line">
                {category.description}
              </p>
            )
          )}
        </div>
      </div>

      {/* Subcategories */}
      {category.children && category.children.length > 0 && (
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 mt-4">
          <div className="flex flex-wrap gap-2 items-center border-b border-gray-100 pb-4">
            {category.children.map((child) => (
              <Link
                key={child.id}
                href={`${basePath}/c/${child.permalink}`}
                className="px-1.5 py-1 hover:bg-gray-100 rounded-lg text-gray-700 transition-colors"
              >
                {child.name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
