"use client";
import { Fragment, type ReactNode } from "react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import "./command-palette.css";

export type CommandPaletteItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  keywords?: string[];
  shortcut?: string;
  disabled?: boolean;
  onSelect: () => void;
};

export type CommandPaletteGroup = {
  heading: string;
  items: CommandPaletteItem[];
};

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
/**
 * Every typed word must start a word of the label or keywords. cmdk's default subsequence match
 * let "report" pick "Correction review · window passed" over "Doctor report".
 */
function wordPrefixFilter(value: string, search: string, keywords?: string[]) {
  const query = words(search);
  if (!query.length) return 1;
  const label = words(value),
    extra = (keywords ?? []).flatMap(words);
  let score = 1;
  for (const part of query) {
    if (label.some((word) => word.startsWith(part))) continue;
    if (!extra.some((word) => word.startsWith(part))) return 0;
    score = 0.5;
  }
  return score;
}

export default function CommandPalette({
  open,
  onOpenChange,
  groups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: CommandPaletteGroup[];
}) {
  const visibleGroups = groups.filter((group) => group.items.length > 0);
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      className="care-command-palette"
      filter={wordPrefixFilter}
      title="Command palette"
      description="Jump to a tool or action in Carby"
    >
      <CommandInput placeholder="Search commands…" />
      <CommandList>
        <CommandEmpty>No matching command.</CommandEmpty>
        {visibleGroups.map((group, i) => (
          <Fragment key={group.heading}>
            <CommandGroup heading={group.heading}>
              {group.items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.label}
                  disabled={item.disabled}
                  keywords={item.keywords}
                  onSelect={() => {
                    item.onSelect();
                    onOpenChange(false);
                  }}
                >
                  {item.icon}
                  <span>{item.label}</span>
                  {item.shortcut && <CommandShortcut>{item.shortcut}</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
            {i < visibleGroups.length - 1 && <CommandSeparator />}
          </Fragment>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
