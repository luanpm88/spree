import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegionPreferences } from "@/components/layout/RegionPreferences";
import type { CountryWithMarket } from "@/contexts/StoreContext";
import { useStore } from "@/contexts/StoreContext";
import { useCountrySwitch } from "@/hooks/useCountrySwitch";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    ({
      title: "Region and language",
      description:
        "Choose your region and language. Currency is set by the selected region.",
      region: "Region",
      language: "Language",
      updatePreferences: "Update preferences",
      updatingPreferences: "Updating preferences...",
      updatePreferencesFailed: "Could not update preferences.",
    })[key] ?? key,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: vi.fn(),
}));

vi.mock("@/hooks/useCountrySwitch", () => ({
  useCountrySwitch: vi.fn(),
}));

vi.mock("@/lib/blocks/content", () => ({
  MARKET_BY_SHOP: { wholesale: "nz" },
  HOME_FLAG_BY_SHOP: {
    "shop-asia": { iso: "hk", label: "HK" },
    "shop-europe": { iso: "gb", label: "UK" },
    "shop-markets": { iso: "hk", label: "HK", currency: "USD" },
  },
}));

const mockUseStore = vi.mocked(useStore);
const mockUseCountrySwitch = vi.mocked(useCountrySwitch);

const countries = [
  {
    iso: "US",
    name: "United States",
    currency: "USD",
    default_locale: "en",
    supported_locales: ["en"],
    marketId: "market-us",
  },
  {
    iso: "CA",
    name: "Canada",
    currency: "USD",
    default_locale: "en",
    supported_locales: ["en", "fr"],
    marketId: "market-ca",
  },
] as CountryWithMarket[];

describe("RegionPreferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseStore.mockReturnValue({
      countries,
      country: "us",
      currency: "USD",
      locale: "en",
      loading: false,
      storeName: "Spree Store",
    });
  });

  it("opens the dialog and submits the selected region and language", async () => {
    const user = userEvent.setup();
    const handleCountrySelect = vi.fn().mockResolvedValue(true);
    mockUseCountrySwitch.mockReturnValue({
      handleCountrySelect,
      isCartLoading: false,
      isCountryNavigating: false,
    });

    render(<RegionPreferences variant="header" />);

    const flag = document.querySelector('img[src="/flags/1x1/us.svg"]');
    expect(flag).toHaveAttribute("src", "/flags/1x1/us.svg");
    expect(flag?.parentElement).toHaveClass("inline-block");

    await user.click(
      screen.getByRole("button", { name: "Region and language" }),
    );

    expect(
      screen.getByRole("dialog", { name: "Region and language" }),
    ).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Region"), "ca");
    expect(screen.getByLabelText("Region")).toHaveValue("ca");
    expect(screen.getByLabelText("Language")).toHaveValue("en");

    await user.click(
      screen.getByRole("button", { name: "Update preferences" }),
    );

    expect(handleCountrySelect).toHaveBeenCalledWith(countries[1], "en");
  });

  it("disables submission while the cart is loading", async () => {
    const user = userEvent.setup();
    mockUseCountrySwitch.mockReturnValue({
      handleCountrySelect: vi.fn(),
      isCartLoading: true,
      isCountryNavigating: false,
    });

    render(<RegionPreferences variant="menu" />);
    await user.click(
      screen.getByRole("button", { name: "Region and language" }),
    );

    expect(
      screen.getByRole("button", { name: "Update preferences" }),
    ).toBeDisabled();
  });

  it("shows an error when the region switch fails", async () => {
    const user = userEvent.setup();
    mockUseCountrySwitch.mockReturnValue({
      handleCountrySelect: vi.fn().mockResolvedValue(false),
      isCartLoading: false,
      isCountryNavigating: false,
    });

    render(<RegionPreferences variant="header" />);
    await user.click(
      screen.getByRole("button", { name: "Region and language" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Update preferences" }),
    );

    expect(
      screen.getByText("Could not update preferences."),
    ).toBeInTheDocument();
  });
});

// One home flag per shop (client, 16 Nov 2026). The shop keys are stand-ins: the real
// table lives in the gitignored content file, because it names the shops.
describe("RegionPreferences, one home flag per shop", () => {
  const previousShopKey = process.env.NEXT_PUBLIC_SHOP_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCountrySwitch.mockReturnValue({
      handleCountrySelect: vi.fn().mockResolvedValue(true),
      isCartLoading: false,
      isCountryNavigating: false,
    });
  });

  afterEach(() => {
    if (previousShopKey === undefined) delete process.env.NEXT_PUBLIC_SHOP_KEY;
    else process.env.NEXT_PUBLIC_SHOP_KEY = previousShopKey;
  });

  function serve(country: string): void {
    mockUseStore.mockReturnValue({
      countries,
      country,
      currency: "USD",
      locale: "en",
      loading: false,
      storeName: "Spree Store",
    });
  }

  it("shows the shop's home flag whatever country the visitor was served", () => {
    process.env.NEXT_PUBLIC_SHOP_KEY = "shop-asia";
    serve("kw");

    render(<RegionPreferences variant="header" />);

    expect(
      document.querySelector('img[src="/flags/1x1/hk.svg"]'),
    ).not.toBeNull();
    expect(document.querySelector('img[src="/flags/1x1/kw.svg"]')).toBeNull();
    expect(screen.getByText("HK")).toBeInTheDocument();
  });

  it("uses the home flag's own label, and the menu shows the same flag", () => {
    process.env.NEXT_PUBLIC_SHOP_KEY = "shop-europe";
    serve("be");

    const { unmount } = render(<RegionPreferences variant="header" />);
    expect(
      document.querySelector('img[src="/flags/1x1/gb.svg"]'),
    ).not.toBeNull();
    expect(document.querySelector('img[src="/flags/1x1/be.svg"]')).toBeNull();
    expect(screen.getByText("UK")).toBeInTheDocument();
    unmount();

    render(<RegionPreferences variant="menu" />);
    expect(
      document.querySelector('img[src="/flags/1x1/gb.svg"]'),
    ).not.toBeNull();
    expect(document.querySelector('img[src="/flags/1x1/be.svg"]')).toBeNull();
  });

  it("leaves a shop without a home flag on the country it serves", () => {
    process.env.NEXT_PUBLIC_SHOP_KEY = "shop-single";
    serve("ca");

    render(<RegionPreferences variant="header" />);

    expect(
      document.querySelector('img[src="/flags/1x1/ca.svg"]'),
    ).not.toBeNull();
    expect(screen.getByText("ca")).toBeInTheDocument();
  });

  it("still resolves a shop addressed by a market name through MARKET_BY_SHOP", () => {
    process.env.NEXT_PUBLIC_SHOP_KEY = "wholesale";
    serve("wholesale");

    render(<RegionPreferences variant="header" />);

    expect(
      document.querySelector('img[src="/flags/1x1/nz.svg"]'),
    ).not.toBeNull();
  });
});

// The client, 24 Nov 2026 (tracker #7): a home flag that names a currency stands for
// that currency only; picking another market shows that market's flag.
describe("RegionPreferences, a home flag tied to its currency", () => {
  const previousShopKey = process.env.NEXT_PUBLIC_SHOP_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SHOP_KEY = "shop-markets";
    mockUseCountrySwitch.mockReturnValue({
      handleCountrySelect: vi.fn().mockResolvedValue(true),
      isCartLoading: false,
      isCountryNavigating: false,
    });
  });

  afterEach(() => {
    if (previousShopKey === undefined) delete process.env.NEXT_PUBLIC_SHOP_KEY;
    else process.env.NEXT_PUBLIC_SHOP_KEY = previousShopKey;
  });

  function serve(country: string, currency: string): void {
    mockUseStore.mockReturnValue({
      countries,
      country,
      currency,
      locale: "en",
      loading: false,
      storeName: "Spree Store",
    });
  }

  it("keeps the home flag for prices in its own currency", () => {
    serve("kw", "USD");
    render(<RegionPreferences variant="header" />);
    expect(
      document.querySelector('img[src="/flags/1x1/hk.svg"]'),
    ).not.toBeNull();
    expect(screen.getByText("HK")).toBeInTheDocument();
  });

  it("shows the NZ flag when the visitor is priced in NZ dollars", () => {
    serve("nz", "NZD");
    render(<RegionPreferences variant="header" />);
    expect(
      document.querySelector('img[src="/flags/1x1/nz.svg"]'),
    ).not.toBeNull();
    expect(document.querySelector('img[src="/flags/1x1/hk.svg"]')).toBeNull();
    expect(screen.getByText("NZ")).toBeInTheDocument();
  });

  it("labels Great Britain UK, and the menu shows the same flag", () => {
    serve("gb", "GBP");
    const { unmount } = render(<RegionPreferences variant="header" />);
    expect(screen.getByText("UK")).toBeInTheDocument();
    unmount();
    render(<RegionPreferences variant="menu" />);
    expect(
      document.querySelector('img[src="/flags/1x1/gb.svg"]'),
    ).not.toBeNull();
  });

  it("shows the EU flag for euro prices, whichever euro country was picked", () => {
    serve("fr", "EUR");
    render(<RegionPreferences variant="header" />);
    expect(
      document.querySelector('img[src="/flags/1x1/eu.svg"]'),
    ).not.toBeNull();
    expect(document.querySelector('img[src="/flags/1x1/fr.svg"]')).toBeNull();
    expect(screen.getByText("EU")).toBeInTheDocument();
  });
});
