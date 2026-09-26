import { afterEach, setSystemTime, test } from "bun:test";
import assert from "node:assert/strict";
import { illnessLabel } from "../lib/illness.ts";
import { profileSchema } from "../lib/profile.ts";

afterEach(() => setSystemTime());

const illness = {
  id: "11111111-1111-4111-8111-111111111111",
  startDate: "2026-09-22",
  endDate: "2026-09-24",
  timezone: "America/Chicago",
  note: "",
};

test("an illness logged in another zone names that zone; one in the plan zone does not", () => {
  assert.equal(illnessLabel(illness, "America/Chicago"), "Tue, Sep 22 – Thu, Sep 24");
  assert.equal(
    illnessLabel(illness, "Europe/London"),
    "Tue, Sep 22 – Thu, Sep 24 (America/Chicago)",
  );
  const oneDay = { ...illness, endDate: "2026-09-22" };
  assert.equal(illnessLabel(oneDay, "Asia/Tokyo"), "Tue, Sep 22 (America/Chicago)");
});

test("a diagnosis date that is already today somewhere ahead of UTC is accepted", () => {
  // 20:00 UTC on Sep 26 is already Sep 27 in Auckland and Kiritimati.
  setSystemTime(new Date("2026-09-26T20:00:00Z"));
  const profile = { id: illness.id, name: "Sam", role: "self" };
  assert.equal(profileSchema.safeParse({ ...profile, diagnosedOn: "2026-09-27" }).success, true);
  assert.equal(profileSchema.safeParse({ ...profile, diagnosedOn: "2026-09-28" }).success, false);
});
