"use client";
import {
  careContactKeys,
  careContactLabels,
  careContactMaxLength,
  isCareContactPhoneKey,
  type CareContactKey,
  type CareContacts,
  type OtherContact,
} from "@/lib/care";

export function CareContactFields({
  values,
  onChange,
  invalid = [],
  disabled,
}: {
  values: CareContacts;
  onChange: (values: CareContacts, changed: CareContactKey) => void;
  invalid?: readonly CareContactKey[];
  disabled?: boolean;
}) {
  return (
    <fieldset className="care-contact-fields" disabled={disabled}>
      <legend>Care contacts (optional)</legend>
      <p>
        Carby shows these, with phone links, on the dashboard, in the emergency steps, and in the
        caregiver handoff. Enter availability as your care plan states it. Leave blank any you do
        not have.
      </p>
      <div className="two-fields">
        {careContactKeys.map((key) => {
          const phone = isCareContactPhoneKey(key);
          const availability = key === "careTeamHours" || key === "afterHoursHours";
          const flagged = invalid.includes(key);
          return (
            <label className={availability ? "field is-wide" : "field"} key={key}>
              <span>{careContactLabels[key]}</span>
              <input
                name={`contacts.${key}`}
                type={phone ? "tel" : "text"}
                autoComplete="off"
                maxLength={careContactMaxLength[key]}
                aria-invalid={flagged || undefined}
                value={values[key] ?? ""}
                onChange={(event) => onChange({ ...values, [key]: event.target.value }, key)}
              />
              {flagged ? (
                <small>
                  {phone
                    ? "Use digits, with an optional leading +, spaces, parentheses, hyphens, or dots."
                    : `Use up to ${careContactMaxLength[key]} characters on one line.`}
                </small>
              ) : (
                key === "emergencyPhone" && (
                  <small>Leave blank to show the general emergency guidance.</small>
                )
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** The contact keys named by a failed plan parse, so the form can mark those fields. */
export function contactIssues(issues: readonly { path: (string | number)[] }[]) {
  return careContactKeys.filter((key) =>
    issues.some((issue) => issue.path[0] === "contacts" && issue.path[1] === key),
  );
}

/** One row of the family's other care contacts: role is required, the rest optional. */
export type { OtherContact };
const otherContactFieldKeys = ["role", "name", "phone", "hours"] as const;
type OtherContactField = (typeof otherContactFieldKeys)[number];
const otherContactLabels: Record<OtherContactField, string> = {
  role: "Role",
  name: "Name",
  phone: "Phone",
  hours: "Hours",
};
const otherContactMaxLength: Record<OtherContactField, number> = {
  role: 60,
  name: 60,
  phone: 40,
  hours: 60,
};
const MAX_OTHER_CONTACTS = 20;

export function OtherContactFields({
  values,
  onChange,
  invalid = [],
  disabled,
}: {
  values: readonly OtherContact[];
  onChange: (values: OtherContact[]) => void;
  /** `"<row index>.<field>"` entries, matching `otherContactIssues`. */
  invalid?: readonly string[];
  disabled?: boolean;
}) {
  function update(index: number, field: OtherContactField, value: string) {
    onChange(values.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }
  function remove(index: number) {
    onChange(values.filter((_, i) => i !== index));
  }
  return (
    <fieldset className="care-contact-fields other-contact-fields" disabled={disabled}>
      <legend>Other care contacts (optional)</legend>
      <p>
        Add anyone else named in your care plan you would like Carby to show, such as a program
        coordinator, pharmacy, or school nurse. Leave a field blank if you do not have it.
      </p>
      {values.map((row, index) => (
        <div className="other-contact-row" key={index}>
          <div className="two-fields">
            {otherContactFieldKeys.map((field) => {
              const phone = field === "phone";
              const flagged = invalid.includes(`${index}.${field}`);
              return (
                <label className="field" key={field}>
                  <span>{otherContactLabels[field]}</span>
                  <input
                    type={phone ? "tel" : "text"}
                    autoComplete="off"
                    maxLength={otherContactMaxLength[field]}
                    aria-invalid={flagged || undefined}
                    required={field === "role"}
                    value={row[field] ?? ""}
                    onChange={(event) => update(index, field, event.target.value)}
                  />
                  {flagged && (
                    <small>
                      {phone
                        ? "Use digits, with an optional leading +, spaces, parentheses, hyphens, or dots."
                        : `Use up to ${otherContactMaxLength[field]} characters on one line.`}
                    </small>
                  )}
                </label>
              );
            })}
          </div>
          <button
            type="button"
            className="text-button delete"
            disabled={disabled}
            onClick={() => remove(index)}
          >
            Remove this contact
          </button>
        </div>
      ))}
      <button
        type="button"
        className="button outline"
        disabled={disabled || values.length >= MAX_OTHER_CONTACTS}
        onClick={() => onChange([...values, { role: "" } as OtherContact])}
      >
        Add another contact
      </button>
    </fieldset>
  );
}

/** `"<row index>.<field>"` entries named by a failed plan parse, so rows can mark those fields. */
export function otherContactIssues(issues: readonly { path: (string | number)[] }[]) {
  const flagged = new Set<string>();
  for (const issue of issues)
    if (
      issue.path[0] === "otherContacts" &&
      typeof issue.path[1] === "number" &&
      typeof issue.path[2] === "string"
    )
      flagged.add(`${issue.path[1]}.${issue.path[2]}`);
  return [...flagged];
}
