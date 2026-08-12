import { CartDrawer } from "@/components/cart/CartDrawer";
import { CartProvider } from "@/contexts/CartContext";
import { getCustomer } from "@/lib/data/customer";
import { getWholesaleChannel } from "@/lib/data/wholesale";
import { isWholesaleApproved } from "@/lib/wholesale";
import { WholesaleApplicationPending } from "./WholesaleApplicationPending";
import { WholesaleGuestBrowse } from "./WholesaleGuestBrowse";
import { WholesaleHeader } from "./WholesaleHeader";
import { WholesalePendingBrowse } from "./WholesalePendingBrowse";
import { WholesaleSignInWall } from "./WholesaleSignInWall";

interface WholesaleGateProps {
  basePath: string;
  /**
   * Portal content, as a function so it is invoked only in branches that should
   * render it — never for the sign-in wall or the pending state. A plain
   * `children` node would be constructed regardless of the gate's decision; the
   * thunk guarantees the catalog fetch runs only when the posture allows it (an
   * approved buyer, or a guest on a `prices_hidden` channel — never a guest on a
   * `login_required` channel, where the fetch would 401).
   */
  children: () => React.ReactNode;
  /**
   * Whether a guest may see this page on a `prices_hidden` channel. Only the
   * browse surfaces (catalog, PDP) set this — they render read-only with
   * sign-in-for-pricing prompts. Ordering surfaces (cart, quick order) leave it
   * false so a guest hits the sign-in wall instead of a page whose `useCart()`
   * would bind to the DTC provider (guests have no wholesale cart).
   */
  allowGuestBrowse?: boolean;
}

/**
 * Server-side gate for the portal (catalog, PDP, cart, quick order). Branches on
 * the channel's `storefront_access` posture, the session, and Wholesale-group
 * membership:
 *
 * - guest, `login_required` → inline sign-in / apply wall (the channel 401s the
 *   catalog fetch anyway, so nothing behind the wall would render)
 * - guest, `prices_hidden` → the catalog renders with prices replaced by a
 *   "sign in for pricing" prompt; ordering is gated behind sign-in
 * - authenticated, not approved, browse surface on `prices_hidden` → the catalog
 *   renders with "Awaiting Approval" where each price goes. Signing in is not
 *   approval, and the server agrees: it returns null money fields for a
 *   signed-in customer who belongs to no customer group
 * - authenticated, not approved, ordering surface → application-pending state
 * - approved member → the portal chrome + `children`, with the wholesale cart
 *   bound via <CartProvider surface="wholesale">
 *
 * Runs per navigation, so a login (which triggers a server re-render)
 * re-evaluates it. The apply page renders outside this gate so guests can
 * reach it.
 */
export async function WholesaleGate({
  basePath,
  children,
  allowGuestBrowse = false,
}: WholesaleGateProps) {
  const [customer, channel] = await Promise.all([
    getCustomer(),
    getWholesaleChannel(),
  ]);

  if (!customer) {
    // On a prices-hidden channel the catalog is browsable by guests (the API
    // just nulls the money fields), so render browse surfaces with
    // sign-in-for-pricing prompts instead of the hard wall. Ordering surfaces
    // (allowGuestBrowse=false) still wall guests off, and any other posture
    // (login_required, or an unknown/unreachable channel) always walls.
    if (allowGuestBrowse && channel?.storefront_access === "prices_hidden") {
      return (
        <WholesaleGuestBrowse basePath={basePath}>
          {children()}
        </WholesaleGuestBrowse>
      );
    }

    return (
      <WholesaleSignInWall
        basePath={basePath}
        storefrontAccess={channel?.storefront_access}
      />
    );
  }

  const displayName =
    [customer.first_name, customer.last_name].filter(Boolean).join(" ") ||
    customer.email;

  if (!isWholesaleApproved(customer)) {
    // Browsing is allowed while they wait, on the same surfaces a guest may
    // browse, because that is what the client asked for: an applicant sees the
    // range with "Awaiting Approval" where each price goes, and the prices
    // appear the moment he moves them into a customer group.
    //
    // The server has already decided this independently: it returns null money
    // fields for a signed-in customer with no group. So this branch does not
    // hide anything, it explains an absence that has already happened. If the
    // two ever disagree, the page renders a price it was given, which is why
    // isWholesaleApproved and the server's approved_for_pricing? are written to
    // ask the same question.
    // Any gated posture, not `prices_hidden` alone. `login_required` gates
    // GUESTS, and this customer is signed in, so the channel's condition is
    // already met: what is left to decide is approval, which is this branch.
    //
    // Testing for `prices_hidden` here was a real hole, found by auditing the
    // live shop. Its wholesale channel is `login_required`, so a signed-in
    // applicant was walled instead of browsing, which is the opposite of what
    // the client chose. The guest branch above is narrow on purpose: a guest on
    // `login_required` really is 401'd, so there is nothing to render.
    //
    // `public` stays out. There the server returns real prices, so a page
    // captioned "Awaiting Approval" beside a live price would contradict itself.
    if (allowGuestBrowse && channel && channel.storefront_access !== "public") {
      return (
        <WholesalePendingBrowse basePath={basePath} customerName={displayName}>
          {children()}
        </WholesalePendingBrowse>
      );
    }

    // Ordering surfaces still wall. A cart that cannot price anything is not
    // useful to anybody.
    return (
      <WholesaleApplicationPending
        basePath={basePath}
        customerName={displayName}
        email={customer.email}
      />
    );
  }

  return (
    <CartProvider surface="wholesale">
      <WholesaleHeader basePath={basePath} customerName={displayName} />
      <main>{children()}</main>
      {/* The wholesale portal needs its own drawer bound to THIS provider —
          the root layout's <CartDrawer /> reads the outer DTC context, so
          wholesale add-to-cart / quick-order opens would never reach it. */}
      <CartDrawer />
    </CartProvider>
  );
}
