import type { Market } from "@spree/sdk";

const FRESH_MS = 10 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const TIMEOUT_MS = 5000;

/**
 * The shop's Markets, as the middleware can see them.
 *
 * The middleware has to choose a country before the page renders, and it has
 * to choose without waiting: it runs in front of every page. So it never asks
 * the API itself. It reads the last list this keeps, and a stale list starts a
 * refresh in the background for the requests after it.
 *
 * Until the first answer arrives the list is null, and the middleware does
 * exactly what it did before it had one. A failed or slow answer keeps the last
 * good list rather than dropping it: Markets change when someone edits them in
 * the admin, not between two requests.
 */
export function createMarketsSnapshot(
  load: () => Promise<Market[]>,
  now: () => number = Date.now,
): () => readonly Market[] | null {
  let markets: Market[] | null = null;
  let refreshAt = 0;
  let loading = false;

  const refresh = () => {
    loading = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("markets took too long")),
        TIMEOUT_MS,
      );
      // A pending refresh must not keep a finished process alive.
      if (typeof timer === "object" && timer && "unref" in timer) timer.unref();
    });

    Promise.race([Promise.resolve().then(load), timeout])
      .then((data) => {
        markets = data;
        refreshAt = now() + FRESH_MS;
      })
      .catch(() => {
        refreshAt = now() + RETRY_MS;
      })
      .finally(() => {
        clearTimeout(timer);
        loading = false;
      });
  };

  return () => {
    if (!loading && now() >= refreshAt) refresh();
    return markets;
  };
}
