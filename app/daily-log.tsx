"use client";
import { useMemo, useState } from "react";
import {
  Activity,
  Calculator,
  Droplet,
  Dumbbell,
  Heart,
  Link2,
  Loader2,
  Pencil,
  Siren,
  Syringe,
  Thermometer,
  Utensils,
} from "lucide-react";
import { MealRatioPicker } from "./meal-ratio-fields";
import {
  checkInDetails,
  checkInsBetween,
  illnessLabel,
  periodKind,
  periodKindLabels,
  type IllnessWindow,
} from "@/lib/illness";
import { chartDayWindow } from "@/lib/chart-window";
import { CheckInList } from "./illness-check-in-dialog";
import {
  stepShortfall,
  exactUnits,
  entryGlucoseLabel,
  type CgmReading,
  type DexcomEvent,
  type Entry,
  type MealRatio,
  type Plan,
} from "@/lib/care";
import type { DoseFood } from "@/lib/meal-log";
import type { EntryModalKind } from "./entry-dialog";

const fmt = (n: number) => Number(n.toFixed(2)).toString();
const iconFor = {
  glucose: Droplet,
  food: Utensils,
  insulin: Syringe,
  exercise: Dumbbell,
  rescue: Siren,
};

function ExactDose({
  raw,
  rounded,
  increment,
}: {
  raw: number;
  rounded: number;
  increment: number;
}) {
  const shortfall = stepShortfall(raw, rounded, { increment });
  return (
    <small className="dose-exact">
      Exact math {exactUnits(raw)} units
      {shortfall && ` · ${fmt(shortfall.short)} short of ${fmt(shortfall.next)}`}
    </small>
  );
}

type GroupedEvent = {
  kind: string;
  item: Entry | CgmReading | DexcomEvent | DoseFood;
  firstAt: string;
  count: number;
};

/** Keeps the day-log search and filter local so each keystroke re-renders this panel, not the whole dashboard. */
export default function DailyLog({
  day,
  today,
  plan,
  desktopLog,
  loading,
  groupedEvents,
  dayIllnesses,
  entryCount,
  doseFoodRecords,
  cgmCount,
  dayCgmCount,
  dailyCgmUniqueReadings,
  cgmInterval,
  onCgmIntervalChange,
  entries,
  linkedRecordIds,
  selectedFoodIds,
  onToggleFoodSelection,
  selectedFoods,
  selectedCarbs,
  selectedRatio,
  selectedFoodMath,
  selectionMeal,
  onSelectionMealChange,
  onClearSelectedFoods,
  onLogSelectedFoodDose,
  onEditIllness,
  onSelectEntry,
  onSelectDoseFood,
}: {
  day: string;
  today: string;
  plan: Plan;
  desktopLog: boolean;
  loading: boolean;
  groupedEvents: GroupedEvent[];
  dayIllnesses: IllnessWindow[];
  entryCount: number;
  doseFoodRecords: DoseFood[];
  cgmCount: number;
  dayCgmCount: number;
  dailyCgmUniqueReadings: number;
  cgmInterval: 15 | 30 | 60;
  onCgmIntervalChange: (minutes: 15 | 30 | 60) => void;
  entries: Entry[];
  linkedRecordIds: Set<string>;
  selectedFoodIds: string[];
  onToggleFoodSelection: (id: string, checked: boolean) => void;
  selectedFoods: Entry[];
  selectedCarbs: number;
  selectedRatio: number | null;
  selectedFoodMath: { food: number; raw: number; rounded: number };
  selectionMeal: MealRatio | null;
  onSelectionMealChange: (value: MealRatio | null) => void;
  onClearSelectedFoods: () => void;
  onLogSelectedFoodDose: () => void;
  onEditIllness: (illness: IllnessWindow) => void;
  onSelectEntry: (kind: EntryModalKind, entry: Entry) => void;
  onSelectDoseFood: (dose: Entry) => void;
}) {
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [logFilter, setLogFilter] = useState<"care" | "all" | "food" | "insulin">("care");
  const [logSearch, setLogSearch] = useState("");
  // A new day starts with a clear search, reset while rendering rather than in an effect.
  const [searchDay, setSearchDay] = useState(day);
  if (day !== searchDay) {
    setSearchDay(day);
    setLogSearch("");
    setShowAllEvents(false);
  }
  const time = (value: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: plan.timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  const dayBounds = useMemo(
    () => (day ? chartDayWindow(day, plan.timezone) : null),
    [day, plan.timezone],
  );
  const visibleIllnesses = useMemo(
    () =>
      logFilter === "care" || logFilter === "all"
        ? dayIllnesses.flatMap((illness) => {
            const checkIns = dayBounds
              ? checkInsBetween(illness, dayBounds.start, dayBounds.end)
              : [];
            const haystack = [
              periodKindLabels[periodKind(illness)],
              "sick illness check-in",
              illnessLabel(illness, plan.timezone),
              illness.note,
              ...checkIns.flatMap((c) => [
                ...checkInDetails(c, plan.temperatureUnit),
                c.note ?? "",
              ]),
            ].join(" ");
            return logSearch.trim() === "" ||
              haystack.toLocaleLowerCase().includes(logSearch.trim().toLocaleLowerCase())
              ? [{ illness, checkIns }]
              : [];
          })
        : [],
    [dayIllnesses, dayBounds, logFilter, logSearch, plan.temperatureUnit],
  );
  const filteredEvents = useMemo(
    () =>
      groupedEvents.filter(
        (row) =>
          (logFilter === "all" ||
            (logFilter === "care" && (row.kind === "manual" || row.kind === "dose-food")) ||
            (logFilter === "food" && row.kind === "dose-food") ||
            (row.kind === "manual" && (row.item as Entry).kind === logFilter)) &&
          (logSearch.trim() === "" ||
            JSON.stringify(row.item)
              .toLocaleLowerCase()
              .includes(logSearch.trim().toLocaleLowerCase())),
      ),
    [groupedEvents, logFilter, logSearch],
  );
  return (
    <section className="panel timeline" id="daily-log">
      <div className="section-heading">
        <div>
          <h2>Daily log</h2>
          <p>What happened, newest first.</p>
        </div>
        <span className="count">
          {entryCount} logged
          {doseFoodRecords.length
            ? ` · ${doseFoodRecords.length} meal ${doseFoodRecords.length === 1 ? "detail" : "details"}`
            : ""}{" "}
          · {cgmCount} CGM
        </span>
      </div>
      {visibleIllnesses.length > 0 && (
        <div className="illness-log-ranges">
          {visibleIllnesses.map(({ illness, checkIns }) => (
            <div key={illness.id} className="illness-log-item">
              <button
                type="button"
                className="illness-log-row"
                onClick={() => onEditIllness(illness)}
              >
                <Thermometer size={18} />
                <span>
                  <strong>
                    {periodKindLabels[periodKind(illness)]} ·{" "}
                    {illness.endDate ? "recorded range" : "ongoing"}
                  </strong>
                  <small>{illnessLabel(illness, plan.timezone)}</small>
                  {illness.note && <small>{illness.note}</small>}
                </span>
                <Pencil size={14} />
              </button>
              {checkIns.length > 0 && (
                <CheckInList
                  checkIns={checkIns}
                  timezone={plan.timezone}
                  unit={plan.temperatureUnit}
                />
              )}
            </div>
          ))}
        </div>
      )}
      <div className="log-filters" role="group" aria-label="Daily log filter">
        {(
          [
            ["care", "Care"],
            ["food", "Food"],
            ["insulin", "Insulin"],
            ["all", "All data"],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            aria-pressed={logFilter === value}
            onClick={() => {
              setLogFilter(value);
              setShowAllEvents(false);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="log-search">
        <span className="sr-only">Search the selected day’s log</span>
        <input
          type="search"
          placeholder="Find in this day’s log…"
          value={logSearch}
          onChange={(event) => setLogSearch(event.target.value)}
        />
      </label>
      {logFilter === "all" && (
        <div className="cgm-controls">
          <span>CGM sample interval</span>
          <div role="group" aria-label="CGM sample interval">
            {([15, 30, 60] as const).map((minutes) => (
              <button
                key={minutes}
                type="button"
                className={cgmInterval === minutes ? "selected" : ""}
                aria-pressed={cgmInterval === minutes}
                onClick={() => onCgmIntervalChange(minutes)}
              >
                {minutes} min
              </button>
            ))}
          </div>
        </div>
      )}
      {logFilter === "all" && dayCgmCount > 0 && (
        <p className="cgm-note care-workspace-sampling-note">
          {cgmCount} of {dailyCgmUniqueReadings} CGM points shown here · all points on the chart
        </p>
      )}
      {selectedFoods.length > 0 && (
        <div className="selected-food-math" role="status">
          <div>
            <strong>
              {selectedFoods.length} {selectedFoods.length === 1 ? "food entry" : "food entries"} ·{" "}
              {fmt(selectedCarbs)} g carbs
            </strong>
            <button type="button" onClick={onClearSelectedFoods}>
              Clear
            </button>
          </div>
          <MealRatioPicker plan={plan} value={selectionMeal} onChange={onSelectionMealChange} />
          <p>
            {selectedRatio !== null
              ? `Food coverage: ${fmt(selectedCarbs)} ÷ ${selectedRatio} = ${fmt(selectedFoodMath.food)} units`
              : "Choose a ratio before calculating food coverage."}
          </p>
          {selectedRatio !== null && <ExactDose {...selectedFoodMath} increment={plan.increment} />}
          {day !== today && (
            <p className="notice timing-warning">
              Past-day food is for review. To record a dose already given, use Log insulin and enter
              the actual time.
            </p>
          )}
          <button
            type="button"
            className="button primary selection-log-button"
            disabled={day !== today || selectedRatio === null}
            onClick={onLogSelectedFoodDose}
          >
            <Calculator size={17} />
            Log with insulin calculator
          </button>
        </div>
      )}
      {loading ? (
        <div className="empty">
          <Loader2 className="spin" />
          Loading your log…
        </div>
      ) : filteredEvents.length === 0 &&
        visibleIllnesses.length > 0 ? null : filteredEvents.length === 0 ? (
        <div className="empty">
          <span className="empty-icon">
            <Heart size={26} />
          </span>
          <h3>
            {logSearch
              ? "No matching entries"
              : logFilter === "all"
                ? "No entries for this day"
                : "No matching care entries"}
          </h3>
          <p>
            {logSearch
              ? "Try a food name, medication, or note."
              : "Use the logging buttons to record food, a reading, or insulin actually given."}
          </p>
          {logFilter !== "all" && dayCgmCount > 0 && (
            <button type="button" className="button subtle" onClick={() => setLogFilter("all")}>
              Show sensor readings
            </button>
          )}
        </div>
      ) : (
        <div className="events">
          {(showAllEvents || desktopLog ? filteredEvents : filteredEvents.slice(0, 12)).map(
            ({ kind, item, firstAt, count }) =>
              kind === "dose-food" ? (
                <button
                  key={(item as DoseFood).id}
                  className="event dose-food-event"
                  onClick={() => onSelectDoseFood((item as DoseFood).dose)}
                >
                  <span className="icon-circle food">
                    <Utensils size={18} />
                  </span>
                  <div className="event-body">
                    <strong>Food · {fmt((item as DoseFood).carbs)} g carbs</strong>
                    <span className="linked-meal-badge">
                      <Link2 size={14} />
                      From meal-dose record
                    </span>
                    <p>
                      {(item as DoseFood).description || "Carbohydrates recorded with this dose"}
                    </p>
                    <p className="event-note">
                      Dose at {time(item.at)} · meal time not separately recorded
                    </p>
                  </div>
                  <span className="event-time">
                    {time(item.at)}
                    <Pencil size={13} />
                  </span>
                </button>
              ) : kind === "dexcom-event" ? (
                <div
                  key={`dexcom-event-${item.at}-${(item as DexcomEvent).type}`}
                  className="event dexcom-event"
                >
                  <span className="icon-circle cgm-icon">
                    <Activity size={18} />
                  </span>
                  <div className="event-body">
                    <strong>
                      Dexcom {(item as DexcomEvent).type}
                      {(item as DexcomEvent).value !== null
                        ? ` · ${(item as DexcomEvent).value} mg/dL`
                        : ""}
                    </strong>
                    <p>{(item as DexcomEvent).details || "Imported from Clarity CSV"}</p>
                  </div>
                  <span className="event-time">{time(item.at)}</span>
                </div>
              ) : kind === "cgm" ? (
                <div key={`cgm-${item.at}`} className="event cgm-event">
                  <span className="icon-circle cgm-icon">
                    <Activity size={18} />
                  </span>
                  <div className="event-body">
                    <strong>
                      {(item as CgmReading).value !== null
                        ? `${(item as CgmReading).value} mg/dL`
                        : `${(item as CgmReading).status?.toUpperCase()} · out of range`}
                    </strong>
                    <p>
                      {count > 1
                        ? `${count} sampled CGM readings · ${time(firstAt)}–${time(item.at)}`
                        : "Imported CGM · sampled reading"}
                    </p>
                  </div>
                  <span className="event-time">{time(item.at)}</span>
                </div>
              ) : (
                (() => {
                  const e = item as Entry;
                  const Icon = iconFor[e.kind];
                  return (
                    <div
                      key={e.id}
                      className={`selectable-event${e.kind === "food" && selectedFoodIds.includes(e.id) ? " is-selected" : ""}`}
                    >
                      {e.kind === "food" && (
                        <label className="food-select">
                          <input
                            type="checkbox"
                            checked={selectedFoodIds.includes(e.id)}
                            aria-label={`Include ${e.meal} at ${time(e.at)} (${fmt(e.carbs ?? 0)} g carbs) in food coverage`}
                            onChange={(event) => onToggleFoodSelection(e.id, event.target.checked)}
                          />
                        </label>
                      )}
                      <button className="event" onClick={() => onSelectEntry(e.kind, e)}>
                        <span className={"icon-circle " + e.kind}>
                          <Icon size={18} />
                        </span>
                        <div className="event-body">
                          <strong>
                            {e.kind === "glucose"
                              ? entryGlucoseLabel(e, plan.meter)
                              : e.kind === "food"
                                ? `${e.meal} · ${fmt(e.carbs!)} g carbs${e.lowSeverity ? ` · ${e.lowSeverity.toLowerCase()} low` : ""}`
                                : e.kind === "exercise"
                                  ? `Exercise · ${e.minutes} min${e.intensity ? ` · ${e.intensity.toLowerCase()}` : ""}`
                                  : e.kind === "rescue"
                                    ? `Emergency medication · ${e.medication}`
                                    : `${e.insulin} · ${fmt(e.units!)} units`}
                          </strong>
                          {(linkedRecordIds.has(e.id) ||
                            doseFoodRecords.some((food) => food.dose.id === e.id)) && (
                            <span className="linked-meal-badge">
                              <Link2 size={14} />
                              Linked meal + dose
                            </span>
                          )}
                          <p>
                            {e.kind === "glucose"
                              ? `${e.source}${e.ketones && e.ketones !== "Not checked" ? ` · Ketones: ${e.ketones}` : ""}`
                              : e.kind === "insulin"
                                ? e.purpose
                                  ? `Given · ${e.purpose}`
                                  : "Given · purpose not recorded"
                                : e.kind === "food"
                                  ? "Food recorded separately from insulin"
                                  : e.kind === "rescue"
                                    ? "Severe low · emergency medication given"
                                    : "Activity"}
                          </p>
                          {e.calculation && (
                            <p className="event-note">
                              Based on {e.calculation.mode.toLowerCase()}
                              {e.calculation.carbs > 0
                                ? ` · ${fmt(e.calculation.carbs)} g carbs`
                                : ""}
                              {e.calculation.glucose !== null
                                ? ` · ${e.calculation.glucose} mg/dL`
                                : ""}
                              {e.calculation.foodEntryIds.length
                                ? ` · linked food: ${e.calculation.foodEntryIds
                                    .map((id) => {
                                      const linked = entries.find((food) => food.id === id);
                                      return linked
                                        ? `${linked.meal} at ${time(linked.at)}`
                                        : "removed food entry";
                                    })
                                    .join(", ")}`
                                : ""}
                            </p>
                          )}
                          {e.note && <p className="event-note">{e.note}</p>}
                        </div>
                        <span className="event-time">
                          {time(e.at)}
                          <Pencil size={13} />
                        </span>
                      </button>
                    </div>
                  );
                })()
              ),
          )}
        </div>
      )}
      {filteredEvents.length > 12 && !desktopLog && (
        <button
          type="button"
          className="button subtle log-more"
          onClick={() => setShowAllEvents((value) => !value)}
        >
          {showAllEvents ? "Show fewer entries" : `Show all ${filteredEvents.length} rows`}
        </button>
      )}
    </section>
  );
}
