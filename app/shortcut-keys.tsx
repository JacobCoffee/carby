import { Fragment } from "react";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { keyLabel } from "@/lib/shortcuts";

/** A shortcut's keys as keycaps; `then` spells out that a sequence is pressed one key at a time. */
export default function ShortcutKeys({
  keys,
  then = false,
  className,
}: {
  keys: string[];
  then?: boolean;
  className?: string;
}) {
  return (
    <KbdGroup className={className ? `shortcut-keys ${className}` : "shortcut-keys"}>
      {keys.map((key, i) => (
        <Fragment key={i}>
          {then && i > 0 && <span className="shortcut-keys-then">then</span>}
          <Kbd>{keyLabel(key)}</Kbd>
        </Fragment>
      ))}
    </KbdGroup>
  );
}
