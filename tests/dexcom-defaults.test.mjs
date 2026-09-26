import { test } from "bun:test";
import assert from "node:assert/strict";
import { publicDexcomDefaults, resolveDexcomCredentials } from "../lib/dexcom-defaults.ts";

const PASSWORD = "configured-password-value";
const scoped = {
  DEXCOM_USERNAME: "publisher@example.com",
  DEXCOM_PASSWORD: PASSWORD,
  DEXCOM_REGION: "ous",
  DEXCOM_DEFAULT_OWNER: "owner_a",
};
// The launcher variables scripts/local-runtime.mjs sets, and the only ones the fallback reads.
const localOnly = {
  DEXCOM_USERNAME: "publisher@example.com",
  DEXCOM_PASSWORD: PASSWORD,
  CARBY_AUTH_MODE: "local",
  CARBY_LOCAL_LAUNCHER: "1",
};

test("the configured owner sees the username and region but never the password", () => {
  const defaults = publicDexcomDefaults("owner_a", scoped);
  assert.deepEqual(defaults, {
    username: "publisher@example.com",
    region: "ous",
    hasPassword: true,
  });
  assert.equal(JSON.stringify(defaults).includes(PASSWORD), false);
  assert.equal(Object.keys(defaults).includes("password"), false);
});

test("another owner gets no defaults and cannot reuse the configured password", () => {
  assert.equal(publicDexcomDefaults("owner_b", scoped), null);
  assert.equal(publicDexcomDefaults("", scoped), null);
  const resolved = resolveDexcomCredentials(
    "owner_b",
    {
      username: "publisher@example.com",
      region: "ous",
      useConfiguredPassword: true,
    },
    scoped,
  );
  assert.deepEqual(resolved, {
    username: "publisher@example.com",
    password: "",
    region: "ous",
  });
});

test("the local owner fallback needs both launcher variables and the local owner", () => {
  assert.equal(publicDexcomDefaults("local_dev", localOnly)?.username, "publisher@example.com");
  // Each variable on its own opens nothing: the pair is the same one localSessionConfig requires.
  assert.equal(publicDexcomDefaults("local_dev", { ...localOnly, CARBY_AUTH_MODE: "oauth" }), null);
  assert.equal(publicDexcomDefaults("local_dev", { ...localOnly, CARBY_AUTH_MODE: "" }), null);
  assert.equal(
    publicDexcomDefaults("local_dev", { ...localOnly, CARBY_AUTH_MODE: undefined }),
    null,
  );
  assert.equal(
    publicDexcomDefaults("local_dev", { ...localOnly, CARBY_LOCAL_LAUNCHER: undefined }),
    null,
  );
  assert.equal(publicDexcomDefaults("local_dev", { ...localOnly, CARBY_LOCAL_LAUNCHER: "" }), null);
  assert.equal(
    publicDexcomDefaults("local_dev", { ...localOnly, CARBY_LOCAL_LAUNCHER: "0" }),
    null,
  );
  // The marker is the exact string "1", matching lib/local-session.ts rather than any truthy value.
  assert.equal(
    publicDexcomDefaults("local_dev", { ...localOnly, CARBY_LOCAL_LAUNCHER: "true" }),
    null,
  );
  assert.equal(publicDexcomDefaults("someone_else", localOnly), null);
  // A named owner replaces the fallback instead of widening it.
  assert.equal(
    publicDexcomDefaults("local_dev", { ...localOnly, DEXCOM_DEFAULT_OWNER: "owner_a" }),
    null,
  );
});

test("the built local preview keeps the defaults, and the build mode never decides on its own", () => {
  // `make start` serves the local preview as production, so NODE_ENV must not close the fallback.
  const preview = { ...localOnly, NODE_ENV: "production" };
  assert.equal(publicDexcomDefaults("local_dev", preview)?.username, "publisher@example.com");
  assert.equal(
    resolveDexcomCredentials(
      "local_dev",
      { username: "publisher@example.com", region: "us", useConfiguredPassword: true },
      preview,
    ).password,
    PASSWORD,
  );
  // A development build without the launcher variables is still nobody's local session. Only
  // scripts/local-runtime.mjs sets them, and scripts/serve-production.mjs refuses to boot with
  // either one, so no deployed OAuth user can reach these defaults.
  for (const mode of ["development", "test", "staging", "", undefined]) {
    const build = {
      ...localOnly,
      NODE_ENV: mode,
      CARBY_AUTH_MODE: undefined,
      CARBY_LOCAL_LAUNCHER: undefined,
    };
    assert.equal(publicDexcomDefaults("local_dev", build), null, `NODE_ENV=${mode} must not open`);
    assert.equal(
      resolveDexcomCredentials(
        "local_dev",
        { username: "publisher@example.com", region: "us", useConfiguredPassword: true },
        build,
      ).password,
      "",
      `NODE_ENV=${mode} must not reuse the configured password`,
    );
  }
});

test("the configured owner has to match verbatim", () => {
  assert.equal(
    publicDexcomDefaults("owner_a", { ...scoped, DEXCOM_DEFAULT_OWNER: " owner_a " }),
    null,
  );
  assert.equal(
    publicDexcomDefaults("owner_a", { ...scoped, DEXCOM_DEFAULT_OWNER: "Owner_A" }),
    null,
  );
  assert.equal(
    publicDexcomDefaults("owner_a", { ...scoped, DEXCOM_DEFAULT_OWNER: "owner_ab" }),
    null,
  );
  // A blank value names nobody, so it opens nothing on its own.
  assert.equal(publicDexcomDefaults("", { ...scoped, DEXCOM_DEFAULT_OWNER: " " }), null);
  assert.equal(publicDexcomDefaults("local_dev", { ...scoped, DEXCOM_DEFAULT_OWNER: " " }), null);
});

test("a session the local launcher did not create never reuses the configured password", () => {
  for (const environment of [
    { ...localOnly, CARBY_LOCAL_LAUNCHER: undefined },
    { ...localOnly, CARBY_AUTH_MODE: undefined },
    { ...localOnly, CARBY_AUTH_MODE: "oauth" },
  ]) {
    const resolved = resolveDexcomCredentials(
      "local_dev",
      {
        username: "publisher@example.com",
        region: "us",
        useConfiguredPassword: true,
      },
      environment,
    );
    assert.equal(resolved.password, "");
  }
});

test("a blank region falls back to us and an unusable region removes the defaults", () => {
  assert.equal(publicDexcomDefaults("owner_a", { ...scoped, DEXCOM_REGION: "" })?.region, "us");
  assert.equal(publicDexcomDefaults("owner_a", { ...scoped, DEXCOM_REGION: "  " })?.region, "us");
  assert.equal(publicDexcomDefaults("owner_a", { ...scoped, DEXCOM_REGION: "US" })?.region, "us");
  assert.equal(publicDexcomDefaults("owner_a", { ...scoped, DEXCOM_REGION: "eu" }), null);
  assert.equal(
    resolveDexcomCredentials(
      "owner_a",
      { username: "publisher@example.com", region: "eu", useConfiguredPassword: true },
      { ...scoped, DEXCOM_REGION: "eu" },
    ).password,
    "",
  );
});

test("a missing username means no defaults and no reuse", () => {
  assert.equal(publicDexcomDefaults("owner_a", { ...scoped, DEXCOM_USERNAME: "  " }), null);
  assert.equal(
    publicDexcomDefaults("owner_a", { ...scoped, DEXCOM_PASSWORD: "" })?.hasPassword,
    false,
  );
  assert.equal(
    resolveDexcomCredentials(
      "owner_a",
      { username: "publisher@example.com", region: "ous", useConfiguredPassword: true },
      { ...scoped, DEXCOM_PASSWORD: "" },
    ).password,
    "",
  );
});

test("the scoped owner reuses the configured password only when it asks by name", () => {
  const request = { username: "publisher@example.com", region: "ous" };
  assert.deepEqual(
    resolveDexcomCredentials("owner_a", { ...request, useConfiguredPassword: true }, scoped),
    {
      username: "publisher@example.com",
      password: PASSWORD,
      region: "ous",
    },
  );
  // Configured variables alone connect nothing.
  assert.equal(resolveDexcomCredentials("owner_a", request, scoped).password, "");
  assert.equal(resolveDexcomCredentials("owner_a", {}, scoped).password, "");
  for (const value of ["true", 1, "1", "on", {}])
    assert.equal(
      resolveDexcomCredentials("owner_a", { ...request, useConfiguredPassword: value }, scoped)
        .password,
      "",
      `useConfiguredPassword must be the boolean true, not ${JSON.stringify(value)}`,
    );
});

test("a typed password overrides the configured one", () => {
  const resolved = resolveDexcomCredentials(
    "owner_a",
    {
      username: "publisher@example.com",
      password: "typed-by-hand",
      region: "ous",
      useConfiguredPassword: true,
    },
    scoped,
  );
  assert.equal(resolved.password, "typed-by-hand");
});

test("a different username or region stops the reuse", () => {
  const cases = [
    { username: "someone.else@example.com", region: "ous" },
    { username: "Publisher@example.com", region: "ous" },
    { username: "publisher@example.com", region: "us" },
    { username: "publisher@example.com", region: "jp" },
  ];
  for (const request of cases) {
    const resolved = resolveDexcomCredentials(
      "owner_a",
      { ...request, useConfiguredPassword: true },
      scoped,
    );
    assert.equal(resolved.password, "", `${request.username} / ${request.region} must not reuse`);
    assert.equal(resolved.username, request.username);
    assert.equal(resolved.region, request.region);
  }
});

test("submitted values survive resolution and blank fields fall back to the defaults", () => {
  assert.deepEqual(
    resolveDexcomCredentials(
      "owner_a",
      { username: "  spaced@example.com  ", region: "JP" },
      scoped,
    ),
    { username: "spaced@example.com", password: "", region: "jp" },
  );
  // Blank fields fall back for the connect call, but an unnamed account never reuses the password.
  assert.deepEqual(resolveDexcomCredentials("owner_a", { useConfiguredPassword: true }, scoped), {
    username: "publisher@example.com",
    password: "",
    region: "ous",
  });
  assert.equal(
    resolveDexcomCredentials(
      "owner_a",
      { username: "publisher@example.com", useConfiguredPassword: true },
      scoped,
    ).password,
    "",
  );
  // Without defaults, nothing is invented for the caller to validate.
  assert.deepEqual(resolveDexcomCredentials("owner_b", {}, scoped), {
    username: "",
    password: "",
    region: "",
  });
});

test("non-string request fields cannot smuggle a value through", () => {
  const resolved = resolveDexcomCredentials(
    "owner_a",
    { username: 42, password: { toString: () => PASSWORD }, region: ["ous"] },
    scoped,
  );
  assert.deepEqual(resolved, {
    username: "publisher@example.com",
    password: "",
    region: "ous",
  });
});

test("no environment at all resolves to empty credentials", () => {
  assert.equal(publicDexcomDefaults("owner_a", {}), null);
  assert.deepEqual(resolveDexcomCredentials("owner_a", { useConfiguredPassword: true }, {}), {
    username: "",
    password: "",
    region: "",
  });
});
