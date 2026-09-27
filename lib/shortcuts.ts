/**
 * Keyboard shortcuts, Linear style: a single key (`C`) or a two-key sequence (`L` then `G`).
 * Each one names the command palette item it runs, so the palette decides what exists and what is
 * disabled for the current person and role; a shortcut only reaches it by keyboard.
 */
export type Shortcut = { id: string; keys: string[]; label: string; group: ShortcutGroup };
export type ShortcutGroup = "Log" | "Go to" | "Day" | "General";

export const SHORTCUT_GROUPS: ShortcutGroup[] = ["Log", "Go to", "Day", "General"];

export const SHORTCUTS: Shortcut[] = [
  { id: "log-food", keys: ["l", "f"], label: "Log food", group: "Log" },
  { id: "log-insulin", keys: ["l", "i"], label: "Log insulin", group: "Log" },
  { id: "log-glucose", keys: ["l", "g"], label: "Log glucose", group: "Log" },
  { id: "log-illness", keys: ["l", "s"], label: "Log illness or other period", group: "Log" },
  { id: "log-low-treatment", keys: ["l", "l"], label: "Treat a low", group: "Log" },
  { id: "log-exercise", keys: ["l", "e"], label: "Log exercise", group: "Log" },
  { id: "log-rescue", keys: ["l", "m"], label: "Log emergency medication", group: "Log" },
  { id: "log-nightly", keys: ["l", "n"], label: "Nightly long-acting", group: "Log" },
  { id: "view-food-builder", keys: ["l", "b"], label: "Food builder", group: "Log" },
  { id: "calc-open", keys: ["c"], label: "Insulin calculator", group: "Log" },
  { id: "view-daily", keys: ["g", "d"], label: "Daily care", group: "Go to" },
  { id: "view-insights", keys: ["g", "i"], label: "Insights", group: "Go to" },
  { id: "view-logbook", keys: ["g", "l"], label: "Logbook", group: "Go to" },
  { id: "view-reports", keys: ["g", "r"], label: "Doctor report", group: "Go to" },
  { id: "view-handoff", keys: ["g", "h"], label: "Caregiver handoff", group: "Go to" },
  { id: "data-care-plan", keys: ["g", "p"], label: "Care plan", group: "Go to" },
  { id: "view-low-help", keys: ["h"], label: "Low glucose and emergency steps", group: "Go to" },
  { id: "nav-previous-day", keys: ["["], label: "Previous day", group: "Day" },
  { id: "nav-next-day", keys: ["]"], label: "Next day", group: "Day" },
  { id: "nav-today", keys: ["t"], label: "Go to today", group: "Day" },
  { id: "data-refresh", keys: ["r"], label: "Refresh data", group: "General" },
  { id: "show-hints", keys: ["f"], label: "Show button hints", group: "General" },
];

const byId = new Map(SHORTCUTS.map((shortcut) => [shortcut.id, shortcut]));

/** The keys that run a palette item, if it has a shortcut. */
export function shortcutKeys(id: string): string[] | undefined {
  return byId.get(id)?.keys;
}

/** How a key is printed on a keycap. */
export function keyLabel(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key;
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((k, i) => k === b[i]);
const startsWith = (keys: string[], prefix: string[]) =>
  keys.length > prefix.length && prefix.every((k, i) => k === keys[i]);

/**
 * Follows key presses toward a shortcut. `press` answers with the shortcut a key completes, with
 * "pending" while a sequence is part-typed, or with null. A sequence waits `timeout` ms for its
 * second key; a key that fits no sequence drops the part-typed one and is tried on its own.
 */
export function createShortcutMatcher(shortcuts: Shortcut[] = SHORTCUTS, timeout = 1200) {
  let pending: string[] = [];
  let since = 0;
  const reset = () => {
    pending = [];
  };
  const attempt = (keys: string[], now: number): Shortcut | "pending" | null => {
    const match = shortcuts.find((s) => same(s.keys, keys));
    if (match) {
      reset();
      return match;
    }
    if (shortcuts.some((s) => startsWith(s.keys, keys))) {
      pending = keys;
      since = now;
      return "pending";
    }
    reset();
    return null;
  };
  return {
    press(key: string, now: number): Shortcut | "pending" | null {
      const k = key.toLowerCase();
      if (pending.length && now - since > timeout) reset();
      if (!pending.length) return attempt([k], now);
      return attempt([...pending, k], now) ?? attempt([k], now);
    },
    reset,
    get pending() {
      return pending;
    },
  };
}
