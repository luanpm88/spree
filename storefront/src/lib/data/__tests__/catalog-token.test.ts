import { SpreeError } from "@spree/sdk";
import { describe, expect, it, vi } from "vitest";
import { asCustomerOrGuest, catalogToken } from "@/lib/data/catalog-token";

// A JWT whose payload carries only `exp`, enough for the expiry check.
const jwt = (exp: number) =>
  `h.${btoa(JSON.stringify({ exp })).replace(/=+$/, "")}.s`;
const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;
const anHourAgo = () => Math.floor(Date.now() / 1000) - 3600;

describe("catalogToken", () => {
  it("passes a live customer token through", () => {
    const token = jwt(inAnHour());
    expect(catalogToken(token)).toBe(token);
  });

  it("reads as a guest with no token or an expired one", () => {
    expect(catalogToken(undefined)).toBeUndefined();
    expect(catalogToken(jwt(anHourAgo()))).toBeUndefined();
  });
});

describe("asCustomerOrGuest", () => {
  // The fault: an approved, signed-in customer on a prices-hidden shop was
  // read as a guest, so the API answered every product with no price.
  it("reads as the customer when signed in", async () => {
    const token = jwt(inAnHour());
    const read = vi.fn().mockResolvedValue("priced");
    await expect(asCustomerOrGuest(token, read)).resolves.toBe("priced");
    expect(read).toHaveBeenCalledWith(token);
  });

  it("reads as a guest when the API refuses the token", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(
        new SpreeError(
          { error: { code: "unauthorized", message: "Invalid token" } },
          401,
        ),
      )
      .mockResolvedValueOnce("unpriced");
    await expect(asCustomerOrGuest(jwt(inAnHour()), read)).resolves.toBe(
      "unpriced",
    );
    expect(read).toHaveBeenLastCalledWith(undefined);
  });

  it("does not hide other failures behind a guest read", async () => {
    const boom = new SpreeError(
      { error: { code: "internal_error", message: "down" } },
      500,
    );
    const read = vi.fn().mockRejectedValue(boom);
    await expect(asCustomerOrGuest(jwt(inAnHour()), read)).rejects.toBe(boom);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
