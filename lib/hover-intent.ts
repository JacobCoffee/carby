/** Runs `run` after `ms` and returns a function that cancels it. */
export type Schedule = (run: () => void, ms: number) => () => void;

const timeout: Schedule = (run, ms) => {
  const id = setTimeout(run, ms);
  return () => clearTimeout(id);
};

/**
 * Hover intent for a menu that opens on pointer hover: entering the trigger or the menu opens it
 * after `openDelay`, leaving either closes it after `closeDelay`. Only the latest move counts, so
 * crossing the gap between trigger and menu never closes it, and a pointer that only passes over
 * the trigger never opens it.
 */
export function createHoverIntent(
  setOpen: (open: boolean) => void,
  {
    openDelay,
    closeDelay,
    schedule = timeout,
  }: { openDelay: number; closeDelay: number; schedule?: Schedule },
) {
  let pending: (() => void) | null = null;
  const cancel = () => {
    pending?.();
    pending = null;
  };
  const later = (open: boolean, ms: number) => {
    cancel();
    pending = schedule(() => {
      pending = null;
      setOpen(open);
    }, ms);
  };
  return {
    enter: () => later(true, openDelay),
    leave: () => later(false, closeDelay),
    cancel,
  };
}
