/**
 * Wraps a server action in a try/catch that returns a standardized
 * { success: true, ...data } | { success: false, error: string } result.
 */
export async function actionResult<T extends Record<string, unknown>>(
  fn: () => Promise<T>,
  fallbackMessage: string,
): Promise<({ success: true } & T) | { success: false; error: string }> {
  try {
    const result = await fn();
    return { success: true, ...result };
  } catch (error) {
    // The fallback also covers an Error with a blank message, not only a thrown
    // non-Error. That case is real and it is the worst one: the add to cart
    // failure that hid all afternoon threw an Error whose message was empty, so
    // the toast rendered as an empty box and the shopper was told nothing at all.
    const message = error instanceof Error ? error.message.trim() : "";
    // Logged as well as returned. A server action that fails silently on the
    // client should still be findable in the container's logs.
    console.error("action failed:", fallbackMessage, error);
    return { success: false, error: message || fallbackMessage };
  }
}

/**
 * Wraps a server action in a try/catch that returns a fallback value on error.
 */
export async function withFallback<T>(
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    console.error(error);
    return fallback;
  }
}
