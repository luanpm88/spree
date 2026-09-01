import { describe, expect, it, vi } from "vitest";

/**
 * The footer wears one of two liveries, and which one is decided by the gate.
 *
 * ── why this is worth a test ─────────────────────────────────────────────────
 *
 * The retail livery is grey with black text and every value in it was read off
 * his live shop, after he marked an earlier version wrong. The wholesale one is
 * dark, from his own render. One component serves six shops, so a livery keyed
 * slightly wrong does not fail: it quietly turns five live retail footers dark,
 * or leaves the wholesale one grey while he is looking at it.
 *
 * The contrast assertions are not decoration. The footer logo on the retail
 * shops is mid grey artwork drawn for a grey ground, and this shop's own header
 * logo is solid black: measured, 0/255 average luminance, which is 1.11:1
 * against the wholesale footer and therefore not there at all. A footer that
 * renders a logo nobody can see passes every check that asks whether the logo
 * rendered.
 */

const RETAIL_SURFACE = "#EDEDED";
// Pure black, his own. Measured off his screenshots: the announcement bar and
// the About panel both sample (0,0,0). This was #111111 while the panel above it
// was #1C1D19, so the page carried 3 near-blacks and none of them was his.
const WHOLESALE_SURFACE = "#000000";

async function liveryFor({ gated }: { gated: boolean }) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_REQUIRE_ACCOUNT", gated ? "1" : "");
  const { livery } = await import("@/components/layout/footerLivery");
  return livery();
}

/** WCAG relative luminance of an #rrggbb string. */
function relativeLuminance(hex: string) {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}

function contrast(a: string, b: string) {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe("the footer's livery", () => {
  it("keeps the grey he asked for on an open shop", async () => {
    const livery = await liveryFor({ gated: false });

    expect(livery.surface.backgroundColor).toBe(RETAIL_SURFACE);
    expect(livery.surface.color).toBe("#000000");
    // His sale collection is the first thing in the Shop column.
    expect(livery.showOnSale).toBe(true);
  });

  it("goes dark on the closed shop, matching his own", async () => {
    const livery = await liveryFor({ gated: true });

    expect(livery.surface.backgroundColor).toBe(WHOLESALE_SURFACE);
    expect(livery.surface.color).toBe("#FFFFFF");
    // The wholesale shop has no sale collection, so the link would land on an
    // empty page. The home page drops its sale row for the same reason.
    expect(livery.showOnSale).toBe(false);
  });

  it("puts the copyright bar on the same ground as the footer above it, on the closed shop only", async () => {
    const wholesale = await liveryFor({ gated: true });
    const retail = await liveryFor({ gated: false });

    // One dark panel, no seam.
    expect(wholesale.bar.backgroundColor).toBe(
      wholesale.surface.backgroundColor,
    );
    // Against grey, the darker strip is the point of it: his words were "black
    // or dark gray with white text below the line".
    expect(retail.bar.backgroundColor).not.toBe(retail.surface.backgroundColor);
  });

  it("keeps text legible against whichever ground it is on", async () => {
    for (const gated of [true, false]) {
      const { surface, bar } = await liveryFor({ gated });
      expect(contrast(surface.backgroundColor, surface.color)).toBeGreaterThan(
        4.5,
      );
      expect(contrast(bar.backgroundColor, bar.color)).toBeGreaterThan(4.5);
    }
  });
});
