"use client";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { dateKey } from "@/lib/care";
import { currentSensor, type CgmSummaryResponse } from "@/lib/cgm-summary";
import type { ClarityStatus } from "@/lib/clarity-sync";
import { AGP_MIN_WEAR_PERCENT, GLUCOSE_LEVELS, glucoseLevelLabels } from "@/lib/glucose-metrics";
import { CARE_CHANGED } from "@/lib/live-refresh";
import { formatSize, reportKindNames } from "./clarity-panel";
import "./cgm-overview.css";

const MONTHS = 12;

type Loaded =
  | { key: string; summary: CgmSummaryResponse; clarity: ClarityStatus | null }
  | { key: string; error: string };

async function json<T>(url: string, signal: AbortSignal) {
  const response = await fetch(url, { cache: "no-store", signal });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "The long-term record is unavailable.");
  return data;
}

/** The first day of the month `back` months before the one holding `day`. */
function monthStart(day: string, back: number) {
  const d = new Date(`${day.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - back);
  return d.toISOString().slice(0, 10);
}

/** Days in a YYYY-MM month. */
const daysInMonth = (month: string) =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

const monthFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  year: "numeric",
});
const dayFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
});
const pct = (value: number) => `${value}%`;
const tenth = (value: number) => Math.round(value * 10) / 10;

/**
 * The record kept past the report's dates: a year of standard CGM levels by month, every
 * sensor Clarity has reported, and every Clarity PDF archived. Screen only; it does not print.
 */
export default function CgmHistory({ active, timezone }: { active: boolean; timezone: string }) {
  // Re-read whenever the care log changes, so a Clarity sync shows up.
  const [clock, setClock] = useState(Date.now);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const today = dateKey(new Date(clock), timezone);
  const key = `${today}|${clock}`;
  useEffect(() => {
    const refresh = () => setClock(Date.now());
    window.addEventListener(CARE_CHANGED, refresh);
    return () => window.removeEventListener(CARE_CHANGED, refresh);
  }, []);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    Promise.all([
      json<CgmSummaryResponse>(
        `/api/cgm/summary?start=${monthStart(today, MONTHS - 1)}&end=${today}`,
        controller.signal,
      ),
      // Without Clarity the year still shows; only the sensors and PDFs are missing.
      json<ClarityStatus>("/api/clarity", controller.signal).catch(() => null),
    ])
      .then(([summary, clarity]) => setLoaded({ key, summary, clarity }))
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setLoaded({
            key,
            error: e instanceof Error ? e.message : "The long-term record is unavailable.",
          });
      });
    return () => controller.abort();
  }, [active, today, key]);

  const dateTime = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    [timezone],
  );

  const summary = loaded && "summary" in loaded ? loaded.summary : null;
  const clarity = loaded && "clarity" in loaded ? loaded.clarity : null;
  const stale = loaded?.key !== key;
  // Months before the first CGM reading say nothing, so the table starts at the first one.
  const firstWorn = summary?.months.findIndex((m) => m.readings > 0) ?? -1;
  const months = firstWorn < 0 ? [] : (summary?.months.slice(firstWorn).reverse() ?? []);
  const sensors = [...(summary?.sensors ?? [])].reverse();
  const running = summary ? currentSensor(summary.sensors, clock) : null;
  const reports = clarity?.reports ?? [];

  return (
    <section
      className="cgm-history"
      aria-labelledby="cgm-history-heading"
      aria-busy={stale && loaded !== null}
    >
      <header>
        <h2 id="cgm-history-heading">Long-term record</h2>
        <p>
          Standard CGM ranges month by month, sensors and archived Clarity reports. Not part of the
          printed report.
        </p>
      </header>
      {loaded && "error" in loaded && !stale ? (
        <p className="notice danger" role="alert">
          {loaded.error}
        </p>
      ) : !summary ? (
        <p className="cgm-history-empty" role="status">
          Loading the long-term record…
        </p>
      ) : (
        <div className={`cgm-history-body${stale ? " is-stale" : ""}`}>
          <div className="cgm-history-part">
            <h3>Past {MONTHS} months</h3>
            {months.length ? (
              <>
                <div className="cgm-history-scroll">
                  <table className="cgm-history-months">
                    <thead>
                      <tr>
                        <th scope="col">Month</th>
                        <th scope="col">Ranges</th>
                        <th scope="col">In range 70–180</th>
                        <th scope="col">Below 70</th>
                        <th scope="col">Above 250</th>
                        <th scope="col">Average</th>
                        <th scope="col">CGM wear</th>
                      </tr>
                    </thead>
                    <tbody>
                      {months.map(({ month, days, levels, mean, wearPercent }) => (
                        <tr key={month}>
                          <th scope="row">
                            {monthFormat.format(new Date(`${month}-15T12:00:00Z`))}
                            {days < daysInMonth(month) && <small>{days} days so far</small>}
                          </th>
                          <td>
                            {levels ? (
                              <div
                                className="cgm-levels-track"
                                role="img"
                                aria-label={GLUCOSE_LEVELS.map(
                                  (l) => `${glucoseLevelLabels[l]} ${levels[l]}%`,
                                ).join(", ")}
                              >
                                {GLUCOSE_LEVELS.map((level) => (
                                  <span
                                    key={level}
                                    className={`level-${level}`}
                                    style={{ flexGrow: levels[level] }}
                                  />
                                ))}
                              </div>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>{levels ? pct(levels.inRange) : "—"}</td>
                          <td>{levels ? pct(tenth(levels.veryLow + levels.low)) : "—"}</td>
                          <td>{levels ? pct(levels.veryHigh) : "—"}</td>
                          <td>{mean === null ? "—" : `${mean} mg/dL`}</td>
                          <td className={wearPercent < AGP_MIN_WEAR_PERCENT ? "is-low" : undefined}>
                            {pct(wearPercent)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="cgm-history-note">
                  Percentages cover only the time the CGM recorded. Wear below{" "}
                  {AGP_MIN_WEAR_PERCENT}% is marked, since that month may not be represented well.
                  The average is left out when more than a few readings were past the sensor’s
                  limit.
                </p>
              </>
            ) : (
              <p className="cgm-history-empty">No CGM readings in the past {MONTHS} months.</p>
            )}
          </div>
          <div className="cgm-history-part">
            <h3>Sensors</h3>
            {sensors.length ? (
              <ul className="cgm-history-list">
                {sensors.map((s) => {
                  const inUseDay =
                    running?.sensorId === s.sensorId && running.inUse ? running.day : null;
                  const days = tenth((Date.parse(s.lastAt) - Date.parse(s.firstAt)) / 86400000);
                  return (
                    <li key={s.sensorId}>
                      <span>
                        <strong>Sensor ending {s.sensorId.slice(-4)}</strong>
                        {s.source ? ` · ${s.source}` : ""}
                        {inUseDay !== null && (
                          <Badge variant="secondary">In use · day {inUseDay}</Badge>
                        )}
                      </span>
                      <span>
                        {dateTime.format(new Date(s.firstAt))} –{" "}
                        {dateTime.format(new Date(s.lastAt))} · {days} {days === 1 ? "day" : "days"}{" "}
                        of readings
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="cgm-history-empty">
                {clarity?.connected
                  ? "Clarity has not reported a sensor yet."
                  : "Connect Dexcom Clarity in Care tools › Dexcom · import to keep a sensor history."}
              </p>
            )}
          </div>
          <div className="cgm-history-part">
            <h3>Clarity reports on file</h3>
            {reports.length ? (
              <>
                <ul className="cgm-history-list">
                  {reports.map((report) => (
                    <li key={report.id}>
                      <span>
                        <strong>
                          {dayFormat.format(new Date(`${report.startDate}T12:00:00Z`))} –{" "}
                          {dayFormat.format(new Date(`${report.endDate}T12:00:00Z`))}
                        </strong>
                        {report.scheduled && <Badge variant="secondary">Monthly</Badge>}
                      </span>
                      <span>
                        {reportKindNames(report.reports)} · {formatSize(report.size)}
                      </span>
                      <a
                        className="button subtle"
                        href={`/api/clarity/report?id=${encodeURIComponent(report.id)}`}
                        download
                      >
                        Download
                      </a>
                    </li>
                  ))}
                </ul>
                <p className="cgm-history-note">
                  Make or delete reports in Care tools › Dexcom · import › Clarity sync.
                </p>
              </>
            ) : (
              <p className="cgm-history-empty">
                {clarity?.connected
                  ? "No Clarity reports archived yet. Make one in Care tools › Dexcom · import › Clarity sync, or turn on monthly reports there."
                  : "Connect Dexcom Clarity in Care tools › Dexcom · import to archive its PDF reports."}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
