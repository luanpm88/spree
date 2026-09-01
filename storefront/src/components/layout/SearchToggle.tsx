"use client";

import { Search, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const SearchBar = dynamic(
  () =>
    import("@/components/search/SearchBar").then((mod) => ({
      default: mod.SearchBar,
    })),
  {
    loading: () => (
      <div className="h-10 w-full bg-gray-100 rounded-md animate-pulse" />
    ),
  },
);

interface SearchToggleProps {
  basePath: string;
  /** Left slot (e.g. mobile menu) */
  left: ReactNode;
  /** Center slot (e.g. logo) */
  center: ReactNode;
  /** Rendered before the search button in the right section */
  rightStart: ReactNode;
  /** Rendered after the search button in the right section */
  rightEnd: ReactNode;
  /**
   * Whether this header offers search at all.
   *
   * Off for the sign-in and policy pages of a shop that is closed to visitors
   * without an account. The search box asks the catalogue directly through a
   * server action that authenticates with the shop's own publishable key, not
   * with the caller's, so it answers a stranger with product names, slugs,
   * prices and image URLs. Hiding the category navigation and leaving this was
   * a gate with a window in it.
   */
  searchable?: boolean;
}

export function SearchToggle({
  basePath,
  searchable = true,
  left,
  center,
  rightStart,
  rightEnd,
}: SearchToggleProps) {
  const t = useTranslations("header");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    searchTriggerRef.current?.focus();
  }, []);

  return (
    // The hairline is back on all 7 shops.
    //
    // It had been switched off for the closed shop, on the evidence that his own
    // nav declares border-bottom-width: 0px twice. That evidence came from the
    // same photograph of his CURRENT shop as the horizontal menu did, and he has
    // now said that shot is the old design and the header should look "like all
    // the others". A conclusion is only as good as its source, so everything
    // drawn from that source goes back with it, not only the part he named.
    <header className="sticky top-0 z-50 bg-[var(--header)] h-16 relative border-b border-gray-200">
      {/* Normal header content */}
      <div
        className={`absolute inset-0 transition-all duration-300 ease-in-out ${
          searchOpen
            ? "translate-y-4 opacity-0 pointer-events-none"
            : "translate-y-0 opacity-100"
        }`}
      >
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 h-full">
          <div className="flex items-center h-full w-full">
            {/* Left section */}
            <div className="flex items-center flex-1">{left}</div>

            {/* Center section */}
            <div className="flex justify-center min-w-0">{center}</div>

            {/* Right section */}
            <div className="flex items-center flex-1 justify-end space-x-2">
              {rightStart}

              {/* Search toggle */}
              {searchable && (
                <Button
                  ref={searchTriggerRef}
                  variant="ghost"
                  size="icon-lg"
                  onClick={() => setSearchOpen(true)}
                  aria-label={t("openSearch")}
                  aria-expanded={searchOpen}
                  aria-controls="search-overlay"
                >
                  <Search className="size-5" />
                </Button>
              )}

              {rightEnd}
            </div>
          </div>
        </div>
      </div>

      {/* Click-outside overlay */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={closeSearch}
          role="presentation"
        />
      )}

      {/* Search bar overlay. Not rendered at all when the header is not
          searchable: hiding the button alone would leave the overlay and the
          server action it calls in the page, one keystroke away. */}
      {searchable && (
        <div
          id="search-overlay"
          inert={!searchOpen}
          onKeyDown={(e) => {
            if (e.key === "Escape") closeSearch();
          }}
          className={`absolute inset-0 z-50 transition-all duration-300 ease-in-out ${
            searchOpen
              ? "translate-y-0 opacity-100"
              : "-translate-y-4 opacity-0 pointer-events-none"
          }`}
        >
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 h-full flex items-center gap-3">
            <div className="flex-1">
              <SearchBar
                key={String(searchOpen)}
                basePath={basePath}
                autoFocus={searchOpen}
                onNavigate={closeSearch}
              />
            </div>
            <Button
              variant="ghost"
              size="icon-lg"
              onClick={closeSearch}
              aria-label={t("closeSearch")}
            >
              <X className="size-5" />
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}
