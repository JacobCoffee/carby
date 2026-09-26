import type { ReactNode } from "react";
import "./status-scene.css";

// Glucose (mg/dL) → SVG y. The plot spans 0–400 over y 240→40, so anything past the
// meter's 400 ceiling draws above the top rule, literally off the chart.
const y = (mgdl: number) => 240 - mgdl / 2;
const RANGE_LOW = 70;
const RANGE_HIGH = 180;
const CEILING = 400;

// Hand-placed sensor traces. Off-chart climbs out through the ceiling; signal-lost holds
// in range until the sensor drops out at x=300.
const OFF_CHART_TRACE =
  "M0 175 C40 175 70 184 110 172 S170 168 200 176 S260 170 290 158 S340 122 370 96 S420 52 440 40 S466 -4 480 -48";
const SIGNAL_TRACE = "M0 178 C40 180 70 170 110 166 S170 180 210 174 S270 160 300 164";

// Fingerstick drop, 28 units tall, tip at (0,-20), round base centered on the origin.
const DROP = "M0 -20 C6 -11 13 -3 13 5 A13 13 0 0 1 -13 5 C-13 -3 -6 -11 0 -20 Z";

type Variant = "off-chart" | "signal-lost";

function Trace({ variant }: { variant: Variant }) {
  return (
    <svg
      className="status-scene-chart"
      viewBox="0 -40 600 300"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <rect
        className="status-scene-band"
        x="0"
        y={y(RANGE_HIGH)}
        width="600"
        height={y(RANGE_LOW) - y(RANGE_HIGH)}
      />
      <line className="status-scene-rule" x1="0" x2="600" y1={y(RANGE_HIGH)} y2={y(RANGE_HIGH)} />
      <line className="status-scene-rule" x1="0" x2="600" y1={y(RANGE_LOW)} y2={y(RANGE_LOW)} />
      <line className="status-scene-ceiling" x1="0" x2="600" y1={y(CEILING)} y2={y(CEILING)} />
      <text className="status-scene-axis" x="594" y={y(CEILING) + 16} textAnchor="end">
        400
      </text>
      <text className="status-scene-axis" x="594" y={y(RANGE_HIGH) - 6} textAnchor="end">
        180
      </text>
      <text className="status-scene-axis" x="594" y={y(RANGE_LOW) + 16} textAnchor="end">
        70
      </text>
      {variant === "off-chart" ? (
        <>
          <path className="status-scene-trace" d={OFF_CHART_TRACE} pathLength={1} />
          <g transform={`translate(440 ${y(CEILING)})`}>
            <circle className="status-scene-ring status-scene-pulse" r="7" />
            <circle className="status-scene-dot" r="5" />
          </g>
          <g className="status-scene-flag" transform={`translate(386 ${y(CEILING) - 22})`}>
            <rect x="-30" y="-13" width="60" height="22" rx="11" />
            <text y="3" textAnchor="middle">
              HIGH
            </text>
          </g>
        </>
      ) : (
        <>
          <path className="status-scene-trace" d={SIGNAL_TRACE} pathLength={1} />
          <line className="status-scene-gap" x1="300" x2="480" y1="164" y2="164" />
          <circle className="status-scene-dot" cx="300" cy="164" r="4" />
          <g transform="translate(508 168)">
            <circle className="status-scene-ring status-scene-pulse" r="14" cy="3" />
            <path className="status-scene-drop" d={DROP} />
          </g>
        </>
      )}
    </svg>
  );
}

export default function StatusScene({
  variant,
  reading,
  status,
  title,
  children,
  actions,
  reference,
}: {
  variant: Variant;
  /** Big panel numeral, styled like the dashboard's current reading. */
  reading: string;
  /** Pill in the panel's top-right corner, e.g. "Page not found". */
  status: string;
  title: string;
  children: ReactNode;
  actions: ReactNode;
  reference?: string;
}) {
  return (
    <main className="status-scene">
      <div className="status-scene-body">
        <div className="status-scene-panel">
          <p className="status-scene-reading">
            <strong>{reading}</strong>
            <span>{status}</span>
          </p>
          <Trace variant={variant} />
        </div>
        <div className="status-scene-copy">
          <h1>{title}</h1>
          <p>{children}</p>
          <div className="status-scene-actions">{actions}</div>
          {reference ? <p className="status-scene-reference">Reference {reference}</p> : null}
        </div>
      </div>
    </main>
  );
}
