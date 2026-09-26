import { test } from "bun:test";
import assert from "node:assert/strict";
import { reminderAttention, remindersOpen } from "../lib/reminder-attention.ts";

const none = {
  correction: null,
  stillHigh: false,
  nightly: null,
  overnight: null,
  lowRecheck: null,
  sickDay: null,
};
const at = "2027-01-14T02:00:00.000Z";
const minutes = (n) => Date.parse(at) + n * 60_000;
const overnight = (state = "upcoming") => ({ at, state, reason: "plan" });

test("a reminder needs attention from 30 minutes before its time until 30 minutes after", () => {
  const keys = (n) => reminderAttention({ ...none, overnight: overnight(), now: minutes(n) });
  assert.deepEqual(keys(-31), []);
  assert.deepEqual(keys(-30), [`overnight:${at}`]);
  assert.deepEqual(keys(30), [`overnight:${at}`]);
  assert.deepEqual(keys(31), []);
});

test("logged and recovered reminders never need attention, even at their time", () => {
  const now = minutes(0);
  assert.deepEqual(reminderAttention({ ...none, overnight: overnight("logged"), now }), []);
  const nightly = { at, state: "logged", visible: true, logged: [] };
  assert.deepEqual(reminderAttention({ ...none, nightly, now }), []);
  const lowRecheck = { treatedAt: at, dueAt: at, state: "recovered" };
  assert.deepEqual(reminderAttention({ ...none, lowRecheck, now }), []);
});

test("urgent states need attention far from their time", () => {
  const now = minutes(600);
  const correction = { at, state: "passed", notice: "", menuLabel: "" };
  assert.deepEqual(reminderAttention({ ...none, correction, stillHigh: true, now }), [
    `correction:${at}:urgent`,
  ]);
  assert.deepEqual(reminderAttention({ ...none, overnight: overnight("missed"), now }), [
    `overnight:${at}:urgent`,
  ]);
  const sickDay = {
    illness: {},
    checks: {
      glucose: { lastAt: null, dueAt: at, overdue: true },
      ketones: { lastAt: null, dueAt: "2027-01-15T02:00:00.000Z", overdue: false },
    },
  };
  assert.deepEqual(reminderAttention({ ...none, sickDay, now }), [`sick-glucose:${at}:urgent`]);
});

test("collapsing acknowledges current reminders; a new or escalated one reopens the strip", () => {
  assert.equal(remindersOpen(null, []), true);
  const acknowledged = [`overnight:${at}`];
  assert.equal(remindersOpen(acknowledged, [`overnight:${at}`]), false);
  assert.equal(remindersOpen(acknowledged, []), false);
  assert.equal(remindersOpen(acknowledged, [`overnight:${at}:urgent`]), true);
  assert.equal(remindersOpen(acknowledged, ["overnight:2027-01-15T02:00:00.000Z"]), true);
});
