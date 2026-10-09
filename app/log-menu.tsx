"use client";
import type { CSSProperties, ReactNode } from "react";
import {
  Calculator,
  Candy,
  ChefHat,
  Droplet,
  Dumbbell,
  Moon,
  Plus,
  Siren,
  Syringe,
  Thermometer,
  Utensils,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { personLabel } from "@/lib/people";
import { shortcutKeys } from "@/lib/shortcuts";
import { useHoverMenu } from "./hover-menu";
import { usePersonAccess } from "./person-context";
import ShortcutKeys from "./shortcut-keys";
import "./log-menu.css";

export type LogAction =
  | "food"
  | "insulin"
  | "glucose"
  | "illness"
  | "low"
  | "exercise"
  | "rescue"
  | "nightly"
  | "calculator"
  | "food-builder";

type Choice = { action: LogAction; label: string; icon: ReactNode; detail?: string };

/** Records that carry their own time, and so can be logged at a moment picked on the chart. */
export type TimedLogAction = Extract<
  LogAction,
  "food" | "insulin" | "glucose" | "illness" | "exercise" | "rescue"
>;
const TIMED: ReadonlySet<LogAction> = new Set<TimedLogAction>([
  "food",
  "insulin",
  "glucose",
  "illness",
  "exercise",
  "rescue",
]);
const isTimed = (action: LogAction): action is TimedLogAction => TIMED.has(action);

const TILES: (Choice & { tone: string })[] = [
  { action: "food", tone: "food", label: "Food", detail: "Carbs and meals", icon: <Utensils /> },
  {
    action: "insulin",
    tone: "insulin",
    label: "Insulin",
    detail: "A dose given",
    icon: <Syringe />,
  },
  { action: "glucose", tone: "glucose", label: "Glucose", detail: "A reading", icon: <Droplet /> },
  {
    action: "illness",
    tone: "illness",
    label: "Illness",
    detail: "Or another period",
    icon: <Thermometer />,
  },
];

const MORE: Choice[] = [
  { action: "low", label: "Treat a low", icon: <Candy /> },
  { action: "exercise", label: "Exercise", icon: <Dumbbell /> },
  { action: "rescue", label: "Emergency medication", icon: <Siren /> },
  { action: "nightly", label: "Nightly long-acting", icon: <Moon /> },
];

const TOOLS: Choice[] = [
  { action: "calculator", label: "Insulin calculator", icon: <Calculator /> },
  { action: "food-builder", label: "Food builder", icon: <ChefHat /> },
];

// The command palette item, and so the keyboard shortcut, behind each choice.
const PALETTE_ID: Record<LogAction, string> = {
  food: "log-food",
  insulin: "log-insulin",
  glucose: "log-glucose",
  illness: "log-illness",
  low: "log-low-treatment",
  exercise: "log-exercise",
  rescue: "log-rescue",
  nightly: "log-nightly",
  calculator: "calc-open",
  "food-builder": "view-food-builder",
};

// Each item's place in the entrance stagger.
const order = (i: number) => ({ "--i": i }) as CSSProperties;

/** Whose log this is, named only when there is more than one to choose from. */
function useLoggingFor(name?: string) {
  const access = usePersonAccess();
  return access.people.length > 1
    ? personLabel(name ?? access.people.find((p) => p.id === access.person)?.name)
    : null;
}

/**
 * The sheet's choices: four tiles, then the rest as a list. `timedOnly` keeps the records that
 * take a time and drops the shortcut hints, which open a record at the current time instead.
 */
function LogChoices({
  timedOnly,
  nightlyDisabled,
  onSelect,
}: {
  timedOnly: boolean;
  nightlyDisabled: boolean;
  onSelect: (action: LogAction) => void;
}) {
  const more = timedOnly ? MORE.filter((choice) => isTimed(choice.action)) : MORE;
  const item = ({ action, label, icon, detail }: Choice, i: number, className: string) => {
    const keys = timedOnly ? undefined : shortcutKeys(PALETTE_ID[action]);
    return (
      <DropdownMenuItem
        key={action}
        className={`log-sheet-item ${className}`}
        style={order(i)}
        disabled={action === "nightly" ? nightlyDisabled : false}
        onSelect={() => onSelect(action)}
      >
        <span className="log-sheet-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="log-sheet-text">
          <strong>{label}</strong>
          {detail && <small>{detail}</small>}
        </span>
        {keys && <ShortcutKeys keys={keys} className="log-sheet-keys" />}
      </DropdownMenuItem>
    );
  };
  return (
    <>
      <div className="log-sheet-tiles">
        {TILES.map((tile, i) => item(tile, i, `log-sheet-tile tone-${tile.tone}`))}
      </div>
      <div className="log-sheet-list">
        {more.map((choice, i) => item(choice, TILES.length + i, "log-sheet-row"))}
      </div>
      {!timedOnly && (
        <>
          <DropdownMenuSeparator />
          <div className="log-sheet-list">
            {TOOLS.map((choice, i) =>
              item(choice, TILES.length + more.length + i, "log-sheet-row"),
            )}
          </div>
        </>
      )}
    </>
  );
}

/**
 * The one way to add a record on wider screens: a floating button in the corner that opens a sheet
 * of everything loggable, on hover or on click. Phones keep the fixed quick bar instead.
 */
export default function LogMenu({
  name,
  disabled,
  nightlyDisabled,
  onSelect,
}: {
  name?: string;
  disabled: boolean;
  nightlyDisabled: boolean;
  onSelect: (action: LogAction) => void;
}) {
  const hover = useHoverMenu();
  const who = useLoggingFor(name);
  return (
    <DropdownMenu {...hover.root}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="log-fab"
          data-open={hover.open || undefined}
          disabled={disabled}
          aria-label={who ? `Log for ${who}` : "Log"}
          {...hover.trigger}
        >
          <Plus size={19} aria-hidden="true" />
          <span>Log</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        sideOffset={12}
        collisionPadding={16}
        className="log-sheet"
        {...hover.content}
      >
        {who && <DropdownMenuLabel className="log-sheet-who">Logging for {who}</DropdownMenuLabel>}
        <LogChoices timedOnly={false} nightlyDisabled={nightlyDisabled} onSelect={onSelect} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The same sheet, opened at a moment picked on the glucose chart. It offers only the records that
 * carry a time; the caller opens each one's form set to that moment.
 */
export function LogAtMenu({
  open,
  label,
  anchor,
  name,
  onOpenChange,
  onSelect,
  onCloseAutoFocus,
}: {
  open: boolean;
  /** The moment, as the chart's readout names it. */
  label: string;
  /** Where the moment was picked, in pixels from the corner of the positioned parent. */
  anchor: { left: number; top: number };
  name?: string;
  onOpenChange: (open: boolean) => void;
  onSelect: (action: TimedLogAction) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const who = useLoggingFor(name);
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <span className="log-at-anchor" style={anchor} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="bottom"
        align="start"
        sideOffset={10}
        collisionPadding={16}
        className="log-sheet"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DropdownMenuLabel className="log-sheet-who">
          Log at {label}
          {who ? ` for ${who}` : ""}
        </DropdownMenuLabel>
        <LogChoices
          timedOnly
          nightlyDisabled={false}
          onSelect={(action) => {
            if (isTimed(action)) onSelect(action);
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
