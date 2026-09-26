"use client";
import { useSyncExternalStore } from "react";
import { timeZoneSchema } from "@/lib/care";

export const TIME_ZONE_LIST_ID = "carby-time-zones";
const noSubscription = () => () => {};
const NO_ZONES: string[] = [];
let zones: string[] | null = null;

/**
 * Suggestions for time zone inputs (`list={TIME_ZONE_LIST_ID}`). Filled on the client only: the
 * server's zone list can differ from the browser's, and a mismatch would break hydration.
 */
export function TimeZoneOptions() {
  const names = useSyncExternalStore(
    noSubscription,
    () => (zones ??= Intl.supportedValuesOf("timeZone")),
    () => NO_ZONES,
  );
  return (
    <datalist id={TIME_ZONE_LIST_ID}>
      {names.map((zone) => (
        <option key={zone} value={zone} />
      ))}
    </datalist>
  );
}

/** The zone this device is set to; null while rendering on the server. */
export function useDeviceTimeZone() {
  return useSyncExternalStore(
    noSubscription,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => null,
  );
}

/** Care-plan time zone: any IANA zone, with the device's zone one tap away when it differs. */
export default function TimeZoneField({
  value,
  onChange,
}: {
  value: string;
  onChange: (zone: string) => void;
}) {
  const device = useDeviceTimeZone();
  const valid = timeZoneSchema.safeParse(value).success;
  return (
    <div className="time-zone-field">
      <label className="field">
        <span>Time zone</span>
        <input
          required
          list={TIME_ZONE_LIST_ID}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!valid}
          aria-describedby="time-zone-hint"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <TimeZoneOptions />
      <p className="helper" id="time-zone-hint">
        {valid
          ? "Every view, reminder and report shows times in this zone."
          : "Choose a time zone from the list, such as America/Chicago."}
      </p>
      {device && device !== value && (
        <button type="button" className="text-button" onClick={() => onChange(device)}>
          Use this device’s zone ({device})
        </button>
      )}
    </div>
  );
}
