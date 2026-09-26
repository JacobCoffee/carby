"use client";
import {
  getCarbRatio,
  mealRatioKeys,
  mealRatioLabels,
  type MealRatio,
  type MealRatios,
  type Plan,
} from "@/lib/care";

export function MealRatioPicker({
  plan,
  value,
  onChange,
}: {
  plan: Plan;
  value: MealRatio | null;
  onChange: (value: MealRatio) => void;
}) {
  if (!plan.mealRatios)
    return <p className="meal-ratio-note">Saved food ratio · 1 unit per {plan.ratio} g.</p>;
  const ratio = getCarbRatio(plan, value);
  return (
    <section className="meal-ratio-picker" aria-label="Meal carb ratio">
      <strong>Which meal ratio applies?</strong>
      <div className="meal-ratio-options" role="group" aria-label="Choose meal ratio">
        {mealRatioKeys.map((key) => (
          <button
            type="button"
            key={key}
            aria-pressed={value === key}
            onClick={() => onChange(key)}
          >
            <span>{mealRatioLabels[key]}</span>
            <strong>
              {plan.mealRatios![key] === null ? "Not set" : `1:${plan.mealRatios![key]}`}
            </strong>
          </button>
        ))}
      </div>
      <p className="helper" role="status">
        {!value
          ? "Choose the ratio that matches your care plan."
          : ratio === null
            ? "Snack / other has no saved ratio. Set it in Care plan when provided, or select a meal ratio only if that matches your instructions."
            : `${mealRatioLabels[value]} · 1 unit per ${ratio} g of carbohydrate.`}
      </p>
      <p className="helper">
        Starts from the time in {plan.timezone}: breakfast 06:00–10:00, lunch 11:00–15:00, dinner
        17:00–21:00; snack / other outside those windows. Change it if needed. Your choice stays
        fixed while calculating.
      </p>
    </section>
  );
}

export function MealRatioFields<R extends Partial<MealRatios>>({
  ratios,
  onChange,
  flagged = [],
}: {
  ratios: R;
  onChange: (ratios: R, changed: MealRatio) => void;
  flagged?: readonly MealRatio[];
}) {
  return (
    <fieldset className="meal-ratio-fields">
      <legend>Carb ratios by meal</legend>
      <p>Grams of carbohydrate covered by 1 unit. Enter the ratios provided by your clinician.</p>
      <div>
        {mealRatioKeys.map((key) => {
          const value: number | null | undefined = ratios[key];
          const invalid = flagged.includes(key);
          return (
            <label className="field" key={key}>
              <span>{mealRatioLabels[key]}</span>
              <div className="meal-ratio-input">
                <span aria-hidden="true">1:</span>
                <input
                  aria-label={`${mealRatioLabels[key]} grams per unit`}
                  aria-invalid={invalid || undefined}
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  max="300"
                  step="any"
                  required={key !== "snack" || invalid}
                  placeholder={key === "snack" && !invalid ? "Not set" : undefined}
                  value={value == null || !Number.isFinite(value) ? "" : value}
                  onChange={(event) =>
                    onChange(
                      {
                        ...ratios,
                        [key]:
                          event.target.value === ""
                            ? key === "snack"
                              ? null
                              : NaN
                            : Number(event.target.value),
                      } as R,
                      key,
                    )
                  }
                />
              </div>
              {invalid && (
                <small>The saved value could not be used. Enter it from your care plan.</small>
              )}
            </label>
          );
        })}
      </div>
      <small>
        Leave Snack / other blank if no separate ratio has been provided. Earlier entries keep the
        ratio used when logged.
      </small>
    </fieldset>
  );
}
