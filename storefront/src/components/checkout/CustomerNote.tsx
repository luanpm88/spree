"use client";

import type { Cart } from "@spree/sdk";
import { useTranslations } from "next-intl";
import { useState } from "react";

interface CustomerNoteProps {
  cart: Cart;
  onSave: (note: string) => Promise<{ success: boolean; error?: string }>;
  processing?: boolean;
}

/**
 * A place for the customer to say something about their order.
 *
 * The old shop had one and the new checkout did not. A real customer used it on
 * 12 Aug: "Call before arriving. Courier must use the Waze app to find the
 * address". That is an instruction for whoever packs and delivers the box, and
 * with no field it had nowhere to go.
 *
 * ── saved on blur, not on every keystroke ───────────────────────────────────
 *
 * One request when they click away, and none while they type. A note is a
 * paragraph, so per-keystroke saving would be dozens of writes to the order for
 * one message, on the screen where the shop can least afford to be slow.
 *
 * ── a failure here must never block the order ───────────────────────────────
 *
 * If the save fails the customer is told, in place, and the checkout carries on
 * regardless. Nobody should lose a sale because a delivery note would not
 * attach. The text stays in the box so they can try again or simply proceed.
 */
export function CustomerNote({ cart, onSave, processing }: CustomerNoteProps) {
  const t = useTranslations("checkout");
  const [note, setNote] = useState(cart.customer_note ?? "");
  const [saved, setSaved] = useState<string>(cart.customer_note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleBlur = async () => {
    const value = note.trim();
    if (value === saved.trim()) return;

    setSaving(true);
    setError(null);
    try {
      const result = await onSave(value);
      if (result.success) {
        setSaved(value);
      } else {
        setError(result.error ?? t("noteNotSaved"));
      }
    } catch {
      setError(t("noteNotSaved"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2 className="text-lg font-medium text-gray-900 mb-1">
        {t("noteTitle")}
      </h2>
      <p className="text-sm text-gray-500 mb-3">{t("noteHint")}</p>
      <textarea
        id="checkout-customer-note"
        name="customer_note"
        rows={3}
        value={note}
        disabled={processing}
        onChange={(e) => setNote(e.target.value)}
        onBlur={handleBlur}
        placeholder={t("notePlaceholder")}
        maxLength={1000}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-0 disabled:bg-gray-50"
      />
      <div className="mt-1 min-h-5 text-xs">
        {saving && <span className="text-gray-500">{t("noteSaving")}</span>}
        {!saving && error && <span className="text-red-600">{error}</span>}
        {!saving && !error && saved.length > 0 && (
          <span className="text-gray-500">{t("noteSaved")}</span>
        )}
      </div>
    </div>
  );
}
