export type DoseOverride = {
  context: string;
  units: string;
  reason: string;
  acknowledgedAt: string;
};

export function doseAmount(value: string): number | null {
  if (!value.trim()) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 && amount <= 100 ? amount : null;
}

export function stepDose(value: string, direction: -1 | 1, increment: number): string {
  const amount = doseAmount(value);
  if (amount === null || ![0.5, 1].includes(increment)) return value;
  return String(Number(Math.max(0, Math.min(100, amount + direction * increment)).toFixed(2)));
}

/** Keep an acknowledged adjustment tied to exactly the inputs it was reviewed with. */
export function currentDoseOverride(
  override: DoseOverride | null,
  context: string,
): DoseOverride | null {
  return override?.context === context ? override : null;
}

/** Snapshot the final recorded amount without changing the original formula result. */
export function doseAdjustment(
  calculated: number,
  actual: string,
  acknowledgedAt: string | null,
  reason: string,
) {
  const actualUnits = doseAmount(actual);
  if (actualUnits === null || actualUnits <= 0) throw new Error("Enter a positive actual dose.");
  if (actualUnits === calculated) return undefined;
  if (!acknowledgedAt || !Number.isFinite(Date.parse(acknowledgedAt)))
    throw new Error("Acknowledge the manual adjustment.");
  return { actualUnits, acknowledgedAt, reason: reason.trim() };
}
