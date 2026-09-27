/**
 * Button hints: every control in the open dialog (or the page) gets a short label, and typing it
 * presses that control. Home-row letters come first so the common case stays under the fingers.
 */
export const HINT_KEYS = "asdfghjklqwertyuiopzxcvbnm";

/**
 * `count` distinct labels, none a prefix of another, so a label is pressed the moment its last
 * letter is typed. Up to one per letter; past that every label is two letters.
 */
export function hintLabels(count: number, keys: string = HINT_KEYS): string[] {
  if (count <= keys.length) return keys.slice(0, Math.max(0, count)).split("");
  const labels: string[] = [];
  for (const first of keys)
    for (const second of keys) {
      if (labels.length === count) return labels;
      labels.push(first + second);
    }
  return labels;
}

/**
 * Where typing `typed` has got to: the index of the label it completes, or null with the indexes
 * of labels still reachable. No reachable label means the typing missed.
 */
export function matchHint(
  labels: readonly string[],
  typed: string,
): { match: number | null; reachable: number[] } {
  const key = typed.toLowerCase();
  const exact = labels.indexOf(key);
  if (exact !== -1) return { match: exact, reachable: [exact] };
  return {
    match: null,
    reachable: labels.flatMap((label, i) => (label.startsWith(key) ? [i] : [])),
  };
}

export type HintKey = {
  key: string;
  code: string;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  repeat: boolean;
};

/**
 * Whether a key press opens the hints: ⌥F anywhere, even while typing, and a bare F in a dialog
 * outside a field. On the bare page F goes through the shortcut list instead, so L then F still
 * logs food.
 */
export function opensHints(event: HintKey, where: { inTextField: boolean; inDialog: boolean }) {
  if (event.repeat || event.metaKey || event.ctrlKey) return false;
  if (event.altKey) return event.code === "KeyF";
  return where.inDialog && !where.inTextField && event.key.toLowerCase() === "f";
}

/** ⌘Enter, or Ctrl+Enter, saves the open dialog: it presses the dialog's own submit button. */
export function savesDialog(event: HintKey) {
  return event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.altKey;
}
