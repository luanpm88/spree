import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import EmbeddedForm from "@/components/contact/EmbeddedForm";
import { getStoreName } from "@/lib/store";

/**
 * Contact page. The form itself is hosted on the shop's own forms host and embedded,
 * so the wording, the fields and the captcha stay where the shop already edits them.
 *
 * The URL is configuration, not a constant: each shop points at its own form, and a
 * form id changes when the shop rebuilds it. NEXT_PUBLIC_ because the embed is rendered
 * in the browser. Note that NEXT_PUBLIC_* is baked at BUILD time, not read at runtime,
 * so changing it means a rebuild (see DISCOVERIES 2.13).
 *
 * The words above the form come from the messages file rather than from here, because
 * the shop writes them and will change them without us.
 */
const FORM_URL = process.env.NEXT_PUBLIC_CONTACT_FORM_URL ?? "";

interface ContactPageProps {
  params: Promise<{ country: string; locale: string }>;
}

export async function generateMetadata({
  params,
}: ContactPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "contact" });
  const storeName = getStoreName();

  return {
    title: `${t("title")} — ${storeName}`,
    description: t("metaDescription"),
  };
}

export default async function ContactPage({ params }: ContactPageProps) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "contact" });

  // One string, split on blank lines, so the shop can send two paragraphs or five
  // without anyone touching this file.
  const intro = t("intro")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        {t("title")}
      </h1>

      {intro.length > 0 && (
        <div className="mt-4 space-y-3 text-base leading-relaxed text-muted-foreground">
          {intro.map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </div>
      )}

      {/*
        minHeight 1450 is the height the shop's own embed snippet uses, so it is the right
        floor: the form fits without a scrollbar even if the height message never arrives.
        MachForm posts its real height after render and the component grows from there, but
        that message fires once on the iframe's DOM ready and can land before this page has
        hydrated, so it cannot be the only mechanism.
      */}
      <div className="mt-8">
        {FORM_URL ? (
          <EmbeddedForm
            src={FORM_URL}
            title={t("formTitle")}
            minHeight={1450}
          />
        ) : (
          // Say what is wrong rather than render an empty box. A blank area on a
          // contact page reads as a broken shop, and the fix is one env var.
          <p className="rounded-md border border-border bg-muted p-4 text-sm">
            {t("notConfigured")}
          </p>
        )}
      </div>
    </main>
  );
}
