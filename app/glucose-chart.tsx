"use client";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import {
  Thermometer,
  Activity,
  Utensils,
  Syringe,
  Siren,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  type LucideIcon,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { dodgeLane } from "@/lib/chart-lanes";
import { mergeReadings } from "@/lib/chart-readout";
import { useEasedSpan } from "@/hooks/use-eased-span";
import { ChartLegend, type ChartLayer } from "./chart-legend";
import { mealLinks, mealDoseFoods } from "@/lib/meal-log";
import {
  illnessOverlap,
  illnessLabel,
  periodKind,
  periodKindLabels,
  type IllnessWindow,
} from "@/lib/illness";
import {
  chartDaysWindow,
  chartRangeDays,
  chartZoom,
  zoomAround,
  timeLabelCount,
  TIME_LABEL_PX,
  type ChartRange,
  type ChartZoom,
} from "@/lib/chart-window";
import { uniqueCgm } from "@/lib/cgm-metrics";
import { inQuietHours, isCorrectionDose } from "@/lib/correction-review";
import { nightlySchedule } from "@/lib/nightly-reminder";
import { glucoseLevel, glucoseLevelNames } from "@/lib/glucose-metrics";
import { estimateLabel, type GlucoseEstimate } from "@/lib/glucose-estimate";
import { usualFastestFall, type DoseTiming } from "@/lib/dose-response";
import {
  formatGlucose,
  glucoseToMgdl,
  glucoseToUnit,
  glucoseUnitOf,
  glucoseWithUnit,
  type GlucoseUnit,
} from "@/lib/glucose-units";
import {
  glucoseRanges,
  dateKey,
  entryGlucoseLabel,
  type CgmReading,
  type DexcomEvent,
  type Entry,
  type Plan,
} from "@/lib/care";
import "./glucose-chart.css";

type Props = {
  illnesses?: IllnessWindow[];
  now: number;
  /** Next correction review to mark; the caller leaves out one in the plan's quiet hours. */
  correctionAt?: string | null;
  /** Plan's correction review interval; each correction dose or skipped correction gets a faint review line at its time + interval. */
  correctionHours?: number;
  onSelectIllness?: (illness: IllnessWindow) => void;
  entries: Entry[];
  cgm: CgmReading[];
  dexcomEvents: DexcomEvent[];
  timezone: string;
  day: string;
  today: string;
  onSelectEntry?: (entry: Entry) => void;
  onSelectDoseFood?: (dose: Entry) => void;
  /** `null` keeps the responsive default: Day on wide screens, 12h on narrow ones. */
  range: ChartRange | null;
  onRangeChange: (range: ChartRange) => void;
  /** Earliest instant the loaded CGM history covers. Older periods get a limitation note. */
  cgmHistoryStart?: number | null;
  cgmHistoryCapped?: boolean;
  /** Review times inside `correctionQuietHours` are left off; `basal` at `basalTime` draws a nightly line. */
  plan: Pick<
    Plan,
    "glucoseRanges" | "glucoseUnit" | "meter" | "basal" | "basalTime" | "correctionQuietHours"
  >;
  /** The next two hours' likely range from CGM history; drawn ahead of now. */
  estimate?: GlucoseEstimate | null;
  /** Rapid-acting timing from earlier clean doses; each rapid-acting dose gets its usual fastest fall. */
  rapidTiming?: DoseTiming | null;
};
type ChartRecord = { at: string; type: string; detail: string; source: string; timeNote?: string };
type StatusRun = { first: CgmReading; last: CgmReading; status: "High" | "Low"; count: number };
type Reading = {
  at: string;
  t: number;
  value: number | null;
  status: CgmReading["status"];
  source: string;
};
const LEFT = 42,
  TOP = 40,
  BOTTOM = 190,
  /** The time axis line; its labels sit just under it and the event lanes below those. */
  AXIS_Y = 202,
  AXIS_LABEL_Y = 220,
  LANES_TOP = 232,
  LANE_H = 26,
  /** Lane icons closer than this are spread apart; a tick keeps each one's true time. */
  LANE_GAP = 19,
  RECORD_PAGE = 250,
  /** How far a mouse or pen press must move before it selects a stretch to zoom into. */
  DRAG_PIXELS = 6,
  /** A period's flag starts at least this far from the plot's right edge, so its name fits. */
  TAG_ROOM = 132;
const RANGE_OPTIONS: { value: ChartRange; label: string; title: string }[] = [
  { value: "day", label: "Day", title: "Selected day" },
  { value: "12h", label: "12h", title: "12 hours of the selected day" },
  { value: "6h", label: "6h", title: "6 hours of the selected day" },
  { value: "3d", label: "3d", title: "3 days ending on the selected day" },
  { value: "7d", label: "7d", title: "7 days ending on the selected day" },
  { value: "14d", label: "14d", title: "14 days ending on the selected day" },
  { value: "30d", label: "30d", title: "30 days ending on the selected day" },
];
const RANGE_HOURS: Partial<Record<ChartRange, 12 | 6>> = { "12h": 12, "6h": 6 };
const timeFormatters = new Map<string, Intl.DateTimeFormat>(),
  dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
function formatter(
  cache: Map<string, Intl.DateTimeFormat>,
  timezone: string,
  create: () => Intl.DateTimeFormat,
) {
  let value = cache.get(timezone);
  if (!value) {
    value = create();
    cache.set(timezone, value);
  }
  return value;
}
const eventTime = (at: string, tz: string) =>
  formatter(
    timeFormatters,
    tz,
    () => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }),
  ).format(new Date(at));
const eventDateTime = (at: string, tz: string) =>
  formatter(
    dateTimeFormatters,
    tz,
    () =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
  ).format(new Date(at));
const stamp = (at: string, tz: string, withDate: boolean) =>
  withDate ? eventDateTime(at, tz) : eventTime(at, tz);
// Calendar keys are formatted at UTC noon so the label never drifts to a neighbouring date.
const calendarDay = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
});
const calendarRange = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
});
const noonUtc = (day: string) => new Date(`${day}T12:00:00Z`);
function behindLabel(minutes: number) {
  if (minutes < 60) return `${minutes} min behind`;
  const hours = Math.floor(minutes / 60),
    rest = minutes % 60;
  return `${hours} hr${rest ? ` ${rest} min` : ""} behind`;
}
function within<T extends { at: string }>(items: T[], from: number, to: number, limit: number) {
  return items.filter((item) => {
    const t = Date.parse(item.at);
    return t >= from && t <= to && t < limit;
  });
}
/** Index of the last point at or before `t` in a chronologically sorted list, or -1. */
function lastAtOrBefore(points: { at: string }[], t: number) {
  let low = 0,
    high = points.length - 1,
    found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (Date.parse(points[middle].at) <= t) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}
function nearestReading(readings: Reading[], t: number) {
  let low = 0,
    high = readings.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (readings[middle].t < t) low = middle + 1;
    else high = middle;
  }
  if (low >= readings.length) return readings.length - 1;
  if (low > 0 && t - readings[low - 1].t <= readings[low].t - t) return low - 1;
  return low;
}

const RecordsTable = memo(function RecordsTable({
  records,
  timezone,
  withDate,
}: {
  records: ChartRecord[];
  timezone: string;
  withDate: boolean;
}) {
  const [open, setOpen] = useState(false),
    [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(records.length / RECORD_PAGE)),
    current = Math.min(page, pages - 1),
    first = current * RECORD_PAGE,
    rows = open ? records.slice(first, first + RECORD_PAGE) : [];
  return (
    <details
      className="glucose-chart-details"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>View plotted records ({records.length.toLocaleString("en-US")})</summary>
      {open && pages > 1 && (
        <div className="glucose-chart-details-pages" role="group" aria-label="Plotted record pages">
          <button type="button" disabled={current === 0} onClick={() => setPage(0)}>
            Oldest
          </button>
          <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>
            Earlier
          </button>
          <span aria-live="polite">
            Rows {(first + 1).toLocaleString("en-US")}–
            {(first + rows.length).toLocaleString("en-US")} of{" "}
            {records.length.toLocaleString("en-US")}
          </span>
          <button
            type="button"
            disabled={current >= pages - 1}
            onClick={() => setPage(current + 1)}
          >
            Later
          </button>
          <button type="button" disabled={current >= pages - 1} onClick={() => setPage(pages - 1)}>
            Newest
          </button>
        </div>
      )}
      {open && (
        <div className="glucose-chart-details-scroll" key={current}>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Record</th>
                <th>Value or event</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((record, i) => (
                <tr key={`${record.at}-${record.type}-${first + i}`}>
                  <td>
                    {stamp(record.at, timezone, withDate)}
                    {record.timeNote ? ` · ${record.timeNote}` : ""}
                  </td>
                  <td>{record.type}</td>
                  <td>{record.detail}</td>
                  <td>{record.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
});

/** Sensor line, point marks and HIGH/LOW runs. Memoized so the cursor never rebuilds long paths. */
const SensorLayer = memo(function SensorLayer({
  points,
  runs,
  origin,
  start,
  duration,
  right,
  max,
  dense,
  timezone,
  unit,
}: {
  points: CgmReading[];
  runs: StatusRun[];
  origin: number;
  start: number;
  duration: number;
  right: number;
  max: number;
  dense: boolean;
  timezone: string;
  unit: GlucoseUnit;
}) {
  const x = (at: string) =>
    LEFT + (((Date.parse(at) - origin) / 60000 - start) / duration) * (right - LEFT);
  const y = (value: number) => BOTTOM - (value / max) * (BOTTOM - TOP);
  // A missing value or a gap over ten minutes ends the line; nothing is interpolated or thinned.
  const groups: CgmReading[][] = [];
  let segment: CgmReading[] = [];
  for (const point of points) {
    const previous = segment.at(-1);
    if (
      point.value === null ||
      (previous && Date.parse(point.at) - Date.parse(previous.at) > 10 * 60000)
    ) {
      if (segment.length) groups.push(segment);
      segment = [];
    }
    if (point.value !== null) segment.push(point);
  }
  if (segment.length) groups.push(segment);
  const paths = groups
    .filter((group) => group.length > 1)
    .map((group) =>
      group
        .map((r, i) => `${i ? "L" : "M"}${x(r.at).toFixed(1)},${y(r.value!).toFixed(1)}`)
        .join(" "),
    );
  // Dense periods draw every reading in the path; only readings with no neighbour need a dot.
  const marks = dense
    ? groups.filter((group) => group.length === 1).map((group) => group[0])
    : points.filter((p) => p.value !== null);
  return (
    <>
      <g data-layer="cgm">
        {paths.map((path, i) => (
          <path
            key={i}
            d={path}
            stroke="var(--chart-sensor)"
            strokeWidth={dense ? 1.8 : 2.6}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {marks.map((p) => (
          <circle
            key={p.at}
            cx={x(p.at)}
            cy={y(p.value!)}
            r={dense ? 2.2 : 1.7}
            fill="var(--chart-sensor)"
          >
            <title>
              {stamp(p.at, timezone, dense)} · {glucoseWithUnit(p.value!, unit)} · {p.source}
            </title>
          </circle>
        ))}
      </g>
      {/* The bar alone marks a HIGH or LOW stretch; the key and its title name it, so no label
       * competes with nearby readings. */}
      <g data-layer="status">
        {runs.some((run) => run.status === "High") && (
          <line
            x1={LEFT}
            x2={right}
            y1={y(400)}
            y2={y(400)}
            stroke="var(--chart-alert-high)"
            opacity=".35"
            strokeDasharray="3 6"
          />
        )}
        {runs.map((run) => {
          const left = x(run.first.at),
            width = Math.max(4, x(run.last.at) - left + 4),
            top = run.status === "High" ? y(400) - 4 : y(40) - 2;
          return (
            <g key={run.first.at}>
              <rect
                x={left - 2}
                y={top}
                width={width}
                height="7"
                rx="3"
                fill={run.status === "High" ? "var(--chart-alert-high)" : "var(--chart-alert-low)"}
              />
              <title>
                {stamp(run.first.at, timezone, dense)}
                {run.count > 1 ? `–${stamp(run.last.at, timezone, dense)}` : ""} · Dexcom{" "}
                {run.status.toUpperCase()}{" "}
                {run.status === "High"
                  ? `(above ${glucoseWithUnit(400, unit)})`
                  : `(below ${glucoseWithUnit(40, unit)})`}
                , exact value unknown; {run.count} readings
              </title>
            </g>
          );
        })}
      </g>
    </>
  );
});

/** Current-time dot on the glucose line: its own tiny layer so a 30s clock tick never touches SensorLayer's paths. */
const NowLayer = memo(function NowLayer({
  nowX,
  lastX,
  lastY,
  stale,
  behindText,
}: {
  nowX: number;
  lastX: number | null;
  lastY: number | null;
  stale: boolean;
  behindText: string | null;
}) {
  // Sits where the next reading would land, so the dashed gap shows how far the data lags.
  const dotY = lastY ?? BOTTOM;
  return (
    <g className="chart-now-marker" pointerEvents="none" aria-hidden="true">
      {stale && lastX !== null && lastY !== null && (
        <line x1={lastX} x2={nowX} y1={lastY} y2={lastY} className="chart-now-gap" />
      )}
      {stale && <circle cx={nowX} cy={dotY} r="5" className="chart-now-ring chart-now-pulsing" />}
      <circle
        cx={nowX}
        cy={dotY}
        r="3"
        className={stale ? "chart-now-dot" : "chart-now-dot chart-now-dot-faded"}
      >
        <title>Now{behindText ? ` · latest CGM reading is ${behindText}` : ""}</title>
      </circle>
    </g>
  );
});

/** Fits the shared pill over the selected range button; `animate` lets it spring there. */
function fitRangePill(group: HTMLElement, pill: HTMLElement, animate: boolean) {
  const selected = group.querySelector<HTMLElement>('button[aria-pressed="true"]');
  if (!selected) return;
  if (!animate) pill.style.transition = "none";
  pill.style.translate = `${selected.offsetLeft}px ${selected.offsetTop}px`;
  pill.style.width = `${selected.offsetWidth}px`;
  pill.style.height = `${selected.offsetHeight}px`;
  if (!animate) {
    // Commit the jump before the transition comes back, so a reflow never slides.
    pill.getBoundingClientRect();
    pill.style.transition = "";
  }
  group.dataset.pill = "ready";
}

/**
 * The range buttons share one selected pill that springs to each new choice. Until it has been
 * measured, and without script, the selected button keeps its own fill.
 */
function RangeSwitch({
  active,
  onPick,
}: {
  active: ChartRange;
  onPick: (range: ChartRange) => void;
}) {
  const group = useRef<HTMLDivElement>(null),
    pill = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const element = group.current,
      marker = pill.current;
    if (!element || !marker) return;
    const observer = new ResizeObserver(() => fitRangePill(element, marker, false));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = group.current,
      marker = pill.current;
    if (element && marker) fitRangePill(element, marker, element.dataset.pill === "ready");
  }, [active]);
  return (
    <div ref={group} role="group" aria-label="Chart time range" className="chart-range">
      <span ref={pill} className="chart-range-pill" aria-hidden="true" />
      {RANGE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          className={`${active === option.value ? "selected" : ""}${option.value === "3d" ? " chart-range-days" : ""}`}
          aria-pressed={active === option.value}
          onClick={() => onPick(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const GlucoseChart = memo(function GlucoseChart({
  entries,
  cgm,
  dexcomEvents,
  timezone,
  day,
  today,
  onSelectEntry,
  onSelectDoseFood,
  illnesses = [],
  now,
  correctionAt = null,
  correctionHours = 0,
  estimate = null,
  rapidTiming = null,
  onSelectIllness,
  range,
  onRangeChange,
  cgmHistoryStart = null,
  cgmHistoryCapped = false,
  plan,
}: Props) {
  const [defaultRange, setDefaultRange] = useState<ChartRange>("day"),
    [cursor, setCursor] = useState<number | null>(null),
    [keyboardMode, setKeyboardMode] = useState(false);
  const [windowEnd, setWindowEnd] = useState<number | null>(null);
  // A zoom belongs to the range and period it was made in; changing either drops it.
  const [zoomState, setZoom] = useState<(ChartZoom & { key: string }) | null>(null),
    [selection, setSelection] = useState<ChartZoom | null>(null);
  // Layers switched off in the key, and the one being pointed at there (the rest fade).
  const [hiddenLayers, setHiddenLayers] = useState<ReadonlySet<ChartLayer>>(() => new Set()),
    [previewLayer, setPreviewLayer] = useState<ChartLayer | null>(null);
  // The period whose flag is pointed at or focused; its wash over the plot deepens.
  const [hotIllness, setHotIllness] = useState<string | null>(null);
  const shows = (layer: ChartLayer) => !hiddenLayers.has(layer);
  const drag = useRef<{ pointer: number; x: number; minute: number; active: boolean } | null>(null);
  const activeRange = range ?? defaultRange;
  const dayCount = chartRangeDays[activeRange],
    multiDay = dayCount > 1,
    span = RANGE_HOURS[activeRange] ?? 24;
  const endDay = day || today || dateKey(new Date(), timezone);
  const bounds = useMemo(
    () => chartDaysWindow(endDay, dayCount, timezone),
    [endDay, dayCount, timezone],
  );
  const dayMinutes = (bounds.end - bounds.start) / 60000;
  // Viewing today, the chart runs on past the day's end far enough to show the whole likely range.
  const estimateEndMinute =
    estimate?.state === "ready" && !multiDay && endDay === today
      ? (Date.parse(estimate.points.at(-1)?.at ?? "") - bounds.start) / 60000 || 0
      : 0;
  const ahead = Math.max(0, Math.ceil(estimateEndMinute / 60) * 60 - dayMinutes);
  const totalMinutes = dayMinutes + ahead;
  const minuteOf = (at: string) => (Date.parse(at) - bounds.start) / 60000;
  const quietHours = plan.correctionQuietHours;
  const unit = glucoseUnitOf(plan);
  const nightlyTimes = useMemo(
    () =>
      nightlySchedule(
        { basal: plan.basal, basalTime: plan.basalTime, timezone },
        bounds.start,
        bounds.end,
      ),
    [plan.basal, plan.basalTime, timezone, bounds],
  );
  const when = (at: string) => stamp(at, timezone, multiDay);
  const clock = (minute: number) => when(new Date(bounds.start + minute * 60000).toISOString());
  const plotRef = useRef<HTMLDivElement>(null);
  const initialRangeSet = useRef(false);
  const [width, setWidth] = useState(920);
  useEffect(() => {
    const element = plotRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const measured = Math.max(270, Math.round(entry.contentRect.width));
      if (!initialRangeSet.current) {
        initialRangeSet.current = true;
        if (measured <= 440) setDefaultRange("12h");
      }
      setWidth((previous) => (Math.abs(previous - measured) > 1 ? measured : previous));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const W = width,
    RIGHT = W - 15;
  const ranges = glucoseRanges(plan);
  // Everything loaded is scoped once to the chosen calendar period; the next midnight is excluded.
  const points = useMemo(() => uniqueCgm(cgm), [cgm]);
  const windowPoints = useMemo(
    () => within(points, bounds.start, bounds.end, bounds.end),
    [points, bounds],
  );
  const windowEntries = useMemo(
    () => within(entries, bounds.start, bounds.end, bounds.end),
    [entries, bounds],
  );
  const windowEvents = useMemo(
    () => within(dexcomEvents, bounds.start, bounds.end, bounds.end),
    [dexcomEvents, bounds],
  );
  // A meter's HI/LO reading has no exact value: it is kept alongside numeric readings but never
  // plotted as a fabricated point.
  const windowManual = useMemo(
    () => windowEntries.filter((e) => e.kind === "glucose" && (e.glucose !== null || !!e.status)),
    [windowEntries],
  );
  const windowFood = useMemo(() => windowEntries.filter((e) => e.kind === "food"), [windowEntries]);
  const windowInsulin = useMemo(
    () => windowEntries.filter((e) => e.kind === "insulin"),
    [windowEntries],
  );
  const windowExercise = useMemo(
    () => windowEntries.filter((e) => e.kind === "exercise"),
    [windowEntries],
  );
  const windowRescue = useMemo(
    () => windowEntries.filter((e) => e.kind === "rescue"),
    [windowEntries],
  );
  const recent = useMemo(() => {
    let latest = 0;
    for (const list of [windowPoints, windowEntries, windowEvents] as { at: string }[][])
      for (const item of list)
        latest = Math.max(latest, (Date.parse(item.at) - bounds.start) / 60000);
    return latest;
  }, [windowPoints, windowEntries, windowEvents, bounds]);
  const nowMinutes = day === today ? minuteOf(new Date().toISOString()) : recent;
  const upcomingMinute =
    correctionAt && Date.parse(correctionAt) > now
      ? Math.min(totalMinutes, minuteOf(correctionAt))
      : 0;
  const baseEnd =
    span === 24
      ? totalMinutes
      : Math.min(
          totalMinutes,
          Math.max(
            span * 60,
            windowEnd ??
              Math.ceil(Math.max(recent, nowMinutes, upcomingMinute, estimateEndMinute) / 60) * 60,
          ),
        );
  const baseStart = span === 24 ? 0 : Math.max(0, baseEnd - span * 60),
    fullWidth = baseEnd - baseStart;
  const zoomKey = `${activeRange}|${bounds.start}`;
  const zoom = zoomState?.key === zoomKey ? zoomState : null;
  // The view glides to each new span; controls act on where it is heading, drawing on where it is.
  const targetStart = zoom?.start ?? baseStart,
    targetEnd = zoom?.end ?? baseEnd;
  const eased = useEasedSpan(bounds.start + targetStart * 60000, bounds.start + targetEnd * 60000);
  const start = Math.max(0, (eased.from - bounds.start) / 60000),
    end = Math.min(totalMinutes, (eased.to - bounds.start) / 60000),
    duration = Math.max(1, end - start);
  // Only part of the loaded period is on screen, so records are cut to the plotted span.
  const partial = zoom !== null || span !== 24;
  const applyZoom = (next: ChartZoom | null) => {
    setZoom(next && { ...next, key: zoomKey });
    setCursor(null);
  };
  const from = bounds.start + start * 60000,
    to = bounds.start + end * 60000;
  const x = (minute: number) => LEFT + ((minute - start) / duration) * (RIGHT - LEFT);
  const visiblePoints = useMemo(
    () => (partial ? within(windowPoints, from, to, bounds.end) : windowPoints),
    [partial, windowPoints, from, to, bounds],
  );
  const visibleManual = useMemo(
    () => (partial ? within(windowManual, from, to, bounds.end) : windowManual),
    [partial, windowManual, from, to, bounds],
  );
  const visibleManualNumeric = useMemo(
    () => visibleManual.filter((e) => e.glucose !== null),
    [visibleManual],
  );
  const visibleManualStatus = useMemo(
    () => visibleManual.filter((e) => e.glucose === null),
    [visibleManual],
  );
  const visibleFood = useMemo(
    () => (partial ? within(windowFood, from, to, bounds.end) : windowFood),
    [partial, windowFood, from, to, bounds],
  );
  const visibleInsulin = useMemo(
    () => (partial ? within(windowInsulin, from, to, bounds.end) : windowInsulin),
    [partial, windowInsulin, from, to, bounds],
  );
  const visibleExercise = useMemo(
    () => (partial ? within(windowExercise, from, to, bounds.end) : windowExercise),
    [partial, windowExercise, from, to, bounds],
  );
  const visibleRescue = useMemo(
    () => (partial ? within(windowRescue, from, to, bounds.end) : windowRescue),
    [partial, windowRescue, from, to, bounds],
  );
  const visibleEvents = useMemo(
    () => (partial ? within(windowEvents, from, to, bounds.end) : windowEvents),
    [partial, windowEvents, from, to, bounds],
  );
  const statusRuns = useMemo(() => {
    const runs: StatusRun[] = [];
    let lastWasStatus = false;
    for (const point of visiblePoints) {
      if (!point.status) {
        lastWasStatus = false;
        continue;
      }
      const previous = lastWasStatus ? runs.at(-1) : null;
      if (
        previous &&
        previous.status === point.status &&
        Date.parse(point.at) - Date.parse(previous.last.at) <= 600000
      ) {
        previous.last = point;
        previous.count++;
      } else runs.push({ first: point, last: point, status: point.status, count: 1 });
      lastWasStatus = true;
    }
    return runs;
  }, [visiblePoints]);
  const visibleDoseFood = useMemo(() => mealDoseFoods(visibleInsulin), [visibleInsulin]);
  const visibleLinks = useMemo(
    () => mealLinks([...visibleFood, ...visibleInsulin]),
    [visibleFood, visibleInsulin],
  );
  // Numeric readings use a true mg/dL axis; HIGH is a separate status with no exact value.
  const max = useMemo(() => {
    let highest = 400;
    for (const p of visiblePoints) if (p.value !== null) highest = Math.max(highest, p.value + 30);
    for (const e of visibleManualNumeric) highest = Math.max(highest, e.glucose! + 30);
    return Math.ceil(highest / 100) * 100;
  }, [visiblePoints, visibleManualNumeric]);
  const y = (value: number) => BOTTOM - (value / max) * (BOTTOM - TOP);
  // "Now" playhead: visible only when the current instant falls inside this window's plotted span.
  const nowMinuteAbs = (now - bounds.start) / 60000;
  const nowVisible = Number.isFinite(now) && nowMinuteAbs >= start && nowMinuteAbs <= end;
  const nowX = nowVisible ? x(nowMinuteAbs) : null;
  const lastCgmReading = visiblePoints.length ? visiblePoints[visiblePoints.length - 1] : null;
  const minutesBehind =
    lastCgmReading && Number.isFinite(now)
      ? Math.max(0, Math.round((now - Date.parse(lastCgmReading.at)) / 60000))
      : null;
  const nowStale = nowVisible && minutesBehind !== null && minutesBehind > 5;
  const nowBehindText = nowStale ? behindLabel(minutesBehind!) : null;
  const nowLastX = lastCgmReading ? x(minuteOf(lastCgmReading.at)) : null;
  const nowLastY = lastCgmReading
    ? lastCgmReading.value !== null
      ? y(lastCgmReading.value)
      : lastCgmReading.status === "High"
        ? y(400)
        : y(40) + 1
    : null;
  const allReadings = useMemo(() => {
    const list: Reading[] = [];
    for (const p of visiblePoints)
      list.push({
        at: p.at,
        t: Date.parse(p.at),
        value: p.value,
        status: p.status,
        source: p.source,
      });
    for (const p of visibleManual)
      list.push({
        at: p.at,
        t: Date.parse(p.at),
        value: p.glucose,
        status: p.status ?? null,
        source: p.source ?? "Finger-stick",
      });
    return list.sort((a, b) => a.t - b.t);
  }, [visiblePoints, visibleManual]);
  const cursorAt = cursor === null ? null : bounds.start + cursor * 60000;
  const nearestIndex =
    cursorAt === null || !allReadings.length ? -1 : nearestReading(allReadings, cursorAt);
  const closeReading =
    nearestIndex >= 0 &&
    cursorAt !== null &&
    Math.abs(allReadings[nearestIndex].t - cursorAt) <= 10 * 60000
      ? allReadings[nearestIndex]
      : null;
  const sameTime: Reading[] = [];
  if (closeReading) {
    let i = nearestIndex;
    while (i > 0 && closeReading.t - allReadings[i - 1].t <= 60000) i--;
    for (; i < allReadings.length && allReadings[i].t - closeReading.t <= 60000; i++)
      sameTime.push(allReadings[i]);
  }
  // Context comes from actual observations close to the selected HIGH reading, never an estimated dose value.
  const highAt = closeReading?.status === "High" ? closeReading.t : null;
  let priorSensor: CgmReading | null = null;
  if (highAt !== null)
    for (let i = lastAtOrBefore(visiblePoints, highAt); i >= 0; i--) {
      const reading = visiblePoints[i];
      if (highAt - Date.parse(reading.at) > 20 * 60000) break;
      if (reading.value !== null) {
        priorSensor = reading;
        break;
      }
    }
  const nearbyMeter =
    highAt === null
      ? null
      : visibleManualNumeric
          .filter(
            (r) => r.source === "Finger-stick" && Math.abs(Date.parse(r.at) - highAt) <= 20 * 60000,
          )
          .sort(
            (a, b) => Math.abs(Date.parse(a.at) - highAt) - Math.abs(Date.parse(b.at) - highAt),
          )[0];
  const nearbyFood =
    cursor === null ? [] : visibleFood.filter((e) => Math.abs(minuteOf(e.at) - cursor) <= 7);
  const nearbyDoseFood =
    cursor === null
      ? []
      : visibleDoseFood.filter((food) => Math.abs(minuteOf(food.at) - cursor) <= 7);
  const nearbyInsulin =
    cursor === null ? [] : visibleInsulin.filter((e) => Math.abs(minuteOf(e.at) - cursor) <= 7);
  const nearbyExercise =
    cursor === null ? [] : visibleExercise.filter((e) => Math.abs(minuteOf(e.at) - cursor) <= 7);
  const nearbyRescue =
    cursor === null ? [] : visibleRescue.filter((e) => Math.abs(minuteOf(e.at) - cursor) <= 7);
  const nearbyDexcom =
    cursor === null ? [] : visibleEvents.filter((e) => Math.abs(minuteOf(e.at) - cursor) <= 7);
  const illnessBands = illnesses.flatMap((illness) => {
    const overlap = illnessOverlap(illness, from, to, now);
    return overlap
      ? [
          {
            illness,
            start: (overlap.start - bounds.start) / 60000,
            end: (overlap.end - bounds.start) / 60000,
          },
        ]
      : [];
  });
  const cursorIllness =
    cursor === null
      ? []
      : illnessBands.filter((band) => cursor >= band.start && cursor <= band.end);
  const correctionMinute = correctionAt ? minuteOf(correctionAt) : null;
  const showCorrection =
    day === today &&
    correctionMinute !== null &&
    correctionMinute >= start &&
    correctionMinute <= end &&
    Date.parse(correctionAt!) > now;
  const reviewText = showCorrection ? `Review · ${eventTime(correctionAt!, timezone)}` : null,
    reviewX = showCorrection ? Math.max(LEFT + 4, Math.min(RIGHT - 4, x(correctionMinute!))) : 0,
    reviewAnchorEnd = showCorrection && x(correctionMinute!) > W / 2;
  // Each period's name is a flag planted at the start of its strip. It keeps some room before the
  // right edge, and stops short of the next flag and of the review label, which shares the headroom.
  const bandTags = illnessBands
    .map((band) => ({ ...band, left: Math.max(LEFT, Math.min(x(band.start), RIGHT - TAG_ROOM)) }))
    .sort((a, b) => a.left - b.left)
    .map((tag, i, tags) => {
      let limit = i + 1 < tags.length ? tags[i + 1].left - 6 : RIGHT;
      if (reviewText !== null && shows("review")) {
        // 11px bold text runs about 6.5px a character.
        const reviewWidth = reviewText.length * 6.5,
          reviewFrom = reviewAnchorEnd ? reviewX - reviewWidth : reviewX;
        if (reviewFrom < limit && reviewFrom + reviewWidth > tag.left)
          limit = Math.min(limit, reviewFrom - 8);
      }
      return { ...tag, width: Math.max(0, limit - tag.left) };
    });
  // Timing references for every correction dose or skipped correction in view. The highlighted
  // marker above covers the upcoming one.
  const reviewMarks =
    correctionHours > 0
      ? entries.flatMap((entry) => {
          if (!isCorrectionDose(entry) && entry.kind !== "correction-skipped") return [];
          const at = new Date(Date.parse(entry.at) + correctionHours * 3600000).toISOString();
          const minute = minuteOf(at);
          return minute >= start &&
            minute <= end &&
            !(showCorrection && at === correctionAt) &&
            !inQuietHours(Date.parse(at), quietHours, timezone)
            ? [{ at, minute, passed: Date.parse(at) <= now }]
            : [];
        })
      : [];
  const nightlyMarks = nightlyTimes.flatMap((at) => {
    const minute = minuteOf(at);
    return minute >= start && minute <= end ? [{ at, minute }] : [];
  });
  // Where glucose usually fell fastest after rapid-acting, placed after each dose in view. The
  // band for a dose still ahead of it gets a label, so the timing is readable before it passes.
  const fallMarks = visibleInsulin.flatMap((dose) => {
    const fall = usualFastestFall(dose, rapidTiming);
    if (!fall) return [];
    const from = minuteOf(fall.from),
      to = minuteOf(fall.to);
    return to >= start && from <= end
      ? [{ key: dose.id, dose, fall, from, to, ahead: Date.parse(fall.to) > now }]
      : [];
  });
  const labeledFall =
    day === today
      ? fallMarks
          .filter((mark) => mark.ahead)
          .reduce<(typeof fallMarks)[number] | undefined>(
            (latest, mark) => (!latest || mark.from > latest.from ? mark : latest),
            undefined,
          )
      : undefined;
  // The likely range from the current reading on: CGM-only, never dosing advice.
  const estimatePoints =
    estimate?.state === "ready"
      ? estimate.points.flatMap((point) => {
          const minute = minuteOf(point.at);
          return minute >= start && minute <= end ? [{ ...point, px: x(minute) }] : [];
        })
      : [];
  const estimateShown = estimate?.state === "ready" && estimatePoints.length > 1;
  const estimateY = (value: number) => y(Math.min(value, max));
  const cursorX = cursor === null ? null : x(cursor);
  // The readout sits beside the cursor line on the roomier side, so the hovered point and its
  // neighbours stay visible instead of disappearing under it.
  const tooltipSide =
    cursorX === null
      ? undefined
      : cursorX > (LEFT + RIGHT) / 2
        ? { right: `calc(${100 - (cursorX / W) * 100}% + 12px)` }
        : { left: `calc(${(cursorX / W) * 100}% + 12px)` };
  // The day view keeps its own clock labels; any stretch past midnight is the likely range.
  const labelSpan = span === 24 && !zoom ? duration - ahead : duration;
  // As many as fit: a phone-width chart gets fewer, so neighbouring times never overlap.
  const labelCount = timeLabelCount(x(start + labelSpan) - x(start), span === 24 && !zoom ? 5 : 4);
  const labels = Array.from(
    { length: labelCount },
    (_, i) => start + (labelSpan * i) / (labelCount - 1),
  );
  // The last label hugs the right edge only when it is the edge; a midnight before the likely
  // range is centred on its line, kept inside the chart.
  const lastAtEdge = labelSpan === duration;
  // Long spans label whole days; a multi-day chart zoomed to a day and a half or less uses clock times.
  const dayAxis = multiDay && duration > 2160;
  // Days on screen, clipped to the zoom, labelled counting back from the last so it is always named.
  const shownDays = bounds.days.flatMap((d, i) => {
    const next = bounds.days[i + 1]?.start ?? bounds.end;
    return next > from && d.start < to
      ? [
          {
            day: d.day,
            start: (d.start - bounds.start) / 60000,
            middle: ((Math.max(d.start, from) + Math.min(next, to)) / 2 - bounds.start) / 60000,
          },
        ]
      : [];
  });
  const labelStep = Math.ceil(shownDays.length / Math.max(2, Math.floor((RIGHT - LEFT) / 58)));
  const dayTicks = dayAxis
    ? shownDays.map((tick, i) => ({
        ...tick,
        labeled: (shownDays.length - 1 - i) % labelStep === 0,
      }))
    : [];
  // Range lines keep their dashes; a label that would crowd a nearer-priority one is dropped.
  const axisTicks: { value: number; labeled: boolean }[] = [];
  // The top gridline falls on a round value in the person's unit: 100 mg/dL or 5 mmol/L steps.
  const gridTop =
    unit === "mmol/L"
      ? glucoseToMgdl(Math.floor(glucoseToUnit(max, unit) / 5) * 5, unit)
      : Math.round(max / 100) * 100;
  for (const value of [ranges.low, ranges.high, gridTop, ranges.veryHigh])
    if (!axisTicks.some((t) => t.value === value))
      axisTicks.push({
        value,
        labeled: axisTicks.every((t) => !t.labeled || Math.abs(y(t.value) - y(value)) >= 15),
      });
  // Logged events sit in labelled lanes under the time axis, one lane per kind, so their icons
  // never pile onto the curve or the day labels. Crowded icons spread apart; a tick keeps each
  // one's true time.
  type LaneMark = {
    key: string;
    at: string;
    layer: ChartLayer;
    Icon: LucideIcon | null;
    color: string;
    title: string;
    select?: { label: string; run: () => void };
  };
  const lanes = [
    {
      name: "Food",
      marks: shows("food")
        ? [
            ...visibleFood.map((e): LaneMark => ({
              key: e.id,
              at: e.at,
              layer: "food",
              Icon: Utensils,
              color: "var(--chart-linked-bg)",
              title: `${when(e.at)} · ${e.meal} · ${e.carbs} g carbs`,
              select: {
                label: `${when(e.at)} · ${e.meal} · ${e.carbs} g · open food record`,
                run: () => onSelectEntry?.(e),
              },
            })),
            ...visibleDoseFood.map((food): LaneMark => ({
              key: food.id,
              at: food.at,
              layer: "food",
              Icon: Utensils,
              color: "var(--chart-linked-bg)",
              title: `${food.carbs} g · ${food.description || "Food in meal-dose calculation"} · dose at ${when(food.at)}; meal time not separately recorded`,
              select: {
                label: `${food.carbs} g food from meal-dose record · dose at ${when(food.at)} · meal time not separately recorded · review food`,
                run: () => onSelectDoseFood?.(food.dose),
              },
            })),
          ]
        : [],
    },
    {
      name: "Insulin",
      marks: visibleInsulin
        .filter((e) => shows(e.insulin === "Long-acting" ? "long" : "rapid"))
        .map((e): LaneMark => ({
          key: e.id,
          at: e.at,
          layer: e.insulin === "Long-acting" ? "long" : "rapid",
          Icon: Syringe,
          color: e.insulin === "Long-acting" ? "var(--chart-device)" : "var(--chart-alert-high)",
          title: `${when(e.at)} · ${e.insulin} · ${e.units} units`,
          select: {
            label: `${when(e.at)} · ${e.insulin} · ${e.units} units · open insulin record`,
            run: () => onSelectEntry?.(e),
          },
        })),
    },
    {
      name: "Other",
      marks: [
        ...(shows("exercise") ? visibleExercise : []).map((e): LaneMark => ({
          key: e.id,
          at: e.at,
          layer: "exercise",
          Icon: Activity,
          color: "var(--chart-device)",
          title: `${when(e.at)} · Exercise${e.minutes ? ` · ${e.minutes} min` : ""}${e.intensity ? ` · ${e.intensity}` : ""}`,
          select: {
            label: `${when(e.at)} · Exercise · ${e.minutes ?? "—"} min · open exercise record`,
            run: () => onSelectEntry?.(e),
          },
        })),
        ...(shows("rescue") ? visibleRescue : []).map((e): LaneMark => ({
          key: e.id,
          at: e.at,
          layer: "rescue",
          Icon: Siren,
          color: "var(--chart-alert-high)",
          title: `${when(e.at)} · Rescue medication given${e.medication ? ` · ${e.medication}` : ""}`,
          select: {
            label: `${when(e.at)} · Rescue medication given · open record`,
            run: () => onSelectEntry?.(e),
          },
        })),
        ...(shows("device") ? visibleEvents : []).map((e, i): LaneMark => ({
          key: `${e.at}-${e.type}-${i}`,
          at: e.at,
          layer: "device",
          Icon: null,
          color: "var(--chart-device)",
          title: `${when(e.at)} · Dexcom ${e.type}${e.value !== null ? ` · ${glucoseWithUnit(e.value, unit)}` : ""}`,
        })),
      ],
    },
  ]
    .filter((lane) => lane.marks.length)
    .map((lane, row) => {
      const trueX = lane.marks.map((m) => x(minuteOf(m.at)));
      const placed = dodgeLane(trueX, LANE_GAP, LEFT + 8, RIGHT - 8);
      return {
        ...lane,
        top: LANES_TOP + row * LANE_H,
        marks: lane.marks.map((m, i) => ({ ...m, x: placed[i], trueX: trueX[i] })),
      };
    });
  const markAt = new Map(
    lanes.flatMap((lane) => lane.marks.map((m) => [m.key, { x: m.x, top: lane.top }] as const)),
  );
  // Dotted links run from a meal's icon down to the dose logged with it.
  const links = shows("links")
    ? [
        ...visibleLinks.map(({ food, dose }) => ({
          key: `${food.id}-${dose.id}`,
          from: markAt.get(food.id),
          to: markAt.get(dose.id),
          title: `Linked meal + dose · ${food.carbs} g at ${when(food.at)} · ${dose.units} units at ${when(dose.at)}`,
        })),
        ...visibleDoseFood.map((food) => ({
          key: `dose-food-${food.id}`,
          from: markAt.get(food.id),
          to: markAt.get(food.dose.id),
          title: `${food.carbs} g food in a meal-dose record · dose at ${when(food.at)}`,
        })),
      ].flatMap(({ from: a, to: b, ...link }) => (a && b ? [{ ...link, a, b }] : []))
    : [];
  const chartHeight = lanes.length ? LANES_TOP + lanes.length * LANE_H + 6 : AXIS_LABEL_Y + 10;
  // What the key lists: every kind with something in view, shown or hidden.
  const presentLayers = new Set<ChartLayer>();
  if (visibleManual.length) presentLayers.add("meter");
  if (statusRuns.length) presentLayers.add("status");
  if (visibleFood.length || visibleDoseFood.length) presentLayers.add("food");
  if (visibleLinks.length || visibleDoseFood.length) presentLayers.add("links");
  if (visibleInsulin.some((e) => e.insulin !== "Long-acting")) presentLayers.add("rapid");
  if (visibleInsulin.some((e) => e.insulin === "Long-acting")) presentLayers.add("long");
  if (visibleExercise.length) presentLayers.add("exercise");
  if (visibleRescue.length) presentLayers.add("rescue");
  if (visibleEvents.length) presentLayers.add("device");
  if (showCorrection || reviewMarks.length) presentLayers.add("review");
  if (nightlyMarks.length) presentLayers.add("nightly");
  if (fallMarks.length) presentLayers.add("fall");
  if (estimateShown) presentLayers.add("estimate");
  const pressable = (select: { label: string; run: () => void }) => ({
    role: "button",
    tabIndex: 0,
    "aria-label": select.label,
    onClick: (event: MouseEvent<SVGGElement>) => {
      event.stopPropagation();
      select.run();
    },
    onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        select.run();
      }
    },
  });
  const periodLabel = multiDay
    ? calendarRange.formatRange(noonUtc(bounds.days[0].day), noonUtc(endDay))
    : "";
  const scope = multiDay ? "period" : "day";
  const historyNote =
    cgmHistoryStart === null || !Number.isFinite(cgmHistoryStart) || from >= cgmHistoryStart
      ? ""
      : cgmHistoryCapped
        ? cgmHistoryStart >= to
          ? `This ${scope} is older than the loaded CGM history. The dashboard stops loading CGM history at 15,000 readings, so no CGM readings appear here.`
          : `Loaded CGM history starts ${eventDateTime(new Date(cgmHistoryStart).toISOString(), timezone)} because the dashboard stops at 15,000 CGM readings. Earlier parts of this ${scope} show no CGM readings.`
        : cgmHistoryStart >= to
          ? `This ${scope} is older than the loaded history. The dashboard loads about the last 45 days of CGM readings and Dexcom events, so only logged entries appear here.`
          : `Loaded CGM history starts ${eventDateTime(new Date(cgmHistoryStart).toISOString(), timezone)}. The dashboard loads about the last 45 days of CGM readings and Dexcom events, so earlier parts of this ${scope} show logged entries only.`;
  const records = useMemo(() => {
    // Read from the plan here: the compiler can't tell a unit derived outside stays unchanged.
    const shown = glucoseUnitOf(plan);
    return [
      ...visiblePoints.map((e) => ({
        at: e.at,
        type: "Sensor",
        detail:
          e.value !== null
            ? glucoseWithUnit(e.value, shown)
            : `${e.status?.toUpperCase()} ${e.status === "High" ? `(>${glucoseWithUnit(400, shown)})` : `(<${glucoseWithUnit(40, shown)})`} · exact value unknown`,
        source: e.source,
      })),
      ...visibleManual.map((e) => ({
        at: e.at,
        type: e.source === "Finger-stick" ? "Finger-stick" : "Manual Dexcom",
        detail: entryGlucoseLabel(e, plan),
        source: e.source ?? "Manual",
      })),
      ...visibleDoseFood.map((food) => ({
        at: food.at,
        type: "Food in meal-dose record",
        detail: `${food.carbs} g carbs${food.description ? ` · ${food.description}` : ""}; meal time not separately recorded`,
        source: "Meal-dose calculation",
        timeNote: "dose time",
      })),
      ...visibleFood.map((e) => ({
        at: e.at,
        type: "Food",
        detail: `${e.meal} · ${e.carbs} g carbs`,
        source: "Logged",
      })),
      ...visibleInsulin.map((e) => ({
        at: e.at,
        type: "Insulin",
        detail: `${e.insulin} · ${e.units} units`,
        source: "Logged",
      })),
      ...visibleExercise.map((e) => ({
        at: e.at,
        type: "Exercise",
        detail: `${e.minutes ?? "—"} min${e.intensity ? ` · ${e.intensity}` : ""}`,
        source: "Logged",
      })),
      ...visibleRescue.map((e) => ({
        at: e.at,
        type: "Rescue medication",
        detail: e.medication ?? "Given",
        source: "Logged",
      })),
      ...visibleEvents.map((e) => ({
        at: e.at,
        type: "Dexcom event",
        detail: `${e.type}${e.value !== null ? ` · ${glucoseWithUnit(e.value, shown)}` : ""}`,
        source: e.source,
      })),
    ].sort((a, b) => a.at.localeCompare(b.at));
  }, [
    visiblePoints,
    visibleManual,
    visibleFood,
    visibleInsulin,
    visibleExercise,
    visibleRescue,
    visibleDoseFood,
    visibleEvents,
    plan,
  ]);
  const keyStep = duration > 1440 ? 60 : 5;
  /** The chart minute under the pointer, kept inside the plotted span. */
  function minuteAt(event: PointerEvent<SVGSVGElement>) {
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return null;
    const point = event.currentTarget.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    return Math.max(start, Math.min(end, start + ((local.x - LEFT) / (RIGHT - LEFT)) * duration));
  }
  function scrub(event: PointerEvent<SVGSVGElement>) {
    const minute = minuteAt(event);
    if (minute === null) return;
    setKeyboardMode(false);
    setCursor(Math.max(start, Math.min(end, Math.round(minute))));
    // A mouse or pen press that moves a few pixels becomes a zoom selection. Capture starts only
    // then, so a plain click still reaches the food and insulin icons.
    const pressed = drag.current;
    if (!pressed || pressed.pointer !== event.pointerId) return;
    // The button was let go outside the chart before the press became a drag.
    if (!event.buttons) {
      drag.current = null;
      setSelection(null);
      return;
    }
    if (!pressed.active && Math.abs(event.clientX - pressed.x) >= DRAG_PIXELS) {
      pressed.active = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (pressed.active)
      setSelection({
        start: Math.min(pressed.minute, minute),
        end: Math.max(pressed.minute, minute),
      });
  }
  function finishDrag(event: PointerEvent<SVGSVGElement>) {
    const pressed = drag.current;
    if (!pressed || pressed.pointer !== event.pointerId) return;
    drag.current = null;
    setSelection(null);
    const minute = minuteAt(event);
    if (pressed.active && minute !== null)
      applyZoom(chartZoom(pressed.minute, minute, totalMinutes, fullWidth));
  }
  /** Earlier or later by half the view: the zoomed stretch, or the 12h/6h window. */
  function pan(direction: -1 | 1) {
    if (zoom) {
      const step = (direction * (targetEnd - targetStart)) / 2;
      applyZoom(chartZoom(targetStart + step, targetEnd + step, totalMinutes, fullWidth));
    } else {
      setWindowEnd(
        direction < 0
          ? Math.max(span * 60, targetEnd - span * 30)
          : Math.min(totalMinutes, targetEnd + span * 30),
      );
      setCursor(null);
    }
  }
  return (
    <div className="glucose-chart">
      <div className="glucose-chart-toolbar">
        <span className="glucose-chart-title">
          <Activity size={15} aria-hidden="true" /> Glucose & logged events
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="chart-help" aria-label="How to use the chart">
                <CircleHelp size={16} aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="chart-help-panel" align="start">
              <ul>
                <li>
                  Move across the graph, or focus it and use the arrow keys, to read each recorded
                  value.
                </li>
                <li>Select a mark below the graph to open its record.</li>
                <li>
                  Drag across the graph with a mouse, or press + and −, to zoom. Press 0 to reset.
                </li>
                <li>
                  The key under the graph shows or hides each kind of mark. Pointing at an item
                  picks out its marks.
                </li>
                {multiDay && (
                  <li>{dayCount} days ending on the selected day, recorded readings only.</li>
                )}
                {visibleDoseFood.length > 0 && (
                  <li>
                    Food from older meal-dose records sits at the dose time. Its meal time was not
                    recorded.
                  </li>
                )}
              </ul>
            </PopoverContent>
          </Popover>
        </span>
        <div className="chart-navigation">
          {partial && (
            <button
              type="button"
              aria-label="Earlier chart window"
              disabled={targetStart <= 0}
              onClick={() => pan(-1)}
            >
              <ChevronLeft size={17} />
            </button>
          )}
          <RangeSwitch
            active={activeRange}
            onPick={(value) => {
              onRangeChange(value);
              setWindowEnd(null);
              applyZoom(null);
            }}
          />
          {partial && (
            <button
              type="button"
              aria-label="Later chart window"
              disabled={targetEnd >= totalMinutes}
              onClick={() => pan(1)}
            >
              <ChevronRight size={17} />
            </button>
          )}
        </div>
      </div>
      {(multiDay || zoom) && (
        <div className="glucose-chart-meta">
          {multiDay && (
            <span
              className="glucose-chart-period"
              title={`${dayCount} days ending on the selected day · recorded readings only`}
            >
              <strong>{periodLabel}</strong>
            </span>
          )}
          {zoom && (
            <span className="glucose-chart-zoom">
              <span>
                Zoomed to{" "}
                <strong>
                  {clock(targetStart)} – {clock(targetEnd)}
                </strong>
              </span>
              <button type="button" onClick={() => applyZoom(null)}>
                Reset zoom
              </button>
            </span>
          )}
        </div>
      )}
      {historyNote && (
        <p className="glucose-chart-history" role="note">
          {historyNote}
        </p>
      )}
      <div className="plot-wrap" ref={plotRef}>
        {bandTags.map(({ illness, left, width }) => (
          <button
            type="button"
            className="chart-band-tag"
            key={illness.id}
            style={{
              left: `${(left / W) * 100}%`,
              maxWidth: `${(width / W) * 100}%`,
              top: TOP - 9,
            }}
            onClick={() => onSelectIllness?.(illness)}
            onPointerEnter={() => setHotIllness(illness.id)}
            onPointerLeave={() => setHotIllness(null)}
            onFocus={() => setHotIllness(illness.id)}
            onBlur={() => setHotIllness(null)}
            title={illness.note || "Edit this period"}
          >
            <Thermometer size={13} aria-hidden="true" />
            <strong>{periodKindLabels[periodKind(illness)]}</strong>
            <span>{illnessLabel(illness, timezone)}</span>
          </button>
        ))}
        <svg
          viewBox={`0 0 ${W} ${chartHeight}`}
          data-preview={previewLayer ?? undefined}
          role="group"
          aria-label={`Interactive glucose timeline${multiDay ? ` for ${periodLabel}` : ""}, with food, insulin and Dexcom events. Move across it to inspect actual readings. Arrow keys move ${keyStep === 60 ? "one hour" : "five minutes"}. Drag across it, or press plus and minus, to zoom; 0 resets the zoom. The table below lists every plotted record.`}
          tabIndex={0}
          onPointerMove={scrub}
          onPointerDown={(event) => {
            const minute = minuteAt(event);
            if (minute !== null && event.pointerType !== "touch" && event.button === 0)
              drag.current = { pointer: event.pointerId, x: event.clientX, minute, active: false };
            scrub(event);
          }}
          onPointerUp={finishDrag}
          onPointerCancel={() => {
            drag.current = null;
            setSelection(null);
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") setCursor(null);
          }}
          onBlur={() => setCursor(null)}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              setKeyboardMode(true);
              setCursor((c) =>
                Math.max(
                  start,
                  Math.min(
                    end,
                    (c ?? Math.floor((start + end) / 2)) +
                      (event.key === "ArrowRight" ? keyStep : -keyStep),
                  ),
                ),
              );
            }
            if (event.key === "+" || event.key === "=" || event.key === "-") {
              event.preventDefault();
              const at = cursor ?? (targetStart + targetEnd) / 2;
              applyZoom(
                zoomAround(
                  { start: targetStart, end: targetEnd },
                  at,
                  event.key === "-" ? 2 : 0.5,
                  totalMinutes,
                  fullWidth,
                ),
              );
              if (cursor !== null) setCursor(cursor);
            }
            if (event.key === "0" && zoom) applyZoom(null);
            if (event.key === "Escape") {
              if (cursor !== null) setCursor(null);
              else if (zoom) applyZoom(null);
            }
          }}
        >
          {/* One mark per period: a faint wash over its span and a slim strip along the top. The
           * flag standing on the strip names it. */}
          {illnessBands.map(({ illness, start: bandStart, end: bandEnd }) => (
            <g
              key={illness.id}
              className="chart-illness-band"
              data-hot={hotIllness === illness.id || undefined}
              aria-label={`${periodKindLabels[periodKind(illness)]}: ${illnessLabel(illness, timezone)}`}
            >
              <rect
                className="chart-illness-wash"
                x={x(bandStart)}
                y={TOP - 6}
                width={Math.max(1, x(bandEnd) - x(bandStart))}
                height={BOTTOM - TOP + 12}
                fill="var(--chart-device)"
              />
              <rect
                x={x(bandStart)}
                y={TOP - 9}
                width={Math.max(3, x(bandEnd) - x(bandStart))}
                height="3"
                rx="1.5"
                fill="var(--chart-device)"
              />
            </g>
          ))}
          {dayTicks.map(
            (tick) =>
              tick.start > start &&
              (labelStep === 1 || tick.labeled) && (
                <line
                  key={tick.day}
                  x1={x(tick.start)}
                  x2={x(tick.start)}
                  y1={TOP - 6}
                  y2={AXIS_Y}
                  stroke="var(--chart-panel-ink)"
                  opacity=".12"
                  pointerEvents="none"
                />
              ),
          )}
          {ahead > 0 && dayMinutes < end && (
            <line
              x1={x(dayMinutes)}
              x2={x(dayMinutes)}
              y1={TOP - 6}
              y2={AXIS_Y}
              stroke="var(--chart-panel-ink)"
              opacity=".12"
              pointerEvents="none"
            />
          )}
          <rect
            x={LEFT}
            y={y(ranges.high)}
            width={RIGHT - LEFT}
            height={y(ranges.low) - y(ranges.high)}
            fill="var(--chart-panel-ink)"
            opacity="0.085"
            rx="3"
          />
          {axisTicks.map(({ value, labeled }) => (
            <g key={value}>
              <line
                x1={LEFT}
                x2={RIGHT}
                y1={y(value)}
                y2={y(value)}
                stroke="var(--chart-panel-ink)"
                opacity=".17"
                strokeDasharray={value === ranges.veryHigh ? "2 7" : "4 7"}
              />
              {labeled && (
                <text x="0" y={y(value) + 4} fill="var(--chart-panel-ink-muted)" fontSize="13">
                  {formatGlucose(value, unit)}
                </text>
              )}
            </g>
          ))}
          {shows("estimate") && estimate?.state === "ready" && estimateShown && (
            <g className="chart-estimate" data-layer="estimate" pointerEvents="none">
              <polygon
                className="chart-estimate-band"
                points={[
                  ...estimatePoints.map((p) => `${p.px},${estimateY(p.high)}`),
                  ...estimatePoints.toReversed().map((p) => `${p.px},${estimateY(p.low)}`),
                ].join(" ")}
              />
              <polyline
                className="chart-estimate-median"
                points={estimatePoints.map((p) => `${p.px},${estimateY(p.median)}`).join(" ")}
              />
              <title>{`Likely range from ${estimateLabel(estimate.value, unit)} at ${eventTime(estimate.at, timezone)}: middle line is the median, band is where most past cases from your CGM history landed. CGM only, so it can't see food, insulin or activity. Not dosing advice.`}</title>
            </g>
          )}
          <SensorLayer
            points={visiblePoints}
            runs={shows("status") ? statusRuns : []}
            origin={bounds.start}
            start={start}
            duration={duration}
            right={RIGHT}
            max={max}
            dense={duration > 1440}
            timezone={timezone}
            unit={unit}
          />
          {shows("meter") && (
            <g data-layer="meter">
              {visibleManualNumeric.map((p) => {
                const cx = x(minuteOf(p.at));
                return (
                  <g key={p.id}>
                    <circle
                      cx={cx}
                      cy={y(p.glucose!)}
                      r="5"
                      fill="var(--chart-linked-bg)"
                      stroke="var(--chart-linked-border)"
                      strokeWidth="2"
                    >
                      <title>
                        {when(p.at)} · {entryGlucoseLabel(p, plan)} · {p.source}
                      </title>
                    </circle>
                    {p.glucose! > 400 && (
                      <text
                        x={cx + (cx > RIGHT - 40 ? -9 : 9)}
                        y={y(p.glucose!) - 7}
                        textAnchor={cx > RIGHT - 40 ? "end" : "start"}
                        fill="var(--chart-linked-bg)"
                        fontSize="11"
                        fontWeight="700"
                      >
                        {formatGlucose(p.glucose!, unit)}
                      </text>
                    )}
                  </g>
                );
              })}
              {visibleManualStatus.map((p) => {
                const cx = x(minuteOf(p.at));
                const cy = p.status === "High" ? y(400) : y(40) + 1;
                const label = p.status === "High" ? "HI" : "LO";
                return (
                  <g key={p.id}>
                    <circle
                      cx={cx}
                      cy={cy}
                      r="5"
                      fill="var(--chart-linked-bg)"
                      stroke="var(--chart-linked-border)"
                      strokeWidth="2"
                    >
                      <title>
                        {when(p.at)} · {entryGlucoseLabel(p, plan)} · {p.source}
                      </title>
                    </circle>
                    <text
                      x={cx + (cx > RIGHT - 40 ? -9 : 9)}
                      y={cy - 7}
                      textAnchor={cx > RIGHT - 40 ? "end" : "start"}
                      fill="var(--chart-linked-bg)"
                      fontSize="11"
                      fontWeight="700"
                    >
                      {label}
                    </text>
                  </g>
                );
              })}
            </g>
          )}
          <line
            x1={LEFT}
            x2={RIGHT}
            y1={AXIS_Y}
            y2={AXIS_Y}
            stroke="var(--chart-panel-ink)"
            opacity=".17"
          />
          {lanes.map((lane) => (
            <g key={lane.name} className="chart-lane">
              <text
                x="0"
                y={lane.top + LANE_H / 2 + 4}
                fill="var(--chart-panel-ink-muted)"
                fontSize="11"
                fontWeight="650"
              >
                {lane.name}
              </text>
              <line
                x1={LEFT}
                x2={RIGHT}
                y1={lane.top + LANE_H / 2}
                y2={lane.top + LANE_H / 2}
                stroke="var(--chart-panel-ink)"
                opacity=".07"
              />
            </g>
          ))}
          {links.map((link) => (
            <g key={link.key} className="chart-meal-link" data-layer="links">
              <path
                d={`M ${link.a.x} ${link.a.top + LANE_H / 2 + 9} L ${link.b.x} ${link.b.top + LANE_H / 2 - 9}`}
                stroke="var(--chart-link-line)"
                strokeWidth="2"
                strokeDasharray="3 3"
                opacity=".85"
                fill="none"
                pointerEvents="none"
              />
              <title>{link.title}</title>
            </g>
          ))}
          {lanes.flatMap((lane) =>
            lane.marks.map((m) => {
              const cy = lane.top + LANE_H / 2;
              const body = (
                <>
                  {Math.abs(m.x - m.trueX) > 1 && (
                    <path
                      className="chart-lane-tick"
                      d={`M ${m.trueX} ${lane.top} L ${m.x} ${cy - 9}`}
                      pointerEvents="none"
                    />
                  )}
                  <rect
                    x={m.x - LANE_GAP / 2}
                    y={lane.top}
                    width={LANE_GAP}
                    height={LANE_H}
                    fill="transparent"
                  />
                  {m.Icon ? (
                    <m.Icon
                      x={m.x - 8}
                      y={cy - 8}
                      width={16}
                      height={16}
                      color={m.color}
                      strokeWidth={2.7}
                    />
                  ) : (
                    <path d={`M${m.x} ${cy - 7} l-5 7 l5 7 l5 -7 Z`} fill={m.color} />
                  )}
                  <title>{m.title}</title>
                </>
              );
              return m.select ? (
                <g
                  key={m.key}
                  data-layer={m.layer}
                  className="chart-entry-target"
                  {...pressable(m.select)}
                >
                  {body}
                </g>
              ) : (
                <g key={m.key} data-layer={m.layer}>
                  {body}
                </g>
              );
            }),
          )}
          {shows("fall") &&
            fallMarks.map((mark) => {
              const left = x(Math.max(mark.from, start)),
                right = x(Math.min(mark.to, end));
              return (
                <rect
                  key={mark.key}
                  data-layer="fall"
                  className={mark.ahead ? "chart-fall-band is-ahead" : "chart-fall-band"}
                  x={left}
                  y={TOP}
                  width={Math.max(2, right - left)}
                  height={BOTTOM - TOP}
                  pointerEvents="none"
                />
              );
            })}
          {shows("fall") &&
            labeledFall &&
            (() => {
              const text = `Usual fastest fall · ${eventTime(labeledFall.fall.from, timezone)}`;
              // Beside the band on whichever side has room for the words and no timing line
              // (the correction review or a nightly dose) running through them.
              const width = text.length * 6;
              const lines = [
                ...(shows("review") && showCorrection ? [x(correctionMinute!)] : []),
                ...(shows("nightly") ? nightlyMarks.map((mark) => x(mark.minute)) : []),
              ];
              const clear = (left: number) =>
                left >= LEFT &&
                left + width <= RIGHT &&
                lines.every((line) => line < left - 4 || line > left + width + 4);
              const after = clear(x(labeledFall.to) + 6) || !clear(x(labeledFall.from) - 6 - width);
              return (
                <text
                  data-layer="fall"
                  className="chart-fall-label"
                  x={after ? x(labeledFall.to) + 6 : x(labeledFall.from) - 6}
                  y={TOP + 14}
                  textAnchor={after ? "start" : "end"}
                  pointerEvents="none"
                >
                  {text}
                </text>
              );
            })()}
          {shows("nightly") &&
            nightlyMarks.map((mark) => (
              <line
                key={mark.at}
                data-layer="nightly"
                x1={x(mark.minute)}
                x2={x(mark.minute)}
                y1={TOP}
                y2={BOTTOM}
                className="chart-nightly-line"
              >
                <title>{`Scheduled long-acting · ${eventTime(mark.at, timezone)} · from your care plan`}</title>
              </line>
            ))}
          {shows("review") &&
            reviewMarks.map((mark) => (
              <line
                key={mark.at}
                data-layer="review"
                x1={x(mark.minute)}
                x2={x(mark.minute)}
                y1={TOP}
                y2={BOTTOM}
                className={mark.passed ? "chart-review-line is-passed" : "chart-review-line"}
                pointerEvents="none"
              />
            ))}
          {shows("review") && showCorrection && (
            <g
              className="chart-correction-review"
              data-layer="review"
              aria-label={`Next correction review at ${eventTime(correctionAt!, timezone)}. Timing reference only.`}
            >
              <line
                x1={x(correctionMinute!)}
                x2={x(correctionMinute!)}
                y1={TOP - 12}
                y2={AXIS_Y}
                stroke="var(--chart-review)"
                strokeWidth="2"
                strokeDasharray="12 7"
              />
              <text
                x={reviewX}
                y={TOP - 18}
                textAnchor={reviewAnchorEnd ? "end" : "start"}
                fill="var(--chart-review)"
                fontSize="11"
                fontWeight="700"
              >
                {reviewText}
              </text>
              <title>
                Next correction review · {eventTime(correctionAt!, timezone)} · timing reference,
                not a dose recommendation
              </title>
            </g>
          )}
          {nowVisible && nowX !== null && (
            <NowLayer
              nowX={nowX}
              lastX={nowLastX}
              lastY={nowLastY}
              stale={nowStale}
              behindText={nowBehindText}
            />
          )}
          {selection && (
            <rect
              className="chart-zoom-selection"
              x={x(selection.start)}
              y={TOP - 7}
              width={Math.max(1, x(selection.end) - x(selection.start))}
              height={BOTTOM - TOP + 14}
              pointerEvents="none"
            />
          )}
          {cursorX !== null && (
            <line
              x1={cursorX}
              x2={cursorX}
              y1={TOP}
              y2={AXIS_Y}
              stroke="var(--chart-panel-ink)"
              strokeWidth="1"
              strokeDasharray="4 4"
              opacity=".85"
              pointerEvents="none"
            />
          )}
          {closeReading && (
            <circle
              cx={x(minuteOf(closeReading.at))}
              cy={
                closeReading.value !== null
                  ? y(closeReading.value)
                  : closeReading.status === "High"
                    ? y(400)
                    : y(40) + 1
              }
              r="7"
              fill={
                closeReading.value !== null ? "var(--chart-linked-bg)" : "var(--chart-alert-high)"
              }
              stroke="var(--chart-panel-ink)"
              strokeWidth="2"
              pointerEvents="none"
            />
          )}
          {dayAxis
            ? dayTicks.map(
                (tick) =>
                  tick.labeled && (
                    <text
                      key={tick.day}
                      x={x(tick.middle)}
                      y={AXIS_LABEL_Y}
                      textAnchor="middle"
                      fill="var(--chart-panel-ink-muted)"
                      fontSize="13"
                    >
                      {calendarDay.format(noonUtc(tick.day))}
                    </text>
                  ),
              )
            : labels.map((minute, i) => (
                <text
                  key={i}
                  x={
                    i === labels.length - 1 && !lastAtEdge
                      ? Math.min(x(minute), W - TIME_LABEL_PX / 2)
                      : x(minute)
                  }
                  y={AXIS_LABEL_Y}
                  textAnchor={
                    i === 0 ? "start" : i === labels.length - 1 && lastAtEdge ? "end" : "middle"
                  }
                  fill="var(--chart-panel-ink-muted)"
                  fontSize="13"
                >
                  {clock(minute)}
                </text>
              ))}
        </svg>
        {cursor !== null && (
          <div className="plot-tooltip" style={tooltipSide}>
            <strong>
              {new Date(bounds.start + cursor * 60000).toLocaleString("en-US", {
                timeZone: timezone,
                ...(multiDay
                  ? ({ weekday: "short", month: "short", day: "numeric" } as const)
                  : {}),
                hour: "numeric",
                minute: "2-digit",
                timeZoneName: "short",
              })}
            </strong>
            {sameTime.length ? (
              mergeReadings(sameTime).map((r, i) => (
                <span key={r.at + r.source + i}>
                  {/* The header already names this minute; only a reading off the cursor gets its own time. */}
                  {when(r.at) !== clock(cursor) && `${when(r.at)} · `}
                  {r.value !== null
                    ? glucoseWithUnit(r.value, unit)
                    : `${r.status?.toUpperCase()} ${r.status === "High" ? `(>${formatGlucose(400, unit)})` : `(<${formatGlucose(40, unit)})`} · exact value unknown`}{" "}
                  · {glucoseLevelNames[glucoseLevel(r, ranges)]}{" "}
                  <small>{r.sources.join(", ")}</small>
                </span>
              ))
            ) : (
              <span>No recorded glucose within 10 minutes</span>
            )}
            {highAt !== null && priorSensor && (
              <span>
                Previous sensor: {glucoseWithUnit(priorSensor.value!, unit)} at{" "}
                {when(priorSensor.at)} <small>measured</small>
              </span>
            )}
            {highAt !== null && nearbyMeter && (
              <span>
                Nearby finger-stick: {entryGlucoseLabel(nearbyMeter, plan)} at{" "}
                {when(nearbyMeter.at)} <small>measured separately</small>
              </span>
            )}
            {nearbyFood.map((e) => (
              <span key={e.id}>
                {when(e.at)} · {e.meal} · {e.carbs} g <small>food</small>
              </span>
            ))}
            {nearbyDoseFood.map((food) => (
              <span key={food.id}>
                {food.carbs} g food in meal-dose record{" "}
                <small>Dose at {when(food.at)} · meal time not separately recorded</small>
              </span>
            ))}
            {nearbyInsulin.map((e) => (
              <span key={e.id}>
                {when(e.at)} · {e.insulin} · {e.units} units <small>dose logged</small>
              </span>
            ))}
            {shows("fall") &&
              cursor !== null &&
              fallMarks
                .filter((mark) => cursor >= mark.from && cursor <= mark.to)
                .map((mark) => (
                  <span key={`fall-${mark.key}`}>
                    Usual fastest fall after {when(mark.dose.at)} rapid-acting ·{" "}
                    {when(mark.fall.from)}–{when(mark.fall.to)}{" "}
                    <small>from earlier doses · timing only</small>
                  </span>
                ))}
            {nearbyExercise.map((e) => (
              <span key={e.id}>
                {when(e.at)} · Exercise{e.minutes ? ` · ${e.minutes} min` : ""}
                {e.intensity ? ` · ${e.intensity}` : ""} <small>logged</small>
              </span>
            ))}
            {nearbyRescue.map((e) => (
              <span key={e.id}>
                {when(e.at)} · Rescue medication given{e.medication ? ` · ${e.medication}` : ""}{" "}
                <small>logged</small>
              </span>
            ))}
            {nearbyDexcom.map((e, i) => (
              <span key={e.at + e.type + i}>
                {when(e.at)} · {e.type}
                {e.value !== null ? ` · ${glucoseWithUnit(e.value, unit)}` : ""}{" "}
                <small>Dexcom event</small>
              </span>
            ))}
            {cursorIllness.map(({ illness }) => (
              <span key={illness.id} className="plot-tooltip-period">
                {periodKindLabels[periodKind(illness)]}
                {illness.note ? ` · ${illness.note}` : ""}{" "}
                <small>{illnessLabel(illness, timezone)}</small>
              </span>
            ))}
          </div>
        )}
        {!visiblePoints.length && !visibleManual.length && (
          <span className="plot-empty">
            No glucose readings in this {multiDay ? "period" : "window"}
          </span>
        )}
      </div>
      <span className="glucose-chart-sr" aria-live="polite">
        {keyboardMode && cursor !== null
          ? `${clock(cursor)}. ${sameTime.map((r) => (r.value !== null ? `${formatGlucose(r.value, unit)} ${unit === "mmol/L" ? "millimoles per liter" : "milligrams per deciliter"}, ${r.source}` : `${r.status} ${r.status === "High" ? `above ${formatGlucose(400, unit)}` : `below ${formatGlucose(40, unit)}`}, exact value unknown, ${r.source}`)).join(". ") || "No glucose within ten minutes"}. ${nearbyFood.length} food records, ${nearbyDoseFood.length} meal-dose food details and ${nearbyInsulin.length} insulin records nearby.`
          : ""}
      </span>
      <span className="glucose-chart-sr" aria-live="polite">
        {zoom ? `Zoomed to ${clock(targetStart)} to ${clock(targetEnd)}.` : ""}
      </span>
      {nowVisible && nowStale && nowBehindText && (
        <span className="glucose-chart-sr" aria-live="polite">
          Current time marker on the graph: latest CGM reading is {nowBehindText}.
        </span>
      )}
      <ChartLegend
        present={presentLayers}
        hidden={hiddenLayers}
        onToggle={(layer) => {
          setPreviewLayer(null);
          setHiddenLayers((previous) => {
            const next = new Set(previous);
            if (!next.delete(layer)) next.add(layer);
            return next;
          });
        }}
        onPreview={setPreviewLayer}
        status={{
          high: statusRuns.some((run) => run.status === "High"),
          low: statusRuns.some((run) => run.status === "Low"),
        }}
        reviewHours={correctionHours}
        rapidTiming={rapidTiming}
        cgm={visiblePoints.some((point) => point.value !== null)}
        rangeLabel={`In range ${formatGlucose(ranges.low, unit)}–${formatGlucose(ranges.high, unit)} ${unit}`}
        unit={unit}
      />
      <RecordsTable records={records} timezone={timezone} withDate={multiDay} />
    </div>
  );
});
export default GlucoseChart;
