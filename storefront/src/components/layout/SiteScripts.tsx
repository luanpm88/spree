import { SCRIPTS_BY_SHOP } from "@/lib/blocks/content";

/**
 * The client's own third-party scripts.
 *
 * An analytics collector, a social proof pixel, a live chat widget and an email
 * tool, and on one shop a cookie consent banner. He asked whether they were
 * needed; they are, so they are carried across with the placement his current
 * shop uses.
 *
 * Three slots, because his tracker tasks specify three: in the head, straight
 * after the opening body tag, and before the closing one. The middle slot is not
 * decoration — it is where his cookie banner goes, and a consent banner that
 * loads after everything else has already run is a banner that consented to
 * nothing. Only one shop uses it today, which is exactly why it was missed on
 * the first pass: five tasks had two slots and the sixth had three.
 *
 * ── why dangerouslySetInnerHTML and not next/script ──────────────────────────
 *
 * One of them is an inline function that builds a tag and calls back into an SDK
 * once it loads. next/script wants a src or a plain body string and would either
 * reorder it or run it twice under React strict mode. These are pasted exactly as
 * he supplied them, which is also what makes them replaceable by him later
 * without a developer.
 *
 * ── per shop, not one set for all ────────────────────────────────────────────
 *
 * Each shop has its OWN chatwoot inbox, socialproof pixel and slingshot site.
 * The first version used one set everywhere, which put New Zealand's chat widget
 * and analytics on the Canada shop. The tokens come from each shop's own tracker
 * task now.
 *
 * The snippets live in the gitignored content module: they carry his site tokens,
 * and this repository is public.
 */

function scripts() {
  const shop = (process.env.NEXT_PUBLIC_DEFAULT_COUNTRY || "").toLowerCase();
  return SCRIPTS_BY_SHOP[shop];
}

export function HeadScripts() {
  const HEAD_SCRIPTS = scripts()?.head;
  if (!HEAD_SCRIPTS) return null;
  // biome-ignore lint/security/noDangerouslySetInnerHtml: the client's own snippets, not user input
  return (
    <div
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: HEAD_SCRIPTS }}
    />
  );
}

export function BodyStartScripts() {
  const BODY_START_SCRIPTS = scripts()?.bodyStart;
  if (!BODY_START_SCRIPTS) return null;
  // biome-ignore lint/security/noDangerouslySetInnerHtml: the client's own snippets, not user input
  return (
    <div
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: BODY_START_SCRIPTS }}
    />
  );
}

export function BodyEndScripts() {
  const BODY_END_SCRIPTS = scripts()?.bodyEnd;
  if (!BODY_END_SCRIPTS) return null;
  // biome-ignore lint/security/noDangerouslySetInnerHtml: the client's own snippets, not user input
  return (
    <div
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: BODY_END_SCRIPTS }}
    />
  );
}
