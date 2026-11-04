import type { Market } from "@spree/sdk";
import { describe, expect, it, vi } from "vitest";
import { createMarketsSnapshot } from "@/lib/spree/markets-snapshot";

const canada = [{ id: "mkt_ca" }] as unknown as Market[];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the Markets the middleware reads", () => {
  it("answers null until the first list arrives, without waiting for it", async () => {
    const load = vi.fn(async () => canada);
    const markets = createMarketsSnapshot(load);

    expect(markets()).toBeNull();
    await settle();
    expect(markets()).toBe(canada);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("asks once while a request is in flight, not once per page", async () => {
    let finish: (data: Market[]) => void = () => {};
    const load = vi.fn(
      () =>
        new Promise<Market[]>((resolve) => {
          finish = resolve;
        }),
    );
    const markets = createMarketsSnapshot(load);

    markets();
    markets();
    markets();
    await settle();
    markets();
    expect(load).toHaveBeenCalledTimes(1);

    finish(canada);
    await settle();
    expect(markets()).toBe(canada);
  });

  it("keeps the last good list when a refresh fails", async () => {
    let clock = 0;
    const load = vi
      .fn<() => Promise<Market[]>>()
      .mockResolvedValueOnce(canada)
      .mockRejectedValueOnce(new Error("api down"));
    const markets = createMarketsSnapshot(load, () => clock);

    markets();
    await settle();
    clock += 11 * 60 * 1000;
    expect(markets()).toBe(canada);
    await settle();
    expect(markets()).toBe(canada);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("refreshes a list older than ten minutes and not before", async () => {
    let clock = 0;
    const load = vi.fn(async () => canada);
    const markets = createMarketsSnapshot(load, () => clock);

    markets();
    await settle();
    clock += 9 * 60 * 1000;
    markets();
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    clock += 2 * 60 * 1000;
    markets();
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("treats a loader that throws outright like one that fails", async () => {
    const markets = createMarketsSnapshot(() => {
      throw new Error("Spree client is not configured");
    });

    expect(markets()).toBeNull();
    await settle();
    expect(markets()).toBeNull();
  });
});
