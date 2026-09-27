import { test } from "bun:test";
import assert from "node:assert/strict";
import { createHoverIntent } from "../lib/hover-intent.ts";

// A manual clock: `tick(ms)` runs every scheduled callback that has come due.
function clock() {
  let now = 0;
  let jobs = [];
  return {
    schedule: (run, ms) => {
      const job = { at: now + ms, run };
      jobs.push(job);
      return () => {
        jobs = jobs.filter((j) => j !== job);
      };
    },
    tick(ms) {
      now += ms;
      const due = jobs.filter((j) => j.at <= now);
      jobs = jobs.filter((j) => j.at > now);
      for (const job of due) job.run();
    },
  };
}

function setup() {
  const time = clock();
  const calls = [];
  const intent = createHoverIntent((open) => calls.push(open), {
    openDelay: 70,
    closeDelay: 200,
    schedule: time.schedule,
  });
  return { time, calls, intent };
}

test("resting on the trigger opens the menu after the open delay", () => {
  const { time, calls, intent } = setup();
  intent.enter();
  time.tick(69);
  assert.deepEqual(calls, []);
  time.tick(1);
  assert.deepEqual(calls, [true]);
});

test("a pointer passing over the trigger never opens the menu", () => {
  const { time, calls, intent } = setup();
  intent.enter();
  time.tick(30);
  intent.leave();
  time.tick(500);
  assert.deepEqual(calls, [false]);
});

test("crossing from trigger to menu keeps it open", () => {
  const { time, calls, intent } = setup();
  intent.enter();
  time.tick(70);
  intent.leave();
  time.tick(150);
  intent.enter();
  time.tick(500);
  assert.deepEqual(calls, [true, true]);
});

test("leaving the menu closes it after the close delay", () => {
  const { time, calls, intent } = setup();
  intent.enter();
  time.tick(70);
  intent.leave();
  time.tick(199);
  assert.deepEqual(calls, [true]);
  time.tick(1);
  assert.deepEqual(calls, [true, false]);
});

test("cancel drops a pending change", () => {
  const { time, calls, intent } = setup();
  intent.enter();
  intent.cancel();
  time.tick(500);
  assert.deepEqual(calls, []);
});
