import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useReachedPaymentStep } from "@/hooks/useReachedPaymentStep";

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

function installObserver() {
  FakeIntersectionObserver.instances = [];
  globalThis.IntersectionObserver =
    FakeIntersectionObserver as unknown as typeof IntersectionObserver;
}

function setup(enabled = true) {
  const node = document.createElement("div");
  document.body.appendChild(node);
  const ref = { current: node };

  const view = renderHook(
    ({ on }: { on: boolean }) => useReachedPaymentStep(ref, on),
    { initialProps: { on: enabled } },
  );

  return { node, view, observer: () => FakeIntersectionObserver.instances[0] };
}

beforeEach(installObserver);
afterEach(() => {
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

  it("reports arrival when the box scrolls into view", () => {
    const { view, observer } = setup();
    observer().emit(true);
    expect(view.result.current).toBe(true);
  });

  it("starts watching 200px early, so the card field is no slower than before", () => {
    // The customer must not be able to tell this changed. If the margin were
    // dropped the session would begin only once the box was already on screen
    // and the spinner would become visible where it never used to be.
    const { observer } = setup();
    expect(observer().options?.rootMargin).toBe("200px");
  });

  it("reports arrival on a click even if the observer never fires", () => {
    // The observer covers scrolling, which is how nearly everyone arrives.
    // This is the safety net: a click means they are here regardless.
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
    expect(view.result.current).toBe(true);
  });

  it("stays arrived once arrived, even if the box scrolls back out of view", () => {
    // Scrolling up to correct an address must not tear down a session the
    // customer has already been given a card field for.
    const { view, observer } = setup();
    observer().emit(true);
    expect(view.result.current).toBe(true);

    observer().emit(false);
    expect(view.result.current).toBe(true);
  });

  it("disconnects the observer once it has served its purpose", () => {
    // It answers one question, once. Leaving it attached would keep firing on
    // every scroll for the rest of the checkout.
    const { observer } = setup();
    observer().emit(true);
    expect(observer().disconnected).toBe(true);
  });
});
