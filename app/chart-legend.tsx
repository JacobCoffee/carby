"use client";
import type { ReactNode } from "react";
import { Activity, Link2, Siren, Syringe, Utensils } from "lucide-react";

/** Everything on the glucose chart that can be hidden. The CGM line and the range band stay. */
export type ChartLayer =
  | "meter"
  | "status"
  | "food"
  | "links"
  | "rapid"
  | "long"
  | "exercise"
  | "rescue"
  | "device"
  | "review"
  | "nightly"
  | "estimate";

type LayerInfo = { layer: ChartLayer; label: string; swatch: ReactNode; title?: string };

const icon = (Icon: typeof Utensils, color: string) => (
  <Icon size={14} color={color} strokeWidth={2.6} aria-hidden="true" />
);

function layers(status: { high: boolean; low: boolean }, reviewHours: number) {
  const groups: { name: string; items: LayerInfo[] }[] = [
    {
      name: "Glucose",
      items: [
        {
          layer: "meter",
          label: "Logged",
          swatch: <i className="legend-dot" aria-hidden="true" />,
          title: "Finger-stick and manually entered readings",
        },
        {
          layer: "status",
          label: [status.high && "HIGH >400", status.low && "LOW <40"].filter(Boolean).join(" · "),
          swatch: <i className={status.high ? "legend-high" : "legend-low"} aria-hidden="true" />,
          title: "Past the sensor's limit: the exact value is unknown",
        },
        {
          layer: "estimate",
          label: "Similar days",
          swatch: <i className="legend-estimate" aria-hidden="true" />,
          title:
            "What followed a similar reading at this time on past days. Not a forecast or dosing advice.",
        },
      ],
    },
    {
      name: "Events",
      items: [
        { layer: "food", label: "Food", swatch: icon(Utensils, "var(--chart-linked-bg)") },
        {
          layer: "links",
          label: "Meal + dose",
          swatch: icon(Link2, "var(--chart-link-line)"),
          title: "Meals and doses logged together",
        },
        { layer: "rapid", label: "Rapid-acting", swatch: icon(Syringe, "var(--chart-alert-high)") },
        { layer: "long", label: "Long-acting", swatch: icon(Syringe, "var(--chart-device)") },
        { layer: "exercise", label: "Exercise", swatch: icon(Activity, "var(--chart-device)") },
        { layer: "rescue", label: "Rescue", swatch: icon(Siren, "var(--chart-alert-high)") },
        {
          layer: "device",
          label: "Dexcom events",
          swatch: (
            <svg className="legend-event-marker" viewBox="0 0 16 20" aria-hidden="true">
              <path d="M8 2 L3 9 L8 16 L13 9 Z" fill="var(--chart-device)" />
            </svg>
          ),
          title: "Calibrations and other events from the Dexcom app",
        },
      ],
    },
    {
      name: "Timing",
      items: [
        {
          layer: "review",
          label: "Correction review",
          swatch: <i className="legend-correction" aria-hidden="true" />,
          title: `${reviewHours} h after a correction dose. A timing reference, not a dose recommendation.`,
        },
        {
          layer: "nightly",
          label: "Nightly dose",
          swatch: <i className="legend-nightly" aria-hidden="true" />,
          title: "The scheduled long-acting time from your care plan",
        },
      ],
    },
  ];
  return groups;
}

/**
 * The chart's key, doubling as its layer switches: each chip shows or hides its marks, and
 * pointing at one (or focusing it) fades everything else on the chart so its marks stand out.
 */
export function ChartLegend({
  present,
  hidden,
  onToggle,
  onPreview,
  status,
  reviewHours,
  cgm,
  rangeLabel,
}: {
  /** Layers with something in the current view; the rest are left out of the key. */
  present: ReadonlySet<ChartLayer>;
  hidden: ReadonlySet<ChartLayer>;
  onToggle: (layer: ChartLayer) => void;
  onPreview: (layer: ChartLayer | null) => void;
  status: { high: boolean; low: boolean };
  reviewHours: number;
  cgm: boolean;
  rangeLabel: string;
}) {
  const groups = layers(status, reviewHours)
    .map((group) => ({ ...group, items: group.items.filter((i) => present.has(i.layer)) }))
    .filter((group) => group.items.length || group.name === "Glucose");
  return (
    <div className="chart-legend chart-layers" onMouseLeave={() => onPreview(null)}>
      {groups.map((group) => (
        <div className="chart-layer-group" key={group.name} role="group" aria-label={group.name}>
          <span className="chart-layer-group-name" aria-hidden="true">
            {group.name}
          </span>
          {group.name === "Glucose" && cgm && (
            <span className="chart-layer is-fixed">
              <i className="legend-line" aria-hidden="true" />
              CGM
            </span>
          )}
          {group.name === "Glucose" && (
            <span className="chart-layer is-fixed">
              <i className="legend-band" aria-hidden="true" />
              {rangeLabel}
            </span>
          )}
          {group.items.map((item) => {
            const shown = !hidden.has(item.layer);
            return (
              <button
                type="button"
                key={item.layer}
                className="chart-layer"
                aria-pressed={shown}
                title={`${shown ? "Hide" : "Show"} ${item.label.toLowerCase()}${item.title ? `. ${item.title}` : ""}`}
                onClick={() => onToggle(item.layer)}
                onMouseEnter={() => onPreview(shown ? item.layer : null)}
                onFocus={() => onPreview(shown ? item.layer : null)}
                onBlur={() => onPreview(null)}
              >
                {item.swatch}
                {item.label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
