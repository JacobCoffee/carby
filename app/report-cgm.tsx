"use client";
import { useEffect, useState } from "react";
import {
  currentSensor,
  describeAlert,
  type CgmSummaryResponse,
  type SensorSession,
} from "@/lib/cgm-summary";
import type { ClarityStatus } from "@/lib/clarity-sync";
import { AGP_MIN_DAYS, AGP_MIN_WEAR_PERCENT } from "@/lib/glucose-metrics";
import { CARE_CHANGED } from "@/lib/live-refresh";
import { AgpChart, LevelsBar } from "./cgm-overview";
import { reportKindNames } from "./clarity-panel";

type Loaded =
  | { key: string; summary: CgmSummaryResponse; clarity: ClarityStatus | null }
  | { key: string; error: string };

const dayFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
});
const reportDay = (day: string) => dayFormat.format(new Date(`${day}T12:00:00Z`));

/**
 * The consensus CGM page of the clinician report: five ranges, GMI and variability, the daily
 * profile, low and high episodes, and the CGM's own settings as Clarity last reported them.
 */
export default function ReportCgm({
  fromDay,
  toDay,
  timezone,
  showCharts,
  now,
}: {
  fromDay: string;
  toDay: string;
  timezone: string;
  showCharts: boolean;
  now: number;
}) {
  // The server buckets days in the saved plan's zone, so a zone change (or a Clarity sync, which
  // also announces CARE_CHANGED) must refetch rather than keep the old figures.
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const refresh = () => setClock(Date.now());
    window.addEventListener(CARE_CHANGED, refresh);
    return () => window.removeEventListener(CARE_CHANGED, refresh);
  }, []);
  const key = `${fromDay}|${toDay}|${timezone}|${clock}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const json = async <T,>(url: string) => {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      const data = (await response.json().catch(() => ({}))) as T & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "CGM summary is unavailable.");
      return data;
    };
    Promise.all([
      json<CgmSummaryResponse>(`/api/cgm/summary?start=${fromDay}&end=${toDay}`),
      // Without Clarity the report still has its CGM figures; only the PDF list is missing.
      json<ClarityStatus>("/api/clarity").catch(() => null),
    ])
      .then(([summary, clarity]) => setLoaded({ key, summary, clarity }))
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setLoaded({ key, error: e instanceof Error ? e.message : "CGM summary is unavailable." });
      });
    return () => controller.abort();
  }, [fromDay, toDay, key]);

  if (!loaded || loaded.key !== key)
    return (
      <section className="report-section report-cgm">
        <h3>Standard CGM metrics</h3>
        <p className="report-caption">Loading…</p>
      </section>
    );
  if ("error" in loaded)
    return (
      <section className="report-section report-cgm">
        <h3>Standard CGM metrics</h3>
        <p className="report-caption">{loaded.error}</p>
      </section>
    );
  const { summary, clarity } = loaded;
  const m = summary.metrics;
  const lows = summary.episodes.filter((e) => e.kind === "low"),
    highs = summary.episodes.filter((e) => e.kind === "high");
  const rangeStart = Date.parse(`${fromDay}T00:00:00Z`) - 86400000,
    rangeEnd = Date.parse(`${toDay}T00:00:00Z`) + 2 * 86400000;
  // Sensors worn at any point in the report's dates (a day's margin covers the time zone).
  const sensors = summary.sensors.filter(
    (s: SensorSession) => Date.parse(s.lastAt) >= rangeStart && Date.parse(s.firstAt) <= rangeEnd,
  );
  const running = currentSensor(summary.sensors, now);
  const pdfs = (clarity?.reports ?? []).filter((r) => r.startDate <= toDay && r.endDate >= fromDay);
  const localDay = (at: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(at));
  return (
    <section className="report-section report-cgm">
      <h3>Standard CGM metrics</h3>
      <p className="report-caption">
        International consensus ranges from exact CGM samples. HIGH and LOW samples count toward the
        highest or lowest range. CGM active {m.wearPercent}% of {m.days} days
        {m.wearPercent < AGP_MIN_WEAR_PERCENT
          ? "; below 70%, so these figures may not represent the period"
          : ""}
        .
      </p>
      {m.levels ? (
        <LevelsBar levels={m.levels} />
      ) : (
        <p className="report-caption">No connected CGM intervals.</p>
      )}
      <dl className="report-cgm-figures">
        <div>
          <dt>Mean glucose</dt>
          <dd>{m.mean === null ? "—" : `${m.mean} mg/dL`}</dd>
        </div>
        <div>
          <dt>GMI</dt>
          <dd>{m.gmi === null ? "—" : `${m.gmi}%`}</dd>
        </div>
        <div>
          <dt>Coefficient of variation</dt>
          <dd>{m.cv === null ? "—" : `${m.cv}%`}</dd>
        </div>
        <div>
          <dt>Lows ≥15 min</dt>
          <dd>
            {lows.length} <small>({lows.filter((e) => e.severe).length} below 54)</small>
          </dd>
        </div>
        <div>
          <dt>Highs ≥15 min</dt>
          <dd>
            {highs.length} <small>({highs.filter((e) => e.severe).length} above 250)</small>
          </dd>
        </div>
      </dl>
      {m.hiddenReason === "capped" && (
        <p className="report-caption">
          Mean, GMI and variation are not shown: {m.cappedPercent}% of samples were HIGH or LOW with
          no exact value, so an average would understate the true level.
        </p>
      )}
      {showCharts && (
        <div className="report-cgm-agp">
          <h4>Ambulatory glucose profile</h4>
          <p className="report-caption">
            Median, 25–75% and 5–95% of samples by time of day.
            {m.agpReady
              ? ""
              : ` Preview only: a standard profile needs ${AGP_MIN_DAYS} days with ${AGP_MIN_WEAR_PERCENT}% CGM wear.`}
          </p>
          <AgpChart slots={summary.agp} />
        </div>
      )}
      <div className="report-cgm-device">
        <div>
          <h4>CGM and alert settings</h4>
          {summary.device ? (
            <>
              <p className="report-caption">
                {[summary.device.model, summary.device.sensor].filter(Boolean).join(" · ") ||
                  "Device not named"}
                , as last reported by Dexcom Clarity.
              </p>
              <ul>
                {summary.device.alerts.map((alert) => (
                  <li key={alert.kind}>{describeAlert(alert)}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="report-caption">
              Connect Dexcom Clarity to include the CGM’s alert settings.
            </p>
          )}
        </div>
        <div>
          <h4>Sensors in this period</h4>
          {sensors.length ? (
            <ul>
              {sensors.map((s) => (
                <li key={s.sensorId}>
                  Sensor ending {s.sensorId.slice(-4)}: {reportDay(localDay(s.firstAt))} –{" "}
                  {reportDay(localDay(s.lastAt))}
                  {running?.sensorId === s.sensorId && running.inUse
                    ? ` · day ${running.day}, in use`
                    : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="report-caption">No sensor details from Clarity for these dates.</p>
          )}
        </div>
      </div>
      {pdfs.length > 0 && (
        <div className="report-cgm-pdfs">
          <h4>Dexcom Clarity reports on file</h4>
          <ul>
            {pdfs.map((pdf) => (
              <li key={pdf.id}>
                <a href={`/api/clarity/report?id=${encodeURIComponent(pdf.id)}`} download>
                  {reportDay(pdf.startDate)} – {reportDay(pdf.endDate)}
                </a>{" "}
                · {reportKindNames(pdf.reports)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
