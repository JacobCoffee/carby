"use client";
import { Checkbox } from "@/components/ui/checkbox";
import {
  STANDARD_GLUCOSE_RANGES,
  glucoseRangeKeys,
  glucoseRangeLabels,
  type GlucoseRanges,
} from "@/lib/care";
import {
  formatGlucose,
  formatUnitValue,
  glucoseInputBounds,
  type GlucoseUnit,
} from "@/lib/glucose-units";
import { GlucoseField } from "./plan-settings-fields";

/** The mg/dL limits the plan schema accepts for each range limit. */
const RANGE_MIN = 40;
const RANGE_MAX = 400;

/**
 * The plan's reporting ranges. Unset means the standard ranges; choosing the care team's starts
 * from the standard values so only the limits that differ need changing.
 */
export function GlucoseRangeFields({
  ranges,
  unit,
  onChange,
  invalid = false,
  disabled = false,
}: {
  ranges: GlucoseRanges | undefined;
  unit: GlucoseUnit;
  onChange: (ranges: GlucoseRanges | undefined) => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const custom = ranges !== undefined;
  const bounds = glucoseInputBounds(RANGE_MIN, RANGE_MAX, unit);
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
            <GlucoseField
              key={key}
              label={glucoseRangeLabels[key]}
              unit={unit}
              value={ranges[key]}
              onChange={(value) => onChange({ ...ranges, [key]: value })}
              min={RANGE_MIN}
              max={RANGE_MAX}
              required
              invalid={invalid}
            />
          ))}
        </div>
      ) : (
        <small>
          Standard ranges: very low below {formatGlucose(STANDARD_GLUCOSE_RANGES.veryLow, unit)},
          low below {formatGlucose(STANDARD_GLUCOSE_RANGES.low, unit)}, high above{" "}
          {formatGlucose(STANDARD_GLUCOSE_RANGES.high, unit)}, very high above{" "}
          {formatGlucose(STANDARD_GLUCOSE_RANGES.veryHigh, unit)} {unit}.
        </small>
      )}
      {invalid && (
        <small>
          Use values from {formatUnitValue(bounds.min, unit)} to {formatUnitValue(bounds.max, unit)}{" "}
          {unit}, each higher than the one before it. Copy them from your care plan.
        </small>
      )}
    </fieldset>
  );
}
