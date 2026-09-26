/** Coalesce reads and discard responses invalidated by a write or newer refresh. */
export function createRefreshGate() {
  let current: { controller: AbortController; promise: Promise<boolean> } | null = null;
  return {
    invalidate() {
      current?.controller.abort();
      current = null;
    },
    run<T>(
      read: (signal: AbortSignal) => Promise<T>,
      apply: (value: T) => void,
      failed: (error: unknown) => void,
    ): Promise<boolean> {
      if (current) return current.promise;
      const controller = new AbortController();
      const request = { controller, promise: Promise.resolve(false) };
      current = request;
      request.promise = (async () => {
        try {
          const result = await read(controller.signal);
          if (current !== request) return false;
          apply(result);
          return true;
        } catch (error) {
          if (current === request) failed(error);
          return false;
        } finally {
          if (current === request) current = null;
        }
      })();
      return request.promise;
    },
  };
}

export const CARE_CHANGED = "carby-care-changed";
/** Publish only an invalidation signal; care records never enter the channel. */
export function notifyCareChanged() {
  window.dispatchEvent(new Event(CARE_CHANGED));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(CARE_CHANGED);
    channel.postMessage("changed");
    channel.close();
  }
}
