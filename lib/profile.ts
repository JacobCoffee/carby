import { z } from "zod";

// C0/C1 control characters and bidirectional overrides, which can disguise the displayed name.
function hasControlCharacter(value: string) {
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) return true;
  }
  return false;
}
const personName = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !hasControlCharacter(v), "Remove line breaks and control characters.");

/** A calendar date that has already happened, in the person's local time. */
const pastCalendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Enter a valid date.")
  .refine(
    // No zone is known here, so allow the latest calendar date anywhere (UTC+14): a date that is
    // today in the person's zone is never refused, and one that is still ahead everywhere is.
    (value) => value <= new Date(Date.now() + 14 * 3_600_000).toISOString().slice(0, 10),
    "Enter a date that has already happened.",
  );

export const profileRoles = ["self", "parent", "caregiver"] as const;
export type ProfileRole = (typeof profileRoles)[number];
export const profileRoleLabels: Record<ProfileRole, string> = {
  self: "I'm the person with diabetes",
  parent: "I'm a parent",
  caregiver: "I'm a caregiver",
};

/**
 * A small, optional personalization record: the name Carby shows in greetings and reports, who is
 * using Carby, and (only when the person chooses to share it) when they were diagnosed. Deliberately
 * excludes birth year, condition details, or anything else that adds no personalization value but
 * would grow the amount of health-adjacent data Carby stores.
 */
export const profileSchema = z.object({
  id: z.string().uuid(),
  name: personName(60),
  role: z.enum(profileRoles),
  caregiverName: personName(60).optional(),
  diagnosedOn: pastCalendarDate.optional(),
});
export type Profile = z.infer<typeof profileSchema>;
