"use client";
import {
  EMERGENCY_INSTRUCTION_MAX,
  emergencyInstructionKeys,
  emergencyInstructionLabels,
  type EmergencyInstructionKey,
  type EmergencyInstructions,
} from "@/lib/care";

export function EmergencyInstructionFields({
  values,
  onChange,
  invalid = [],
  disabled,
}: {
  values: EmergencyInstructions;
  onChange: (values: EmergencyInstructions, changed: EmergencyInstructionKey) => void;
  invalid?: readonly EmergencyInstructionKey[];
  disabled?: boolean;
}) {
  return (
    <fieldset className="care-contact-fields emergency-instruction-fields" disabled={disabled}>
      <legend>Emergency instructions (optional)</legend>
      <p>
        Enter these from your current care plan, as your care team wrote them. Carby shows them in
        the emergency steps and the caregiver handoff. Leave a field blank to show general guidance
        instead.
      </p>
      {emergencyInstructionKeys.map((key) => {
        const flagged = invalid.includes(key);
        return (
          <label className="field" key={key}>
            <span>{emergencyInstructionLabels[key]}</span>
            <textarea
              name={`emergencyInstructions.${key}`}
              rows={4}
              maxLength={EMERGENCY_INSTRUCTION_MAX}
              aria-invalid={flagged || undefined}
              value={values[key] ?? ""}
              onChange={(event) => onChange({ ...values, [key]: event.target.value }, key)}
            />
            {flagged && (
              <small>
                Use up to {EMERGENCY_INSTRUCTION_MAX.toLocaleString("en")} characters, without
                control characters.
              </small>
            )}
          </label>
        );
      })}
    </fieldset>
  );
}

/** Saved care-plan text, shown as plain text with its line breaks. */
export function CarePlanInstructions({ text }: { text: string }) {
  return <p className="care-plan-instructions">{text}</p>;
}

/** The instruction keys named by a failed plan parse, so the form can mark those fields. */
export function instructionIssues(issues: readonly { path: (string | number)[] }[]) {
  return emergencyInstructionKeys.filter((key) =>
    issues.some((issue) => issue.path[0] === "emergencyInstructions" && issue.path[1] === key),
  );
}
