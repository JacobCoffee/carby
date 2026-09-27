"use client";
import { apiFetch } from "@/lib/person-request";
import { useEffect, useMemo, useState } from "react";
import { Activity } from "lucide-react";
import { dateKey, type CgmReading, type Entry } from "@/lib/care";
import { addDays, type CgmSummaryResponse } from "@/lib/cgm-summary";
import {
  AGP_MIN_DAYS,
  AGP_MIN_WEAR_PERCENT,
  CAPPED_LIMIT_PERCENT,
  GLUCOSE_LEVELS,
  glucoseLevelLabels,
  type AgpSlot,
  type AgpValue,
  type GlucoseLevels,
} from "@/lib/glucose-metrics";
import { CARE_CHANGED } from "@/lib/live-refresh";
import { foodResponseRanking, mealResponses, MIN_MEALS_FOR_RANKING } from "@/lib/meal-response";
import "./cgm-overview.css";

const PERIODS = [14, 30, 90, 365] as const;
type Period = (typeof PERIODS)[number];
type Loaded =
  | { key: string; current: CgmSummaryResponse; previous: CgmSummaryResponse }
  | { key: string; error: string };

async function fetchSummary(startDay: string, endDay: string, signal: AbortSignal) {
  const response = await apiFetch(`/api/cgm/summary?start=${startDay}&end=${endDay}`, {
    cache: "no-store",
    signal,
  });
  const data = (await response.json().catch(() => ({}))) as CgmSummaryResponse & {
    error?: string;
  };
  if (!response.ok) throw new Error(data.error ?? "CGM summary is unavailable.");
  return data;
}

const pct = (value: number | null | undefined) => (value == null ? "—" : `${value}%`);
const below70 = (levels: GlucoseLevels) => Math.round((levels.veryLow + levels.low) * 10) / 10;
const above180 = (levels: GlucoseLevels) => Math.round((levels.high + levels.veryHigh) * 10) / 10;

export function LevelsBar({ levels }: { levels: GlucoseLevels }) {
  return (
    <div className="cgm-levels">
      <div
        className="cgm-levels-track"
        role="img"
        aria-label={GLUCOSE_LEVELS.map((l) => `${glucoseLevelLabels[l]} ${levels[l]}%`).join(", ")}
      >
        {GLUCOSE_LEVELS.map((level) => (
          <span key={level} className={`level-${level}`} style={{ flexGrow: levels[level] }} />
        ))}
      </div>
      <ul className="cgm-levels-legend">
        {[...GLUCOSE_LEVELS].reverse().map((level) => (
          <li key={level}>
            <i className={`level-${level}`} aria-hidden="true" />
            <span>{glucoseLevelLabels[level]}</span>
            <strong>{levels[level]}%</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Keys for drawing: a status sits on the sensor's limit line, never at a made-up value. */
const drawValue = (v: AgpValue | null) =>
  v === null ? null : v === "High" ? 400 : v === "Low" ? 40 : v;
const AGP_MIN_SLOT_READINGS = 3;

export function AgpChart({ slots }: { slots: AgpSlot[] }) {
  const x = (minute: number) => 44 + (minute / 1440) * 940;
  const y = (v: number) => 226 - ((Math.min(400, Math.max(40, v)) - 40) / 360) * 210;
  // Consecutive well-sampled slots draw as one run; a thin slot breaks the bands.
  const runs: AgpSlot[][] = [];
  for (const slot of slots) {
    if (slot.readings < AGP_MIN_SLOT_READINGS) {
      if (runs.at(-1)?.length) runs.push([]);
      continue;
    }
    if (!runs.length) runs.push([]);
    runs.at(-1)!.push(slot);
  }
  const mid = (s: AgpSlot) => s.minute + 7.5;
  const band = (run: AgpSlot[], lo: keyof AgpSlot, hi: keyof AgpSlot) =>
    [
      ...run.map((s) => `${x(mid(s))},${y(drawValue(s[hi] as AgpValue)!)}`),
      ...[...run].reverse().map((s) => `${x(mid(s))},${y(drawValue(s[lo] as AgpValue)!)}`),
    ].join(" ");
  const median = slots.filter((s) => s.readings >= AGP_MIN_SLOT_READINGS);
  const medians = median.map((s) => drawValue(s.p50)!);
  return (
    <svg
      className="cgm-agp"
      viewBox="0 0 1000 256"
      role="img"
      aria-label={
        medians.length
          ? `Glucose profile by time of day. Median from ${Math.min(...medians)} to ${Math.max(...medians)} mg/dL.`
          : "Glucose profile by time of day: not enough readings yet."
      }
    >
      <rect className="agp-range" x="44" y={y(180)} width="940" height={y(70) - y(180)} />
      {[70, 180, 250, 400].map((n) => (
        <g key={n}>
          <line className="agp-grid" x1="44" x2="984" y1={y(n)} y2={y(n)} />
          <text className="agp-axis" x="38" y={y(n) + 4} textAnchor="end">
            {n}
          </text>
        </g>
      ))}
      {runs
        .filter((run) => run.length > 1)
        .map((run, i) => (
          <g key={i}>
            <polygon className="agp-outer" points={band(run, "p5", "p95")} />
            <polygon className="agp-inner" points={band(run, "p25", "p75")} />
            <polyline
              className="agp-median"
              points={run.map((s) => `${x(mid(s))},${y(drawValue(s.p50)!)}`).join(" ")}
            />
          </g>
        ))}
      {[0, 6, 12, 18, 24].map((h) => (
        <text
          key={h}
          className="agp-axis"
          x={x(h * 60)}
          y="250"
          textAnchor={h === 0 ? "start" : h === 24 ? "end" : "middle"}
        >
          {h % 24 === 0 ? "12 am" : h === 12 ? "12 pm" : h < 12 ? `${h} am` : `${h - 12} pm`}
        </text>
      ))}
    </svg>
  );
}

export default function CgmOverview({
  active,
  timezone,
  entries,
  cgm,
  planRange,
}: {
  active: boolean;
  timezone: string;
  entries: Entry[];
  cgm: CgmReading[];
  /** The care plan's own range, shown beside the standard levels when it differs. */
  planRange: { low: number; high: number } | null;
}) {
  const [days, setDays] = useState<Period>(14);
  // Re-read on mount and whenever the care log changes, so a Clarity sync shows up.
  const [clock, setClock] = useState(Date.now);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const endDay = dateKey(new Date(clock), timezone);
  const key = `${days}|${endDay}|${clock}`;
  useEffect(() => {
    const refresh = () => setClock(Date.now());
    window.addEventListener(CARE_CHANGED, refresh);
    return () => window.removeEventListener(CARE_CHANGED, refresh);
  }, []);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const startDay = addDays(endDay, 1 - days),
      previousEnd = addDays(startDay, -1);
    Promise.all([
      fetchSummary(startDay, endDay, controller.signal),
      fetchSummary(addDays(previousEnd, 1 - days), previousEnd, controller.signal),
    ])
      .then(([current, previous]) => setLoaded({ key, current, previous }))
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setLoaded({ key, error: e instanceof Error ? e.message : "CGM summary is unavailable." });
      });
    return () => controller.abort();
  }, [active, days, endDay, key]);

  const responses = useMemo(
    () => (active ? mealResponses(entries, cgm, clock) : []),
    [active, entries, cgm, clock],
  );
  const ranking = useMemo(() => foodResponseRanking(responses), [responses]);
  const recentMeals = responses.filter((r) => r.status === "ok").slice(0, 5);
  const dateTime = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    [timezone],
  );

  const current = loaded && "current" in loaded ? loaded.current : null;
  const previous = loaded && "previous" in loaded ? loaded.previous : null;
  const stale = loaded?.key !== key;
  const m = current?.metrics;
  const change =
    m?.levels && previous?.metrics.levels && previous.metrics.wearPercent >= AGP_MIN_WEAR_PERCENT
      ? Math.round((m.levels.inRange - previous.metrics.levels.inRange) * 10) / 10
      : null;
  const lows = current?.episodes.filter((e) => e.kind === "low") ?? [];
  const highs = current?.episodes.filter((e) => e.kind === "high") ?? [];
  const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <section
      className="insights-panel cgm-overview"
      aria-labelledby="cgm-overview-heading"
      aria-busy={stale}
    >
      <div className="insights-panel-title">
        <div>
          <span className="insights-eyebrow">STANDARD CGM REPORT</span>
          <h3 id="cgm-overview-heading">Time in ranges and daily profile</h3>
        </div>
        <div className="insights-period" role="group" aria-label="Report period">
          {PERIODS.map((option) => (
            <button
              type="button"
              key={option}
              className={option === days ? "active" : ""}
              aria-pressed={option === days}
              onClick={() => setDays(option)}
            >
              {option === 365 ? "1 year" : `${option} days`}
            </button>
          ))}
        </div>
      </div>
      {loaded && "error" in loaded && !stale ? (
        <p className="notice danger" role="alert">
          {loaded.error}
        </p>
      ) : !current ? (
        <p className="insights-small" role="status">
          Loading CGM summary…
        </p>
      ) : (
        <div className={`cgm-overview-body${stale ? " is-stale" : ""}`}>
          {m && m.levels ? (
            <>
              {m.wearPercent < AGP_MIN_WEAR_PERCENT && (
                <p className="insights-no-cgm" role="status">
                  The CGM recorded {m.wearPercent}% of this period. These percentages describe only
                  the recorded time, so they may not reflect the whole period.
                </p>
              )}
              <LevelsBar levels={m.levels} />
              <dl className="cgm-metrics">
                <div>
                  <dt>In range 70–180</dt>
                  <dd>{pct(m.levels.inRange)}</dd>
                  <small>
                    {change === null
                      ? "No earlier period to compare"
                      : `${change > 0 ? "+" : ""}${change} pts vs the previous ${days === 365 ? "year" : `${days} days`}`}
                  </small>
                </div>
                {m.inPlanRange !== null &&
                  planRange &&
                  (planRange.low !== 70 || planRange.high !== 180) && (
                    <div>
                      <dt>
                        In plan range {planRange.low}–{planRange.high}
                      </dt>
                      <dd>{pct(m.inPlanRange)}</dd>
                      <small>From the care plan</small>
                    </div>
                  )}
                <div>
                  <dt>Below 70</dt>
                  <dd>{pct(below70(m.levels))}</dd>
                  <small>Below 54: {pct(m.levels.veryLow)}</small>
                </div>
                <div>
                  <dt>Above 180</dt>
                  <dd>{pct(above180(m.levels))}</dd>
                  <small>Above 250: {pct(m.levels.veryHigh)}</small>
                </div>
                <div>
                  <dt>Average · GMI</dt>
                  <dd>{m.mean === null ? "—" : `${m.mean} · ${m.gmi}%`}</dd>
                  <small>
                    {m.hiddenReason === "capped"
                      ? `Hidden: ${m.cappedPercent}% of readings were past the sensor's limit, so an average would read low`
                      : m.hiddenReason === "no-readings"
                        ? "No numeric readings"
                        : `CV ${m.cv}% · SD ${m.sd} mg/dL`}
                  </small>
                </div>
                <div>
                  <dt>CGM wear</dt>
                  <dd>{pct(m.wearPercent)}</dd>
                  <small>
                    {m.readings.toLocaleString("en-US")} readings over {m.days} days
                  </small>
                </div>
              </dl>
            </>
          ) : (
            <p className="insights-no-cgm" role="status">
              No CGM readings in this period.
            </p>
          )}
          <div className="cgm-overview-section">
            <h4>Daily profile</h4>
            <p className="insights-small">
              Every day in the period laid over one 24-hour clock. The line is the median; the inner
              band holds half the readings and the outer band 90%.
              {current.metrics.agpReady
                ? ""
                : ` This is a preview: a standard profile needs ${AGP_MIN_DAYS} days with ${AGP_MIN_WEAR_PERCENT}% wear.`}
            </p>
            <AgpChart slots={current.agp} />
          </div>
          <div className="cgm-overview-grid">
            <div className="cgm-overview-section">
              <h4>Lows and highs</h4>
              <p className="insights-small">
                Counted when glucose stays past 70 or 180 for at least 15 minutes, until 15 minutes
                back.
              </p>
              <dl className="cgm-episode-counts">
                <div>
                  <dt>Lows</dt>
                  <dd>{lows.length}</dd>
                  <small>{lows.filter((e) => e.severe).length} below 54</small>
                </div>
                <div>
                  <dt>Highs</dt>
                  <dd>{highs.length}</dd>
                  <small>{highs.filter((e) => e.severe).length} above 250</small>
                </div>
              </dl>
              {lows.length > 0 && (
                <ul className="cgm-episode-list">
                  {lows
                    .slice(-5)
                    .reverse()
                    .map((e) => (
                      <li key={e.start}>
                        <span>{dateTime.format(new Date(e.start))}</span>
                        <span>
                          {e.minutes} min · lowest {e.extreme === "Low" ? "LOW" : e.extreme}
                          {e.recovered ? "" : " · data ends"}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </div>
            <div className="cgm-overview-section">
              <h4>By day of the week</h4>
              <ul className="cgm-weekdays">
                {current.weekdays.map((w) => (
                  <li key={w.weekday}>
                    <span>{weekdayNames[w.weekday]}</span>
                    <div className="cgm-levels-track" aria-hidden="true">
                      {w.levels &&
                        GLUCOSE_LEVELS.map((level) => (
                          <span
                            key={level}
                            className={`level-${level}`}
                            style={{ flexGrow: w.levels![level] }}
                          />
                        ))}
                    </div>
                    <strong>{w.levels ? pct(w.levels.inRange) : "—"}</strong>
                  </li>
                ))}
              </ul>
              <p className="insights-small">Share of time from 70 to 180 on each weekday.</p>
            </div>
          </div>
          <div className="cgm-overview-section">
            <h4>After meals</h4>
            <p className="insights-small">
              How glucose moved in the three hours after logged meals, from the CGM reading at the
              meal. Only meals with good sensor coverage and no other food nearby are compared. What
              happened, not what to eat or dose.
            </p>
            {ranking.length > 0 ? (
              <ol className="cgm-food-ranking">
                {ranking.slice(0, 8).map((food) => (
                  <li key={food.name}>
                    <span>{food.name}</span>
                    <span>
                      {food.riseCapped ? "at least " : ""}+{food.medianRise} mg/dL · peak ~
                      {food.medianPeakMinutes} min · {food.meals} meals
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="insights-small">
                A food appears here once it is part of {MIN_MEALS_FOR_RANKING} comparable meals.
              </p>
            )}
            {recentMeals.length > 0 && (
              <ul className="cgm-meal-list">
                {recentMeals.map((r) => (
                  <li key={r.entryId}>
                    <span>
                      {dateTime.format(new Date(r.at))} · {r.carbs} g
                      {r.foods.length ? ` · ${r.foods.join(", ")}` : ""}
                    </span>
                    <span>
                      {r.baseline} → {r.peak === "High" ? "HIGH" : r.peak} (
                      {r.riseCapped ? "at least " : ""}
                      {r.rise! >= 0 ? "+" : ""}
                      {r.rise}) at {r.peakMinutes} min
                      {r.returnMinutes !== null
                        ? ` · back near start at ${r.returnMinutes} min`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="insights-method">
            <Activity size={15} aria-hidden="true" /> Standard CGM ranges (54, 70, 180, 250 mg/dL).
            Readings past the sensor’s limit count toward the lowest or highest range; averages are
            hidden when more than {CAPPED_LIMIT_PERCENT}% of readings are past it. Descriptive only.
          </p>
        </div>
      )}
    </section>
  );
}
