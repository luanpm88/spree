import {
  Children,
  Fragment,
  type ReactElement,
  type ReactNode,
  Suspense,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/lib/data/categories", () => ({ getCategories: vi.fn() }));
vi.mock("@/components/layout/Header", () => ({
  Header: () => null,
  HeaderMobileMenu: () => null,
}));
vi.mock("@/components/layout/Footer", () => ({
  Footer: () => null,
  FooterCategoryLinks: () => null,
}));
vi.mock("@/components/layout/AnnouncementBar", () => ({
  AnnouncementBar: () => null,
}));
vi.mock("@/components/layout/UtilityBar", () => ({
  UtilityBar: () => null,
}));

// The gate is the one thing that decides which of the two trees below renders,
// so the tests drive it directly rather than standing up a store config.
let gateState = { gated: false, signedIn: true };
vi.mock("@/lib/spree/shop-gate", () => ({
  enforceShopGate: async () => gateState,
}));

import { AnnouncementBar } from "@/components/layout/AnnouncementBar";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { UtilityBar } from "@/components/layout/UtilityBar";
import StorefrontLayout from "./layout";

interface LayoutElementProps {
  children?: ReactNode;
  mobileNavigation?: ReactElement<{ fallback: ReactNode }>;
  categoryLinks?: ReactElement<{ fallback: ReactNode }>;
  fallback?: ReactNode;
}

describe("StorefrontLayout", () => {
  beforeEach(() => {
    gateState = { gated: false, signedIn: true };
  });

  it("keeps page chrome outside the category navigation Suspense boundaries", async () => {
    const content = <section>Storefront content</section>;
    const layout = (await StorefrontLayout({
      children: content,
      params: Promise.resolve({ country: "us", locale: "en" }),
    })) as ReactElement<LayoutElementProps>;

    expect(layout.type).toBe(Fragment);

    // Both bars sit above the header, which is where his current shop puts
    // them, and they are first in this list for that reason rather than by
    // accident. The utility strip leads because the business design draws it
    // as the topmost thing on the page; it renders null on every other shop.
    const [utility, announcement, header, hiddenNavigation, main, footer] =
      Children.toArray(
        layout.props.children,
      ) as ReactElement<LayoutElementProps>[];

    expect(utility.type).toBe(UtilityBar);
    expect(announcement.type).toBe(AnnouncementBar);
    expect(header.type).toBe(Header);
    expect(hiddenNavigation.type).toBe(Suspense);
    expect(main.type).toBe("main");
    expect(main.props.children).toBe(content);
    expect(footer.type).toBe(Footer);

    const mobileNavigation = header.props.mobileNavigation;
    const categoryLinks = footer.props.categoryLinks;

    expect(mobileNavigation?.type).toBe(Suspense);
    expect(mobileNavigation?.props.fallback).not.toBeNull();
    expect(hiddenNavigation.props.fallback).toBeNull();
    expect(categoryLinks?.type).toBe(Suspense);
    expect(categoryLinks?.props.fallback).not.toBeNull();
  });

  // On a closed shop a stranger reaches the sign-in page and the four policies.
  // Both the header nav and the footer repeat the category tree, so either one
  // left in place hands over the catalogue the gate exists to withhold. He asked
  // for the footer to go on 20 Aug; this pins that it stays gone.
  it("gives a signed-out visitor on a closed shop no footer and no navigation", async () => {
    gateState = { gated: true, signedIn: false };

    const content = <section>Sign in</section>;
    const layout = (await StorefrontLayout({
      children: content,
      params: Promise.resolve({ country: "nz", locale: "en" }),
    })) as ReactElement<LayoutElementProps>;

    const parts = Children.toArray(
      layout.props.children,
    ) as ReactElement<LayoutElementProps>[];

    expect(parts.map((p) => p.type)).toEqual([Header, "main"]);
    expect(parts.some((p) => p.type === Footer)).toBe(false);
    expect(parts.some((p) => p.type === AnnouncementBar)).toBe(false);

    const [header, main] = parts;
    expect(main.props.children).toBe(content);
    // No category tree behind the burger either.
    expect(header.props.mobileNavigation).toBeUndefined();
  });

  it("gives a signed-in wholesale customer the full chrome back", async () => {
    gateState = { gated: true, signedIn: true };

    const layout = (await StorefrontLayout({
      children: <section>Shop</section>,
      params: Promise.resolve({ country: "nz", locale: "en" }),
    })) as ReactElement<LayoutElementProps>;

    const types = (
      Children.toArray(
        layout.props.children,
      ) as ReactElement<LayoutElementProps>[]
    ).map((p) => p.type);

    expect(types).toContain(Footer);
    expect(types).toContain(Header);
  });
});
