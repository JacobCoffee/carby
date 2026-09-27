import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  can,
  chooseMembership,
  keepsAnOwner,
  inviteTokenHash,
  newInviteToken,
  peopleActionSchema,
} from "../lib/people.ts";

test("roles grant read, log and manage in order", () => {
  assert.deepEqual(
    ["read", "log", "manage"].map((need) => can("owner", need)),
    [true, true, true],
  );
  assert.deepEqual(
    ["read", "log", "manage"].map((need) => can("caregiver", need)),
    [true, true, false],
  );
  assert.deepEqual(
    ["read", "log", "manage"].map((need) => can("viewer", need)),
    [true, false, false],
  );
});

const two = [
  { person: "emma", role: "owner" },
  { person: "liam", role: "caregiver" },
];

test("a named person must be one of the account's", () => {
  assert.deepEqual(chooseMembership(two, { named: "liam", cookie: "emma", write: true }), {
    membership: two[1],
  });
  assert.deepEqual(chooseMembership(two, { named: "someone-else", cookie: null, write: false }), {
    status: 404,
  });
});

test("an unnamed write is refused once an account reaches more than one person", () => {
  assert.deepEqual(chooseMembership(two, { named: null, cookie: "liam", write: true }), {
    status: 409,
  });
  assert.deepEqual(chooseMembership([two[0]], { named: null, cookie: null, write: true }), {
    membership: two[0],
  });
});

test("an unnamed read follows the cookie, and ignores a cookie for someone else", () => {
  assert.equal(
    chooseMembership(two, { named: null, cookie: "liam", write: false }).membership.person,
    "liam",
  );
  assert.equal(
    chooseMembership(two, { named: null, cookie: "not-mine", write: false }).membership.person,
    "emma",
  );
  assert.deepEqual(chooseMembership([], { named: null, cookie: null, write: false }), {
    status: 404,
  });
});

test("the last owner can't be demoted or removed, but another owner can", () => {
  const members = [
    { account: "mom", role: "owner" },
    { account: "dad", role: "caregiver" },
  ];
  assert.equal(keepsAnOwner(members, "mom", "caregiver"), false);
  assert.equal(keepsAnOwner(members, "mom", null), false);
  assert.equal(keepsAnOwner(members, "dad", null), true);
  const coOwners = [...members, { account: "grandma", role: "owner" }];
  assert.equal(keepsAnOwner(coOwners, "mom", null), true);
});

test("invite tokens are long, url-safe, unique, and stored only as a hash", async () => {
  const a = newInviteToken();
  const b = newInviteToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  assert.equal(peopleActionSchema.safeParse({ action: "accept", token: a }).success, true);
  assert.match(await inviteTokenHash(a), /^[0-9a-f]{64}$/);
  assert.notEqual(await inviteTokenHash(a), a);
});
