import { test } from "bun:test";
import assert from "node:assert/strict";
import { isAllowedOwner, parseAllowlist } from "../lib/auth-allowlist.ts";

test("allowlist entries split on commas, spaces, and newlines", () => {
  const allowlist = parseAllowlist({
    CARBY_ALLOWED_USERS: " github:9019718,discord:80351110224678912\n\tgoogle:1048 ,, ",
    CARBY_ALLOWED_EMAILS: "Owner@Example.TEST\ncare@example.test ,",
  });
  assert.deepEqual(
    [...allowlist.users],
    ["github:9019718", "discord:80351110224678912", "google:1048"],
  );
  assert.deepEqual([...allowlist.emails], ["owner@example.test", "care@example.test"]);
});

test("owner ids stay case-sensitive while emails compare case-insensitively", () => {
  const allowlist = parseAllowlist({
    CARBY_ALLOWED_USERS: "GitHub:ABC",
    CARBY_ALLOWED_EMAILS: "owner@example.test",
  });
  assert.equal(isAllowedOwner(allowlist, "GitHub:ABC", null, false), true);
  assert.equal(isAllowedOwner(allowlist, "github:abc", null, false), false);
  assert.equal(isAllowedOwner(allowlist, "github:1", "OWNER@example.TEST", true), true);
});

test("blank or missing lists parse to nothing", () => {
  for (const env of [{}, { CARBY_ALLOWED_USERS: "", CARBY_ALLOWED_EMAILS: "  \n , " }]) {
    const allowlist = parseAllowlist(env);
    assert.equal(allowlist.users.size, 0);
    assert.equal(allowlist.emails.size, 0);
  }
});

test("an allowlisted email admits only when the provider verified it", () => {
  const allowlist = parseAllowlist({
    CARBY_ALLOWED_USERS: "github:1",
    CARBY_ALLOWED_EMAILS: "owner@example.test",
  });
  const cases = [
    ["github:1", null, false, true],
    ["discord:2", "owner@example.test", true, true],
    ["discord:2", "owner@example.test", false, false],
    ["discord:2", null, true, false],
    ["discord:2", undefined, true, false],
    ["discord:2", "other@example.test", true, false],
    ["github:10", null, false, false],
  ];
  for (const [owner, email, verified, expected] of cases) {
    assert.equal(
      isAllowedOwner(allowlist, owner, email, verified),
      expected,
      JSON.stringify([owner, email, verified]),
    );
  }
});

test("with both lists empty, nobody is admitted", () => {
  const empty = parseAllowlist({});
  assert.equal(isAllowedOwner(empty, "github:1", "owner@example.test", true), false);
  assert.equal(isAllowedOwner(empty, "", null, false), false);
  assert.equal(isAllowedOwner(empty, "", "", true), false);
});

test("an email list alone admits only a verified matching email", () => {
  const emailsOnly = parseAllowlist({ CARBY_ALLOWED_EMAILS: "owner@example.test" });
  assert.equal(isAllowedOwner(emailsOnly, "github:1", "Owner@Example.test", true), true);
  assert.equal(isAllowedOwner(emailsOnly, "github:1", "owner@example.test", false), false);
  assert.equal(isAllowedOwner(emailsOnly, "github:1", "other@example.test", true), false);
  assert.equal(isAllowedOwner(emailsOnly, "github:1", null, true), false);
});

test("a user list alone admits only exact owner ids", () => {
  const usersOnly = parseAllowlist({ CARBY_ALLOWED_USERS: "github:1" });
  assert.equal(isAllowedOwner(usersOnly, "github:1", null, false), true);
  assert.equal(isAllowedOwner(usersOnly, "discord:2", "owner@example.test", true), false);
});
