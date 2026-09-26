export type CorrectionReview = {
  at: string;
  state: "upcoming" | "window" | "passed";
  notice: string;
  menuLabel: string;
};

export const CORRECTION_REVIEW_WINDOW_MINUTES = 30;

/** Describe the configured review interval without implying a dose is due. */
export function correctionReviewStatus(
  lastCorrectionAt: string | null | undefined,
  now: number,
  timezone: string,
  correctionHours: number,
): CorrectionReview | null {
  const recordedAt = lastCorrectionAt ? Date.parse(lastCorrectionAt) : NaN;
  if (
    !Number.isFinite(recordedAt) ||
    !Number.isFinite(now) ||
    !Number.isFinite(correctionHours) ||
    correctionHours <= 0 ||
    recordedAt > now
  )
    return null;
  const reviewAt = recordedAt + correctionHours * 60 * 60 * 1000;
  const at = new Date(reviewAt).toISOString();
  const grace = CORRECTION_REVIEW_WINDOW_MINUTES * 60 * 1000;
  const state = now < reviewAt - grace ? "upcoming" : now <= reviewAt + grace ? "window" : "passed";
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
  }).format(new Date(reviewAt));
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(reviewAt));
  return {
    at,
    state,
    notice:
      state === "upcoming"
        ? `Next correction review: ${date} at ${time}.`
        : state === "window"
          ? `Within the review window around ${date} at ${time} (±${CORRECTION_REVIEW_WINDOW_MINUTES} minutes). This is a timing reminder, not a recommendation to give insulin.`
          : `The review window around ${date} at ${time} has passed. This is a timing reminder, not a recommendation to give insulin.`,
    menuLabel:
      state === "window"
        ? "Correction review · review window"
        : state === "upcoming"
          ? `Correction review · ${date}, ${time}`
          : "Correction review · window passed",
  };
}
