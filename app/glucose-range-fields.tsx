"use client";
import { Checkbox } from "@/components/ui/checkbox";
import {
  STANDARD_GLUCOSE_RANGES,
  glucoseRangeKeys,
  glucoseRangeLabels,
  type GlucoseRanges,
} from "@/lib/care";

/**
 * The plan's reporting ranges. Unset means the standard ranges; choosing the care team's starts
 * from the standard values so only the limits that differ need changing.
 */
export function GlucoseRangeFields({
  ranges,
  onChange,
  invalid = false,
  disabled = false,
}: {
  ranges: GlucoseRanges | undefined;
  onChange: (ranges: GlucoseRanges | undefined) => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const custom = ranges !== undefined;
  return (
    <fieldset className="meal-ratio-fields glucose-range-fields" disabled={disabled}>
      <legend>Glucose ranges for reports</legend>
      <p>
        Charts, Insights and reports sort readings into these ranges. Dose calculations never use
        them.
      </p>
      <label className="check-row">
        <Checkbox
          checked={custom}
          onCheckedChange={(checked) =>
            onChange(checked === true ? { ...(ranges ?? STANDARD_GLUCOSE_RANGES) } : undefined)
          }
        />
        <span>Use ranges from the care team</span>
      </label>
      {custom ? (
        <div>
          {glucoseRangeKeys.map((key) => (
            <label className="field" key={key}>
              <span>{glucoseRangeLabels[key]} (mg/dL)</span>
              <input
                aria-invalid={invalid || undefined}
                type="number"
                inputMode="numeric"
                min="40"
                max="400"
                step="1"
                required
                value={Number.isFinite(ranges[key]) ? ranges[key] : ""}
                onChange={(event) =>
                  onChange({
                    ...ranges,
                    [key]: event.target.value === "" ? NaN : Number(event.target.value),
                  })
                }
              />
            </label>
          ))}
        </div>
      ) : (
        <small>
          Standard ranges: very low below {STANDARD_GLUCOSE_RANGES.veryLow}, low below{" "}
          {STANDARD_GLUCOSE_RANGES.low}, high above {STANDARD_GLUCOSE_RANGES.high}, very high above{" "}
          {STANDARD_GLUCOSE_RANGES.veryHigh} mg/dL.
        </small>
      )}
      {invalid && (
        <small>
          Use whole numbers from 40 to 400, each higher than the one before it. Copy them from your
          care plan.
        </small>
      )}
    </fieldset>
  );
}
