export type DoseLogState = {
  needsCarbs: boolean;
  carbsValid: boolean;
  carbRatioSet: boolean;
  needsCorrection: boolean;
  hasReading: boolean;
  low: boolean;
  correctionReady: boolean;
  roundedUnits: number;
  recordUnits: number | null;
  actualDoseValid: boolean;
  reviewRequired: boolean;
  reviewed: boolean;
};

/** The first thing stopping the calculator from logging, phrased as what to do next. */
export function doseLogBlocker(s: DoseLogState): string | null {
  if (s.needsCarbs && !s.carbsValid) return "Enter the carbohydrates to cover.";
  if (s.needsCarbs && !s.carbRatioSet) return "Add a carb ratio for this meal to your care plan.";
  if (s.needsCorrection && !s.hasReading) return "Enter a glucose reading.";
  if (s.needsCorrection && s.low) return "Glucose is low, so no correction is calculated.";
  if (s.needsCorrection && !s.correctionReady)
    return "Enter a numeric glucose reading from the last 10 minutes.";
  if (s.roundedUnits <= 0) return "Plan math rounds to 0 units, so there is no dose to log.";
  if (s.recordUnits === null || s.recordUnits <= 0) return "Enter a positive adjusted amount.";
  if (!s.actualDoseValid) return "Enter the actual dose given.";
  if (s.reviewRequired && !s.reviewed)
    return "Tick “I reviewed the last Rapid-acting dose” at the top of this panel.";
  return null;
}
