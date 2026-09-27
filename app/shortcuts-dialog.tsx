"use client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SHORTCUTS, SHORTCUT_GROUPS } from "@/lib/shortcuts";
import ShortcutKeys from "./shortcut-keys";

// Keys the page handles itself rather than through a palette item.
const GENERAL: { label: string; keys: string[][] }[] = [
  { label: "Search commands", keys: [["⌘", "K"], ["/"]] },
  { label: "Keyboard shortcuts", keys: [["?"], ["⌘", "/"]] },
  { label: "Button hints, even in a dialog or field", keys: [["⌥", "F"]] },
  { label: "Save the open dialog", keys: [["⌘", "↵"]] },
];

/**
 * Every shortcut this person can use right now. `available` is the set of palette item ids on
 * offer, so a viewer never sees the logging keys.
 */
export default function ShortcutsDialog({
  open,
  onOpenChange,
  available,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  available: Set<string>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="care-dialog shortcuts-dialog">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Press letter keys one after another, not together. They work anywhere outside a text
            field; keys with ⌘ or ⌥ are pressed together. With button hints, type the letter shown
            on a button to press it.
          </DialogDescription>
        </DialogHeader>
        <div className="shortcuts-groups">
          {SHORTCUT_GROUPS.map((group) => {
            const rows = SHORTCUTS.filter((s) => s.group === group && available.has(s.id));
            if (group !== "General" && !rows.length) return null;
            return (
              <section key={group} className="shortcuts-group">
                <h3>{group}</h3>
                <dl>
                  {rows.map((shortcut) => (
                    <div key={shortcut.id}>
                      <dt>{shortcut.label}</dt>
                      <dd>
                        <ShortcutKeys keys={shortcut.keys} then />
                      </dd>
                    </div>
                  ))}
                  {group === "General" &&
                    GENERAL.map((row) => (
                      <div key={row.label}>
                        <dt>{row.label}</dt>
                        <dd>
                          {row.keys.map((keys, i) => (
                            <span key={i} className="shortcuts-alt">
                              {i > 0 && <span className="shortcut-keys-then">or</span>}
                              <ShortcutKeys keys={keys} />
                            </span>
                          ))}
                        </dd>
                      </div>
                    ))}
                </dl>
              </section>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
