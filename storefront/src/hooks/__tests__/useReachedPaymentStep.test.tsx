import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useReachedPaymentStep } from "@/hooks/useReachedPaymentStep";

/** Must stay ahead of SETTLE_MS in the hook. */
const PAST_SETTLE = 1000;

/**
 * jsdom ships no IntersectionObserver, so the real one is stood in for here.
 * Keeping the instances lets a test assert what was observed and with which
 * margin, which is the part that decides whether the card field still appears
 * as promptly as it used to.
 */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];

  observed: Element[] = [];
  disconnected = false;

  constructor(
    private callback: IntersectionObserverCallback,
    public options?: IntersectionObserverInit,
  ) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  emit(isIntersecting: boolean) {
    act(() => {
      this.callback(
        [{ isIntersecting } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    });
  }
}

/** Let the hook's settle timer run out. */
function settle() {
  act(() => {
    vi.advanceTimersByTime(PAST_SETTLE);
  });
}

function setup(enabled = true) {
  const node = document.createElement("div");
  document.body.appendChild(node);
  const ref = { current: node };

  // jsdom lays nothing out, so every rect is zero and every box would look
  // on screen. Positioning it explicitly is what makes the streaming test
  // below mean anything.
  let rect = { top: 100, bottom: 900 };
  node.getBoundingClientRect = () =>
    ({ ...rect, left: 0, right: 0, height: 0, width: 0 }) as DOMRect;
  const moveTo = (top: number, bottom: number) => {
    rect = { top, bottom };
  };

  const view = renderHook(
    ({ on }: { on: boolean }) => useReachedPaymentStep(ref, on),
    { initialProps: { on: enabled } },
  );

  return {
    node,
    view,
    moveTo,
    observer: () => FakeIntersectionObserver.instances[0],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeIntersectionObserver.instances = [];
  globalThis.IntersectionObserver =
    FakeIntersectionObserver as unknown as typeof IntersectionObserver;
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

/**
 * The shop owner reported this as "every cart is making a connection with
 * Stripe". These tests pin both halves of the fix: that nothing is asked of the
 * provider before the customer arrives, and — the half that would cost a sale
 * rather than a dashboard row — that arriving is detected on every route into
 * the payment box.
 */
describe("useReachedPaymentStep", () => {
  it("reports nothing while the box is neither seen nor touched", () => {
    const { view } = setup();
    expect(view.result.current).toBe(false);
  });

  it("reports arrival when the box scrolls into view and stays there", () => {
    const { view, observer } = setup();
    observer().emit(true);
    settle();
    expect(view.result.current).toBe(true);
  });

  it("ignores an intersection on a page that is still streaming", () => {
    // THE BUG THIS FILE EXISTS FOR, and it shipped once before being caught by
    // counting rows on the live shop: 31 payment sessions before opening the
    // checkout, 32 after, with the payment box measured at 1133px down a 900px
    // window. Well outside the margin, and a session was created anyway.
    //
    // The checkout streams. When this section mounts the contact and delivery
    // forms above it do not exist yet, so the payment box is briefly near the
    // top of a nearly empty page and really is on screen. The observer fires,
    // correctly, about a layout that lasts a moment.
    const { view, observer, moveTo } = setup();

    observer().emit(true);
    // The rest of the checkout arrives and pushes payment down where it lives.
    moveTo(1133, 3000);
    settle();

    expect(view.result.current).toBe(false);
  });

  it("still arrives if the box is genuinely on screen once things settle", () => {
    // The other side of the same coin: a tall window or a short cart, where the
    // box is on screen at load and the customer never scrolls. They must still
    // get a card field, so a confirmed intersection has to be believed.
    const { view, observer, moveTo } = setup();

    observer().emit(true);
    moveTo(300, 1100);
    settle();

    expect(view.result.current).toBe(true);
  });

  it("starts watching 200px early, so the card field is no slower than before", () => {
    // The customer must not be able to tell this changed. If the margin were
    // dropped the session would begin only once the box was already on screen
    // and the spinner would become visible where it never used to be.
    const { observer } = setup();
    expect(observer().options?.rootMargin).toBe("200px");
  });

  it("reports arrival on a click at once, with no settling delay", () => {
    // Touching the box is not in doubt, so it is never deferred. Only what the
    // observer reports can describe a layout that has already gone.
    const { node, view } = setup();
    expect(view.result.current).toBe(false);

    act(() => {
      node.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

    expect(view.result.current).toBe(true);
  });

  it("reports arrival on keyboard focus, which scrolls nothing", () => {
    // Tabbing into the card field, or a screen reader moving focus there, can
    // reach the payment step without a scroll the observer would see.
    const { node, view } = setup();

    act(() => {
      node.dispatchEvent(new Event("focusin", { bubbles: true }));
    });

    expect(view.result.current).toBe(true);
  });

  it("reports arrival immediately when the browser has no IntersectionObserver", () => {
    // Fails towards selling, deliberately. A stale row in a dashboard is a
    // nuisance; a checkout that never draws a card field is a lost order. This
    // is the opposite failure direction from the cache purge, and on purpose.
    // @ts-expect-error removing the global is the condition under test
    delete globalThis.IntersectionObserver;

    const { view } = setup();
    expect(view.result.current).toBe(true);
  });

  it("does not watch at all for a method that needs no session", () => {
    // Bank transfer and cash on delivery never touch a provider, so there is
    // nothing to defer and nothing to observe.
    const { view, observer } = setup(false);
    expect(view.result.current).toBe(false);
    expect(observer()).toBeUndefined();
  });

  it("begins watching when the customer switches to a card method", () => {
    // The section can mount with a non-session method selected. Switching to
    // Stripe has to start the watch, or the card field would never load.
    const { view, observer } = setup(false);

    act(() => {
      view.rerender({ on: true });
    });

    expect(observer()).toBeDefined();
    observer().emit(true);
    settle();
    expect(view.result.current).toBe(true);
  });

  it("stays arrived once arrived, even if the box scrolls back out of view", () => {
    // Scrolling up to correct an address must not tear down a session the
    // customer has already been given a card field for.
    const { view, observer } = setup();
    observer().emit(true);
    settle();
    expect(view.result.current).toBe(true);

    observer().emit(false);
    settle();
    expect(view.result.current).toBe(true);
  });

  it("disconnects the observer once it has served its purpose", () => {
    // It answers one question, once. Leaving it attached would keep firing on
    // every scroll for the rest of the checkout.
    const { observer } = setup();
    observer().emit(true);
    settle();
    expect(observer().disconnected).toBe(true);
  });

  it("does not leave a pending timer behind when it unmounts", () => {
    // A page left mid-stream must not set state on a gone component. The timer
    // is cleared in the effect teardown; this is what proves the teardown runs.
    const { view, observer } = setup();
    observer().emit(true);
    act(() => {
      view.unmount();
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
