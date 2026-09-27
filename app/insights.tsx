"use client";

import { apiFetch } from "@/lib/person-request";
import { CARE_CHANGED } from "@/lib/live-refresh";
import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Activity, BarChart3, Clock3, Utensils } from "lucide-react";
import type { CgmReading, Entry, Plan } from "@/lib/care";
import { fromLocal, glucoseRanges } from "@/lib/care";
import { computeInsights, type InsightsSummary } from "@/lib/insights";
import { illnessOverlap, illnessLabel, isSick, type IllnessWindow } from "@/lib/illness";
import { buildPatternFlags, patternFlagLabel, type PatternFlag } from "@/lib/patterns";
import CgmOverview from "./cgm-overview";

type Period = 7 | 14 | 30;
type Props = {
  active: boolean;
  entries: Entry[];
  cgm: CgmReading[];
  timezone: string;
  patientName?: string;
  illnesses?: IllnessWindow[];
  plan: Pick<Plan, "glucoseRanges" | "lowThreshold" | "patternRule">;
};

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
});
const shortDayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "numeric",
  day: "numeric",
});
const hours = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10} hr`;
const percent = (value: number | null) => (value === null ? "—" : `${value}%`);
const dayLabel = (day: string, short = false) =>
  (short ? shortDayFormatter : dayFormatter).format(new Date(`${day}T12:00:00Z`));

function TrendPlot({ insights }: { insights: InsightsSummary }) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const viewport = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (viewport.current) viewport.current.scrollLeft = viewport.current.scrollWidth;
  }, [insights.period.days]);
  const selected = insights.daily.find((item) => item.day === selectedDay) ?? insights.daily.at(-1);
  const step = insights.period.days === 30 ? 5 : insights.period.days === 14 ? 2 : 1;
  function move(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End")
      return;
    e.preventDefault();
    const target =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? insights.daily.length - 1
          : Math.min(
              insights.daily.length - 1,
              Math.max(0, index + (e.key === "ArrowLeft" ? -1 : 1)),
            );
    setSelectedDay(insights.daily[target].day);
    buttons.current[target]?.focus();
  }
  return (
    <section className="insights-panel insights-trend" aria-labelledby="insights-trend-heading">
      <div className="insights-panel-title">
        <div>
          <span className="insights-eyebrow">DAY BY DAY</span>
          <h3 id="insights-trend-heading">Glucose & coverage</h3>
        </div>
        <span className="insights-legend">
          <i className="in-range" />
          In range <i className="coverage" />
          CGM coverage
        </span>
      </div>
      <p className="insights-small">
        70–180 mg/dL is shown only where enough CGM time was recorded. Select a day for its details.
      </p>
      <div
        className="insights-chart"
        role="group"
        aria-label="Day-by-day time in range and CGM coverage; use left and right arrow keys to inspect days"
      >
        <div className="insights-chart-ticks" aria-hidden="true">
          <span>100%</span>
          <span>50%</span>
          <span>0%</span>
        </div>
        <div className="insights-chart-viewport" ref={viewport}>
          <div
            className="insights-chart-days"
            style={{
              gridTemplateColumns: `repeat(${insights.daily.length},minmax(28px,1fr))`,
              minWidth: `max(100%, ${insights.daily.length * 28}px)`,
            }}
          >
            {insights.daily.map((item, index) => (
              <button
                key={item.day}
                type="button"
                ref={(el) => {
                  buttons.current[index] = el;
                }}
                className={`insights-chart-day${selected?.day === item.day ? " selected" : ""}`}
                tabIndex={selected?.day === item.day ? 0 : -1}
                aria-pressed={selected?.day === item.day}
                aria-label={`${dayLabel(item.day)}: ${item.inRangePercent === null ? "insufficient CGM coverage for time in range" : `${item.inRangePercent}% of observed time in range`}; ${item.coveragePercent}% CGM coverage; ${Math.round(item.carbs)} grams carbohydrates, ${item.rapidUnits} units Rapid-acting, ${item.basalUnits} units Long-acting logged`}
                aria-controls="insights-selected-day"
                onMouseEnter={() => setSelectedDay(item.day)}
                onFocus={() => setSelectedDay(item.day)}
                onClick={() => setSelectedDay(item.day)}
                onKeyDown={(event) => move(event, index)}
              >
                <span className="insights-bars" aria-hidden="true">
                  <span
                    className="insights-bar-coverage"
                    style={{ height: `${item.coveragePercent}%` }}
                  />
                  <span
                    className={`insights-bar-range${item.inRangePercent === null ? " unavailable" : ""}`}
                    style={{
                      height: item.inRangePercent === null ? "4px" : `${item.inRangePercent}%`,
                    }}
                  />
                </span>
                <span className="insights-event-strip" aria-hidden="true">
                  {item.carbs > 0 && <i className="food" />}
                  {item.rapidUnits > 0 && <i className="rapid" />}
                  {item.basalUnits > 0 && <i className="basal" />}
                </span>
                <span className="insights-day-label" aria-hidden="true">
                  {index % step === 0 || index === insights.daily.length - 1
                    ? dayLabel(item.day, true)
                    : "\u00a0"}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="insights-event-legend" aria-label="Logged events on the chart">
        <span>
          <i className="food" />
          Food
        </span>
        <span>
          <i className="rapid" />
          Rapid-acting
        </span>
        <span>
          <i className="basal" />
          Long-acting
        </span>
      </div>
      {selected && (
        <div id="insights-selected-day" className="insights-selected-day">
          <strong>
            {dayLabel(selected.day)}
            {selected.day === insights.period.endDay ? " · to now" : ""}
          </strong>
          <span>
            CGM coverage <b>{selected.coveragePercent}%</b> · {hours(selected.observedMinutes)}{" "}
            observed
          </span>
          <span>
            In range <b>{percent(selected.inRangePercent)}</b>
            {selected.inRangePercent === null ? " · too little recorded time" : ""}
          </span>
          <span>
            Carbs {Math.round(selected.carbs)} g
            {selected.lowTreatmentCarbs > 0
              ? ` (including ${Math.round(selected.lowTreatmentCarbs)} g low treatment)`
              : ""}{" "}
            · Rapid-acting {selected.rapidUnits} u · Long-acting {selected.basalUnits} u
          </span>
        </div>
      )}
    </section>
  );
}

function TimeOfDay({ insights }: { insights: InsightsSummary }) {
  return (
    <section className="insights-panel insights-times" aria-labelledby="insights-times-heading">
      <div className="insights-panel-title">
        <div>
          <span className="insights-eyebrow">WHEN IT HAPPENS</span>
          <h3 id="insights-times-heading">Time of day</h3>
        </div>
        <Clock3 size={20} aria-hidden="true" />
      </div>
      <div className="insights-time-legend" aria-hidden="true">
        <span>
          <i className="low" />
          Below 70
        </span>
        <span>
          <i className="range" />
          70–180
        </span>
        <span>
          <i className="high" />
          Above 180
        </span>
      </div>
      <div className="insights-time-rows">
        {insights.timeOfDay.map((slot) => (
          <div className="insights-time-row" key={slot.label}>
            <span className="insights-time-name">{slot.label}</span>
            <div
              className={`insights-time-track${slot.inRangePercent === null ? " no-data" : ""}`}
              role="img"
              aria-label={`${slot.label}: ${slot.inRangePercent === null ? "insufficient CGM coverage for glucose percentages" : `${slot.below70Percent}% below 70, ${slot.inRangePercent}% from 70 to 180, ${slot.above180Percent}% above 180`}; ${slot.coveragePercent}% CGM coverage`}
            >
              <span
                className="insights-time-low"
                style={{ width: `${slot.below70Percent ?? 0}%` }}
              />
              <span
                className="insights-time-in-range"
                style={{ width: `${slot.inRangePercent ?? 0}%` }}
              />
              <span
                className="insights-time-high"
                style={{ width: `${slot.above180Percent ?? 0}%` }}
              />
            </div>
            <strong>{percent(slot.inRangePercent)}</strong>
            <small>{slot.coveragePercent}% covered</small>
          </div>
        ))}
      </div>
      <p className="insights-small">Glucose is grouped by local clock time, not by meal labels.</p>
    </section>
  );
}

function FoodRankings({ insights }: { insights: InsightsSummary }) {
  const columns = [
    { title: "All foods", items: insights.topFoods },
    { title: "Snacks only", items: insights.topSnacks },
  ];
  return (
    <section className="insights-panel insights-foods" aria-labelledby="insights-foods-heading">
      <div className="insights-panel-title">
        <div>
          <span className="insights-eyebrow">WHAT GETS LOGGED</span>
          <h3 id="insights-foods-heading">Most logged foods</h3>
        </div>
        <Utensils size={20} aria-hidden="true" />
      </div>
      <div className="insights-food-columns">
        {columns.map((column) => (
          <div key={column.title}>
            <h4>{column.title}</h4>
            {column.items.length ? (
              <ol>
                {column.items.slice(0, 4).map((food) => (
                  <li key={food.name}>
                    <span title={food.name}>{food.name}</span>
                    <strong>{food.count}×</strong>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="insights-no-food">No identifiable foods logged here yet.</p>
            )}
          </div>
        ))}
      </div>
      <p className="insights-small">
        From itemized food logs; {insights.foodIdentification.inferredEntries} older{" "}
        {insights.foodIdentification.inferredEntries === 1 ? "entry was" : "entries were"} inferred
        from recognizable notes.{" "}
        {insights.foodIdentification.totalFoodEntries > 0
          ? `${insights.foodIdentification.unidentifiedEntries} of ${insights.foodIdentification.totalFoodEntries} food entries had no identifiable name.`
          : "No food entries are logged in this period."}
      </p>
    </section>
  );
}

function Insights({ active, entries, cgm, timezone, patientName, illnesses = [], plan }: Props) {
  const [days, setDays] = useState<Period>(14);
  const [clock, setClock] = useState(() => Date.now());
  const [history, setHistory] = useState<{ cgm: CgmReading[]; limited: boolean } | null>(null);
  const [historyStatus, setHistoryStatus] = useState<"idle" | "loading" | "loaded" | "error">(
    "idle",
  );
  const historyController = useRef<AbortController | null>(null),
    historyEtag = useRef<string | null>(null);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [active]);
  useEffect(
    () => () => {
      historyController.current?.abort();
    },
    [],
  );
  async function loadHistory(fresh = false) {
    if (historyController.current) {
      if (!fresh) return;
      historyController.current.abort();
    }
    const controller = new AbortController();
    historyController.current = controller;
    setHistoryStatus("loading");
    try {
      const response = await apiFetch("/api/care?scope=insights", {
        cache: "no-store",
        signal: controller.signal,
        headers: historyEtag.current ? { "If-None-Match": historyEtag.current } : {},
      });
      if (historyController.current !== controller) return;
      if (response.status === 304) {
        setHistoryStatus("loaded");
        return;
      }
      if (!response.ok) throw new Error("Could not load CGM history.");
      const data = (await response.json()) as { cgm?: CgmReading[]; limited?: boolean };
      if (!Array.isArray(data.cgm)) throw new Error("CGM history is unavailable.");
      if (historyController.current !== controller) return;
      historyEtag.current = response.headers.get("ETag");
      setHistory({ cgm: data.cgm, limited: !!data.limited });
      setHistoryStatus("loaded");
    } catch {
      if (!controller.signal.aborted) setHistoryStatus("error");
    } finally {
      if (historyController.current === controller) historyController.current = null;
    }
  }
  function selectPeriod(option: Period) {
    setDays(option);
    if (option === 30 && (historyStatus === "idle" || historyStatus === "error"))
      void loadHistory();
  }
  // Refresh extended history after new imports while preserving the selected period.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!active || days !== 30) return;
    const refresh = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void loadHistory(true);
    };
    const channel =
      typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CARE_CHANGED);
    if (channel) channel.onmessage = refresh;
    refresh();
    const timer = setInterval(refresh, 60_000);
    window.addEventListener(CARE_CHANGED, refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      channel?.close();
      window.removeEventListener(CARE_CHANGED, refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
      historyController.current?.abort();
      historyController.current = null;
    };
  }, [active, days, cgm]);
  const analysisCgm = useMemo(() => {
    if (days !== 30 || !history) return cgm;
    const currentTimes = new Set(cgm.map((point) => point.at));
    return [...history.cgm.filter((point) => !currentTimes.has(point.at)), ...cgm];
  }, [days, cgm, history]);
  const insights = useMemo(
    () => (active ? computeInsights(days, entries, analysisCgm, timezone, new Date(clock)) : null),
    [active, days, entries, analysisCgm, timezone, clock],
  );
  const periodStartAt = insights
    ? Date.parse(fromLocal(`${insights.period.startDay}T00:00`, timezone))
    : 0;
  const overlappingIllnesses = useMemo(
    () =>
      insights
        ? illnesses.filter(
            (illness) => isSick(illness) && illnessOverlap(illness, periodStartAt, clock, clock),
          )
        : [],
    [illnesses, insights, periodStartAt, clock],
  );
  const sickDayCount = useMemo(() => {
    if (!insights) return 0;
    let count = 0;
    for (const day of insights.daily) {
      const dayStart = Date.parse(fromLocal(`${day.day}T00:00`, timezone));
      const nextDayStart = dayStart + 86_400_000;
      if (
        illnesses.some(
          (illness) =>
            isSick(illness) &&
            illnessOverlap(illness, dayStart, Math.min(nextDayStart, clock), clock),
        )
      )
        count++;
    }
    return count;
  }, [illnesses, insights, timezone, clock]);
  const patternLookbackDays = 14;
  const patterns = useMemo(
    () =>
      active
        ? buildPatternFlags({
            cgm: analysisCgm,
            entries,
            timezone,
            illnesses,
            now: clock,
            lookbackDays: patternLookbackDays,
            plan,
          })
        : null,
    [active, analysisCgm, entries, timezone, illnesses, clock, plan],
  );
  const historyPending =
    days === 30 && !history && (historyStatus === "idle" || historyStatus === "loading");
  const historyIncomplete =
    days === 30 &&
    (historyStatus === "error" || (historyStatus === "loaded" && !!history?.limited));
  return (
    <section className="insights-page" aria-labelledby="insights-page-heading">
      <header className="insights-header care-page-heading">
        <div>
          <span className="insights-eyebrow">
            <BarChart3 size={15} aria-hidden="true" /> RECORDED PATTERNS
          </span>
          <h1 id="insights-page-heading">
            {patientName ? `${patientName}'s insights` : "Insights"}
          </h1>
          <p>Glucose, food and insulin from the care log and imported CGM.</p>
        </div>
        <div className="insights-period" role="group" aria-label="Time period">
          {([7, 14, 30] as const).map((option) => (
            <button
              type="button"
              key={option}
              className={option === days ? "active" : ""}
              aria-pressed={option === days}
              onClick={() => selectPeriod(option)}
            >
              {option} days
            </button>
          ))}
        </div>
      </header>
      {insights && (
        <div className="insights-content">
          <div className="insights-dates">
            {dayLabel(insights.period.startDay)} – {dayLabel(insights.period.endDay)}{" "}
            <span>· {timezone.replaceAll("_", " ")}</span>
          </div>
          {(sickDayCount > 0 || overlappingIllnesses.length > 0) && (
            <p className="insights-illness-note" role="status">
              {sickDayCount > 0 && (
                <span>
                  <strong>{sickDayCount}</strong> of {insights.daily.length}{" "}
                  {insights.daily.length === 1 ? "day" : "days"} in this period{" "}
                  {sickDayCount === 1 ? "was a sick day" : "were sick days"}.
                </span>
              )}
              {overlappingIllnesses.map((illness) => (
                <span key={illness.id} className="insights-illness-chip">
                  {illnessLabel(illness, timezone)}
                </span>
              ))}
            </p>
          )}
          {patterns && (
            <section
              className="insights-panel insights-patterns"
              aria-labelledby="insights-patterns-heading"
            >
              <div className="insights-panel-title">
                <div>
                  <span className="insights-eyebrow">WORTH A LOOK</span>
                  <h3 id="insights-patterns-heading">Patterns to review</h3>
                </div>
              </div>
              {patterns.length > 0 ? (
                <ul className="insights-pattern-list">
                  {patterns.map((flag: PatternFlag) => (
                    <li
                      key={`${flag.kind}-${flag.slot}-${flag.days[0]}`}
                      className={`insights-pattern-flag pattern-${flag.kind}`}
                    >
                      {patternFlagLabel(flag)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="insights-small">
                  No repeating low or high pattern in the last {patternLookbackDays} days.
                </p>
              )}
              <p className="insights-small">
                Descriptive only; not dosing guidance. Review with your care team.
              </p>
            </section>
          )}
          <CgmOverview
            active={active}
            timezone={timezone}
            entries={entries}
            cgm={cgm}
            planRange={
              glucoseRanges(plan).standard
                ? null
                : { low: glucoseRanges(plan).low, high: glucoseRanges(plan).high }
            }
          />
          <div className="insights-stats" aria-label="Period summary">
            <div className="insights-main-stat">
              <span>Observed time in range</span>
              <strong>{percent(insights.glucose.inRangePercent)}</strong>
              <small>
                70–180 mg/dL ·{" "}
                {insights.glucose.inRangePercent === null
                  ? "not enough CGM coverage"
                  : `${hours(insights.coverage.observedMinutes)} of CGM time`}
                {days === 7 ? " · short window" : ""}
              </small>
            </div>
            <div>
              <span>CGM coverage</span>
              <strong>{insights.coverage.percent}%</strong>
              <small>
                {hours(insights.coverage.observedMinutes)} of{" "}
                {hours(insights.coverage.possibleMinutes)} · {insights.coverage.uniqueReadings}{" "}
                readings
              </small>
            </div>
            <div>
              <span>Complete-day change</span>
              <strong>
                {!historyPending &&
                !historyIncomplete &&
                insights.trend.comparable &&
                insights.trend.deltaInRangePoints !== null
                  ? `${insights.trend.deltaInRangePoints > 0 ? "+" : ""}${insights.trend.deltaInRangePoints} pts`
                  : "—"}
              </strong>
              <small>
                {historyPending ? (
                  "Loading previous 30 days of CGM history…"
                ) : historyIncomplete ? (
                  historyStatus === "error" ? (
                    <>
                      Could not load full history.{" "}
                      <button
                        type="button"
                        className="insights-retry"
                        onClick={() => void loadHistory()}
                      >
                        Retry
                      </button>
                    </>
                  ) : (
                    "CGM history was truncated; comparison unavailable."
                  )
                ) : insights.trend.comparable ? (
                  `Last ${days} completed days vs the prior ${days}; excludes today`
                ) : (
                  insights.trend.reason
                )}
              </small>
            </div>
          </div>
          {insights.coverage.uniqueReadings === 0 && (
            <p className="insights-no-cgm" role="status">
              No CGM readings in this period. Logged foods and insulin can still appear below.
            </p>
          )}
          {days === 30 && history?.limited && (
            <p className="insights-no-cgm" role="status">
              CGM history was truncated. Older days in this chart may be incomplete.
            </p>
          )}
          <div className="insights-body-grid">
            <TrendPlot key={days} insights={insights} />
            <TimeOfDay insights={insights} />
            <FoodRankings insights={insights} />
          </div>
          <p className="insights-method">
            <Activity size={15} aria-hidden="true" /> Deduplicated Dexcom Share and Clarity readings
            contribute observed CGM time; finger-sticks do not enter these percentages. Gaps remain
            missing. Comparisons require enough coverage in both periods. The 7-day view is a short
            window. This view gives no dose guidance; use the primary device for current readings.
          </p>
        </div>
      )}
    </section>
  );
}
// Mounted in a hidden tab; skip re-renders from unrelated dashboard state such as typing in forms.
export default memo(Insights);
