import { SpreeError } from "@spree/sdk";
import { isJwtExpired } from "@/lib/spree/jwt";

// Catalogue reads (products, product lists, filters, a category's products)
// carry the signed-in customer's token on every surface, not only wholesale.
//
// A shop whose channel hides prices from guests (the business shop) answers a
// product with no price unless the request says who is asking. These reads used
// to send the customer's token only on the wholesale surface, so an approved,
// signed-in customer on the business shop saw no price on any product or
// category page, while the cart, which does send it, priced the same item.
// Found walking the 6.0 copy as an approved customer, 29 Oct.
//
// The token is also what a customer-group price list keys on, so the open shops
// get the right price for a signed-in customer the same way.

/** The customer's token for a catalogue read, or undefined to read as a guest. */
export function catalogToken(
  userToken: string | undefined,
): string | undefined {
  if (!userToken) return undefined;
  return isJwtExpired(userToken) ? undefined : userToken;
}

/**
 * Reads as the customer when there is a live token, and as a guest otherwise.
 * A token the API refuses (revoked, or a cookie someone typed) reads as a guest
 * rather than failing the page: the API is the judge of who is signed in.
 */
export async function asCustomerOrGuest<T>(
  userToken: string | undefined,
  read: (token: string | undefined) => Promise<T>,
): Promise<T> {
  const token = catalogToken(userToken);
  if (!token) return read(undefined);
  try {
    return await read(token);
  } catch (error) {
    if (
      error instanceof SpreeError &&
      (error.status === 401 || error.status === 403)
    ) {
      return read(undefined);
    }
    throw error;
  }
}
