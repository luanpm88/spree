import type { CustomField } from "@spree/sdk";
import { useTranslations } from "next-intl";

interface ProductCustomFieldsProps {
  customFields?: Array<CustomField>;
}

function renderBooleanValue(
  value: unknown,
  t: ReturnType<typeof useTranslations<"products">>,
): React.ReactNode {
  return value ? t("yes") : t("no");
}

function renderValue(
  field: CustomField,
  t: ReturnType<typeof useTranslations<"products">>,
): React.ReactNode {
  switch (field.field_type) {
    case "boolean":
      return renderBooleanValue(field.value, t);
    case "json":
      return typeof field.value === "string"
        ? field.value
        : JSON.stringify(field.value);
    case "rich_text":
      // Value is admin-authored HTML from the Spree CMS backend (trusted source)
      return <span dangerouslySetInnerHTML={{ __html: field.value ?? "" }} />;
    case "short_text":
    case "long_text":
    case "number":
      return String(field.value);
    default:
      return String(field.value);
  }
}

export function ProductCustomFields({
  customFields,
}: ProductCustomFieldsProps): React.JSX.Element | null {
  const t = useTranslations("products");

  if (!customFields || customFields.length === 0) {
    return null;
  }

  return (
    <div className="mt-8 border-t pt-8">
      <h2 className="text-lg font-medium text-gray-900 mb-4">
        {t("properties")}
      </h2>
      <dl className="space-y-3">
        {customFields.map((field) => (
          <div key={field.id} className="flex">
            <dt className="w-32 shrink-0 text-gray-500 text-sm">
              {field.label}
            </dt>
            {/* whitespace-pre-line. Each of these metafields is typed in the
                admin as one bullet per line:

                  • 18/8 304 Stainless Steel Material
                  • Brush finished Stainless Steel
                  • 2000ml (2.0L) volume

                A browser collapses every newline inside a plain block, so the
                product page ran them together into one wrapped paragraph and
                the bullet characters became punctuation in the middle of a
                sentence. The shop owner reported it as the product metafields
                having lost their format, and he was right: the text was always
                correct and the page was throwing its shape away.

                Same fault, same fix, as the bank transfer block in
                checkout/PaymentSection.tsx. */}
            <dd className="text-gray-900 text-sm min-w-0 whitespace-pre-line">
              {renderValue(field, t)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
