"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A form hosted on another host of ours, embedded rather than linked.
 *
 * Iframe and not a script embed: this is React, and a third-party script embed injects
 * DOM that React does not own, which fights hydration and puts someone else's JavaScript
 * on our origin. An iframe does neither. Checked the headers on the form host first: no
 * X-Frame-Options and no frame-ancestors, so it frames without a fight.
 *
 * ── the height ───────────────────────────────────────────────────────────────
 *
 * A fixed-height iframe gives a scrollbar inside a scrollbar, which is miserable on a
 * phone and worse on a form with a captcha. MachForm already solves this: after render
 * it calls jQuery's $.postMessage({mf_iframe_height: …}, '*', parent).
 *
 * That plugin serialises an object with $.param before sending, so what actually arrives
 * is the STRING "mf_iframe_height=1234", not an object. Both shapes are handled, because
 * relying on the plugin's serialisation staying the same is not worth the outage.
 *
 * The origin is checked before the number is trusted. Without that check any page that
 * can reach this one could resize the frame, and '*' as the target means the message is
 * broadcast, so the guard has to be on our side.
 */
interface EmbeddedFormProps {
  src: string;
  title: string;
  /** Fallback height before the form reports its own, and the floor afterwards. */
  minHeight?: number;
}

const MAX_HEIGHT = 20000;

function parseHeight(data: unknown): number | null {
  if (typeof data === "number") return data;

  if (typeof data === "string") {
    const match = /mf_iframe_height=(\d+)/.exec(data);
    if (match) return Number(match[1]);
    return null;
  }

  if (data && typeof data === "object" && "mf_iframe_height" in data) {
    const raw = (data as Record<string, unknown>).mf_iframe_height;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  return null;
}

export default function EmbeddedForm({
  src,
  title,
  minHeight = 900,
}: EmbeddedFormProps) {
  const [height, setHeight] = useState(minHeight);
  const originRef = useRef<string | null>(null);

  // new URL can throw on a malformed env value, and a bad env var should not take the
  // whole contact page down with it.
  if (originRef.current === null) {
    try {
      originRef.current = new URL(src).origin;
    } catch {
      originRef.current = "";
    }
  }

  useEffect(() => {
    const expected = originRef.current;
    if (!expected) return;

    function onMessage(event: MessageEvent) {
      if (event.origin !== expected) return;
      const reported = parseHeight(event.data);
      if (reported === null) return;
      setHeight(Math.min(Math.max(reported, minHeight), MAX_HEIGHT));
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [minHeight]);

  return (
    <iframe
      src={src}
      title={title}
      height={height}
      className="w-full border-0"
      // The form collects contact details and runs a captcha, so it needs forms,
      // scripts and same-origin against ITS own origin. No allow-top-navigation: a
      // framed page should not be able to move the tab it sits in.
      sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
      referrerPolicy="strict-origin-when-cross-origin"
      loading="lazy"
    />
  );
}
