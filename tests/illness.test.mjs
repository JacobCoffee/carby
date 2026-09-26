import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  illnessSchema,
  validateIllnessDates,
  illnessBounds,
  illnessOverlap,
  periodKind,
  isSick,
  periodKindLabels,
  periodKinds,
  endPeriodNow,
  withCheckIn,
  withoutCheckIn,
  illnessCheckInSchema,
  toCelsius,
  fromCelsius,
  formatTemperature,
  checkInDetails,
} from "../lib/illness.ts";
const illness = {
  id: "11111111-1111-4111-8111-111111111111",
  startDate: "2026-09-22",
  endDate: "2026-09-24",
  timezone: "America/Chicago",
  note: "Example",
};
const now = Date.parse("2026-09-25T20:00:00Z");
test("Tuesday through Thursday includes the whole final day and stops Friday", () => {
  const bounds = illnessBounds(illness, now);
  assert.equal(bounds.start, Date.parse("2026-09-22T05:00:00Z"));
  assert.equal(bounds.end, Date.parse("2026-09-25T05:00:00Z"));
  assert.ok(illnessOverlap(illness, Date.parse("2026-09-24T05:00:00Z"), bounds.end, now));
  assert.equal(illnessOverlap(illness, bounds.end, bounds.end + 86400000, now), null);
});
test("ongoing ends at now and clips to the visible chart window", () => {
  const open = { ...illness, endDate: null };
  assert.equal(illnessBounds(open, now).end, now);
  assert.deepEqual(illnessOverlap(open, now - 3600000, now + 3600000, now), {
    start: now - 3600000,
    end: now,
  });
});
test("ending an ongoing illness now stops it at this minute, not at the end of today", () => {
  const open = { ...illness, startTime: "16:00", endDate: null };
  const at = Date.parse("2026-09-26T20:31:40Z");
  const ended = endPeriodNow(open, at);
  assert.equal(ended.endDate, "2026-09-26");
  assert.equal(ended.endTime, "15:31");
  assert.equal(illnessSchema.safeParse(ended).success, true);
  validateIllnessDates(ended, at);
  assert.equal(illnessBounds(ended, at + 86400000).end, Date.parse("2026-09-26T20:31:00Z"));
  // An all-day period gains an end time too, so the rest of today is not counted as sick.
  const allDay = endPeriodNow({ ...illness, endDate: null }, at);
  assert.equal(illnessBounds(allDay, at).end, Date.parse("2026-09-26T20:31:00Z"));
});
test("illness retains original timezone and inclusive dates across DST", () => {
  const bounds = illnessBounds(
    { ...illness, startDate: "2026-11-01", endDate: "2026-11-01" },
    Date.parse("2026-11-03T00:00:00Z"),
  );
  assert.equal((bounds.end - bounds.start) / 3600000, 25);
  assert.deepEqual(
    illnessOverlap(
      illness,
      Date.parse("2026-09-25T00:00:00Z"),
      Date.parse("2026-09-26T00:00:00Z"),
      now,
    ),
    { start: Date.parse("2026-09-25T00:00:00Z"), end: Date.parse("2026-09-25T05:00:00Z") },
  );
});
test("reject invalid, reversed and future actual dates, accept ongoing", () => {
  assert.equal(illnessSchema.safeParse({ ...illness, startDate: "2026-02-30" }).success, false);
  assert.equal(illnessSchema.safeParse({ ...illness, endDate: "2026-09-21" }).success, false);
  assert.throws(() => validateIllnessDates({ ...illness, endDate: "2026-09-26" }, now));
  assert.doesNotThrow(() => validateIllnessDates({ ...illness, endDate: null }, now));
});

test("unresolvable local date is rejected and historical invalid data cannot crash a chart", () => {
  const invalid = {
    ...illness,
    startDate: "2011-12-30",
    endDate: "2011-12-31",
    timezone: "Pacific/Apia",
  };
  assert.throws(() => validateIllnessDates(invalid, now));
  assert.equal(illnessOverlap(invalid, 0, now, now), null);
});

test("a timed window starts and ends at the specified clock times", () => {
  const timed = {
    ...illness,
    startDate: "2026-09-22",
    startTime: "08:00",
    endDate: "2026-09-22",
    endTime: "15:30",
  };
  const bounds = illnessBounds(timed, now);
  assert.equal(bounds.start, Date.parse("2026-09-22T13:00:00Z"));
  assert.equal(bounds.end, Date.parse("2026-09-22T20:30:00Z"));
  assert.ok(illnessOverlap(timed, bounds.start, bounds.start + 60000, now));
  assert.equal(illnessOverlap(timed, bounds.end, bounds.end + 3600000, now), null);
});

test("same-day end time before start time is rejected", () => {
  assert.equal(
    illnessSchema.safeParse({
      ...illness,
      startDate: "2026-09-22",
      startTime: "15:00",
      endDate: "2026-09-22",
      endTime: "08:00",
    }).success,
    false,
  );
  assert.equal(
    illnessSchema.safeParse({
      ...illness,
      startDate: "2026-09-22",
      startTime: "08:00",
      endDate: "2026-09-22",
      endTime: "08:00",
    }).success,
    false,
  );
});

test("a start time later today than the current clock is rejected as future", () => {
  const todaySick = {
    ...illness,
    startDate: "2026-09-25",
    startTime: "23:00",
    endDate: null,
  };
  assert.throws(() => validateIllnessDates(todaySick, now));
  const okToday = { ...todaySick, startTime: "10:00" };
  assert.doesNotThrow(() => validateIllnessDates(okToday, now));
});

test("an old date-only record without time fields is unchanged", () => {
  const parsed = illnessSchema.safeParse(illness);
  assert.ok(parsed.success);
  assert.equal(parsed.data.startTime, undefined);
  assert.equal(parsed.data.endTime, undefined);
  const bounds = illnessBounds(illness, now);
  assert.equal(bounds.start, Date.parse("2026-09-22T05:00:00Z"));
  assert.equal(bounds.end, Date.parse("2026-09-25T05:00:00Z"));
});
test("an absent kind is an illness period; every other kind is explicit and excluded from sick-day logic", () => {
  assert.equal(periodKind(illness), "illness");
  assert.equal(isSick(illness), true);
  for (const kind of periodKinds) {
    const period = { ...illness, kind };
    assert.ok(illnessSchema.safeParse(period).success, kind);
    assert.equal(periodKind(period), kind);
    assert.equal(isSick(period), kind === "illness");
    assert.ok(periodKindLabels[kind]);
  }
  assert.equal(illnessSchema.safeParse({ ...illness, kind: "flu" }).success, false);
});

const checkIn = (at, extra = {}) => ({
  id: crypto.randomUUID(),
  at,
  symptoms: ["fever"],
  ...extra,
});

test("check-ins must fall inside the period and not in the future", () => {
  // Sep 22–24 in Chicago is 2026-09-22T05:00Z up to 2026-09-25T05:00Z.
  assert.equal(withCheckIn(illness, checkIn("2026-09-23T15:00:00Z"), now).checkIns?.length, 1);
  assert.throws(() => withCheckIn(illness, checkIn("2026-09-22T04:59:00Z"), now), /outside/);
  assert.throws(() => withCheckIn(illness, checkIn("2026-09-25T05:01:00Z"), now), /outside/);
  const open = { ...illness, endDate: null };
  assert.throws(() => withCheckIn(open, checkIn("2026-09-25T20:05:00Z"), now), /happened/);
});

test("a check-in logged in the minute before All better still fits the ended period", () => {
  const open = { ...illness, startTime: "16:00", endDate: null };
  const at = Date.parse("2026-09-26T20:31:40Z");
  const logged = withCheckIn(open, checkIn("2026-09-26T20:31:00Z"), at);
  const ended = endPeriodNow(logged, at);
  assert.doesNotThrow(() => validateIllnessDates(ended, at));
});

test("shortening a period past its check-ins is refused", () => {
  const withOne = withCheckIn(illness, checkIn("2026-09-24T15:00:00Z"), now);
  assert.throws(
    () => validateIllnessDates({ ...withOne, endDate: "2026-09-23" }, now),
    /check-in falls outside/,
  );
});

test("check-ins stay sorted, replace by id, and removing the last drops the field", () => {
  const late = checkIn("2026-09-24T15:00:00Z");
  const early = checkIn("2026-09-22T15:00:00Z");
  let period = withCheckIn(withCheckIn(illness, late, now), early, now);
  assert.deepEqual(
    period.checkIns?.map((c) => c.id),
    [early.id, late.id],
  );
  period = withCheckIn(period, { ...late, at: "2026-09-22T10:00:00Z" }, now);
  assert.deepEqual(
    period.checkIns?.map((c) => c.id),
    [late.id, early.id],
  );
  period = withoutCheckIn(withoutCheckIn(period, late.id), early.id);
  assert.equal("checkIns" in period, false);
  assert.equal(illnessSchema.safeParse(period).success, true);
});

test("a check-in records at least one detail; a zero vomiting count counts", () => {
  const empty = { id: crypto.randomUUID(), at: "2026-09-23T15:00:00Z", symptoms: [] };
  assert.equal(illnessCheckInSchema.safeParse(empty).success, false);
  assert.equal(illnessCheckInSchema.safeParse({ ...empty, vomited: 0 }).success, true);
  assert.equal(illnessSchema.safeParse({ ...illness, checkIns: [empty] }).success, false);
});

test("temperatures round-trip between °F entry and stored °C to one decimal", () => {
  for (let tenths = 950; tenths <= 1080; tenths++) {
    const f = tenths / 10;
    assert.equal(fromCelsius(toCelsius(f, "F"), "F"), f);
  }
  assert.equal(formatTemperature(toCelsius(101.3, "F"), "F"), "101.3 °F");
  assert.equal(formatTemperature(38.5, undefined), "38.5 °C");
});

test("check-in details read plainly, including no vomiting", () => {
  const c = {
    ...checkIn("2026-09-23T15:00:00Z", { symptoms: ["fever", "nausea"], vomited: 0 }),
    temperatureC: 38.5,
    fluids: "some",
    eating: "less",
  };
  assert.deepEqual(checkInDetails(c, "F"), [
    "101.3 °F",
    "Fever, Nausea",
    "No vomiting",
    "Keeping some fluids down",
    "Eating less",
  ]);
});
