import { readingAboveRange, type CorrectionReview } from "./correction-review";
/** Timing reference only; never infer a dose from an in-range, low, stale or
 * historical reading. `high` is the care plan's high-glucose limit (glucoseRanges(plan).high). */
export function correctionMarkerAt(
  review: CorrectionReview | null,
  current: boolean,
  value: number | null,
  status: string | null,
  target: number,
  high: number,
): string | null {
  return current &&
    review &&
    review.state !== "passed" &&
    readingAboveRange(value, status, target, high)
    ? review.at
    : null;
}
