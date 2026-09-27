"use client";
import { useEffect, useEffectEvent, useState } from "react";
import { createPortal } from "react-dom";
import { Kbd } from "@/components/ui/kbd";
import { hintLabels, matchHint, opensHints, savesDialog } from "@/lib/hints";
import "./button-hints.css";

/** Fired by the page's F shortcut and the command palette to show the hints. */
export const SHOW_HINTS = "carby-show-hints";

// Everything a person can press or type into.
const CONTROLS = [
  "button",
  "a[href]",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "summary",
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]',
  '[role="option"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="combobox"]',
  '[tabindex="0"]',
].join(",");
// Pressed with a click; anything else in CONTROLS (fields, a focusable chart) just takes focus.
const CLICKED =
  'button, a[href], summary, [role="button"], [role="tab"], [role^="menuitem"], [role="option"], [role="switch"], [role="checkbox"], [role="radio"], input[type=checkbox], input[type=radio]';
const LAYERS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

type Target = { element: HTMLElement; label: string; top: number; left: number };

/** The newest open dialog, menu or list, else the page. */
function openLayer(): { root: Element; inDialog: boolean } {
  const layers = [...document.querySelectorAll(LAYERS)].filter(
    (layer) => layer.getAttribute("data-state") !== "closed" && layer.closest("body"),
  );
  const top = layers.at(-1);
  return top ? { root: top, inDialog: true } : { root: document.body, inDialog: false };
}

/** Enabled, and the thing actually under its own centre: not scrolled away, clipped or covered. */
function reachable(element: HTMLElement) {
  if (element.matches(":disabled") || element.getAttribute("aria-disabled") === "true")
    return false;
  if (element.closest('[aria-hidden="true"], [inert], [hidden], .button-hints')) return false;
  const box = element.getBoundingClientRect();
  if (box.width < 2 || box.height < 2) return false;
  const x = Math.min(Math.max(box.left + box.width / 2, 0), window.innerWidth - 1);
  const y = Math.min(Math.max(box.top + box.height / 2, 0), window.innerHeight - 1);
  if (x < box.left || x > box.right || y < box.top || y > box.bottom) return false;
  const hit = document.elementFromPoint(x, y);
  return !!hit && (hit === element || element.contains(hit) || hit.contains(element));
}

function collect(): Target[] {
  const { root } = openLayer();
  const controls = [...root.querySelectorAll<HTMLElement>(CONTROLS)].filter(reachable);
  // One hint per control, on the innermost: a focusable tab list or panel holds its tabs and
  // buttons, and those are what get pressed.
  const found = controls.filter(
    (element) => !controls.some((inner) => inner !== element && element.contains(inner)),
  );
  // Letters run the way the page reads: row by row, left to right.
  const placed = found
    .map((element) => ({ element, box: element.getBoundingClientRect() }))
    .sort((a, b) =>
      Math.abs(a.box.top - b.box.top) > 12 ? a.box.top - b.box.top : a.box.left - b.box.left,
    );
  const labels = hintLabels(placed.length);
  return placed.map(({ element, box }, i) => ({
    element,
    label: labels[i],
    top: Math.max(box.top - 6, 2),
    left: Math.max(box.left - 6, 2),
  }));
}

/** Presses a hinted control the way a person would: a click, a menu opened, or focus. */
function press(element: HTMLElement) {
  element.focus();
  if (element instanceof HTMLSelectElement) {
    try {
      element.showPicker();
    } catch {
      // Not every browser opens a select from script; it keeps focus and arrow keys work.
    }
    return;
  }
  // Menus and pickers open on a key press, not a click.
  const popup = element.getAttribute("aria-haspopup");
  if (
    element.getAttribute("role") === "combobox" ||
    popup === "menu" ||
    popup === "listbox" ||
    popup === "true"
  ) {
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    return;
  }
  if (element.matches(CLICKED)) element.click();
}

const inTextField = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    (target instanceof HTMLInputElement &&
      !["button", "checkbox", "radio", "submit", "reset"].includes(target.type)));

/** ⌘Enter: the open dialog's submit button, in the form being edited if there are several. */
function saveDialog(): boolean {
  const { root, inDialog } = openLayer();
  if (!inDialog) return false;
  const forms = [...root.querySelectorAll("form")];
  const form = forms.find((f) => f.contains(document.activeElement)) ?? forms[0];
  const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!form || !submit || submit.disabled) return false;
  form.requestSubmit(submit);
  return true;
}

/**
 * Keyboard reach for every control: F in a dialog (or on the page, through the shortcut list), or
 * ⌥F anywhere, labels each control in the open dialog or the page; typing a label presses it.
 * ⌘Enter saves the open dialog.
 */
export default function ButtonHints() {
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [typed, setTyped] = useState("");
  const close = () => {
    setTargets(null);
    setTyped("");
  };
  const show = () =>
    // A frame later, so a command palette that opened this has closed first.
    requestAnimationFrame(() => {
      const found = collect();
      setTyped("");
      setTargets(found.length ? found : null);
    });

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.isComposing) return;
    if (targets) {
      if (["Shift", "Alt", "Meta", "Control", "CapsLock"].includes(event.key)) return;
      const letter = event.key.length === 1 && /[a-z]/i.test(event.key);
      if (event.key === "Escape" || event.key === "Backspace" || letter) {
        // Hints own these keys: Escape mustn't close the dialog, letters mustn't type.
        event.preventDefault();
        event.stopPropagation();
      }
      if (event.key === "Backspace") return setTyped((t) => t.slice(0, -1));
      if (!letter) return close();
      const labels = targets.map((t) => t.label);
      const { match, reachable: left } = matchHint(labels, typed + event.key);
      if (match !== null) {
        const { element } = targets[match];
        close();
        press(element);
      } else if (left.length) setTyped(typed + event.key.toLowerCase());
      else close();
      return;
    }
    if (savesDialog(event)) {
      if (saveDialog()) event.preventDefault();
      return;
    }
    if (
      opensHints(event, { inTextField: inTextField(event.target), inDialog: openLayer().inDialog })
    ) {
      event.preventDefault();
      event.stopPropagation();
      show();
    }
  });
  const onPointer = useEffectEvent(() => {
    if (targets) close();
  });
  // A scroll or resize moves the controls; the hints follow them, keeping their letters.
  const onMove = useEffectEvent(() => {
    if (!targets) return;
    setTargets(
      targets.map((target) => {
        const box = target.element.getBoundingClientRect();
        return { ...target, top: Math.max(box.top - 6, 2), left: Math.max(box.left - 6, 2) };
      }),
    );
  });
  const onShow = useEffectEvent(() => show());

  useEffect(() => {
    const key = (event: KeyboardEvent) => onKeyDown(event);
    const move = () => onMove();
    const pointer = () => onPointer();
    const open = () => onShow();
    // Capture on window runs before dialogs and menus see the key.
    window.addEventListener("keydown", key, true);
    window.addEventListener("scroll", move, true);
    window.addEventListener("resize", move);
    window.addEventListener("pointerdown", pointer, true);
    window.addEventListener(SHOW_HINTS, open);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", move, true);
      window.removeEventListener("resize", move);
      window.removeEventListener("pointerdown", pointer, true);
      window.removeEventListener(SHOW_HINTS, open);
    };
  }, []);

  if (!targets) return null;
  return createPortal(
    <div className="button-hints" aria-hidden="true">
      {targets.map((target) =>
        target.label.startsWith(typed) ? (
          <Kbd
            key={target.label}
            className="button-hint"
            style={{ top: target.top, left: target.left }}
          >
            <span className="button-hint-typed">{typed.toUpperCase()}</span>
            {target.label.slice(typed.length).toUpperCase()}
          </Kbd>
        ) : null,
      )}
    </div>,
    document.body,
  );
}
