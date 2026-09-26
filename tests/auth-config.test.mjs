import { test } from "bun:test";
import assert from "node:assert/strict";
import { encode } from "@auth/core/jwt";
import {
  authRedirectUrl,
  buildAuthConfig,
  configuredProviderIds,
  oauthSessionUser,
} from "../lib/auth-config.ts";

const origin = "https://carby.example.test";
const secret = "synthetic-auth-secret-".padEnd(48, "x");
const cookieName = "__Secure-authjs.session-token";
const env = {
  APP_URL: origin,
  AUTH_SECRET: secret,
  AUTH_GITHUB_ID: "synthetic-github-id",
  AUTH_GITHUB_SECRET: "synthetic-github-secret",
  AUTH_DISCORD_ID: "synthetic-discord-id",
  AUTH_DISCORD_SECRET: "synthetic-discord-secret",
  CARBY_ALLOWED_USERS: "github:9019718",
  CARBY_ALLOWED_EMAILS: "owner@example.test",
};
const githubAccount = { type: "oauth", provider: "github", providerAccountId: "9019718" };
const discordAccount = {
  type: "oauth",
  provider: "discord",
  providerAccountId: "80351110224678912",
};
const githubProfile = {
  id: 9019718,
  login: "octo",
  name: "Octo Owner",
  email: "owner@example.test",
  emailVerified: true,
};
const discordProfile = {
  id: "80351110224678912",
  username: "nelly",
  global_name: "Nelly",
  email: "owner@example.test",
  verified: true,
  avatar: null,
  discriminator: "0",
};

function providerIds(config) {
  return config.providers.map((provider) => provider.id);
}

function signIn(config, account, profile) {
  return config.callbacks.signIn({ account, profile, user: {} });
}

async function sessionCookie(token, options = {}) {
  const value = await encode({
    token,
    secret: options.secret ?? secret,
    salt: options.salt ?? cookieName,
    maxAge: options.maxAge,
  });
  return `${options.name ?? cookieName}=${value}`;
}

const ownerToken = {
  ownerId: "github:9019718",
  displayName: "Octo Owner",
  email: null,
  emailVerified: false,
};

test("OAuth stays off without a strong secret, a valid APP_URL, and one full provider", () => {
  for (const override of [
    { AUTH_SECRET: undefined },
    { AUTH_SECRET: "   " },
    { AUTH_SECRET: "too-short" },
    { APP_URL: undefined },
    { APP_URL: "" },
    { APP_URL: "not a url" },
    { APP_URL: "ftp://carby.example.test" },
    { AUTH_GITHUB_ID: undefined, AUTH_DISCORD_SECRET: "" },
    { AUTH_GITHUB_SECRET: " ", AUTH_DISCORD_ID: "\n" },
  ]) {
    const partial = { ...env, ...override };
    assert.equal(buildAuthConfig(partial), null, JSON.stringify(override));
    assert.deepEqual(configuredProviderIds(partial), [], JSON.stringify(override));
  }
});

test("only providers with both credentials are configured, in a fixed order", () => {
  const config = buildAuthConfig(env);
  assert.equal(config.trustHost, true);
  assert.equal(config.basePath, "/api/auth");
  assert.equal(config.secret, secret);
  assert.equal(config.useSecureCookies, true);
  assert.equal(config.session.strategy, "jwt");
  assert.equal(config.pages.signIn, "/signin");
  assert.deepEqual(providerIds(config), ["github", "discord"]);
  assert.deepEqual(configuredProviderIds(env), ["github", "discord"]);

  const all = {
    ...env,
    AUTH_GOOGLE_ID: "synthetic-google-id",
    AUTH_GOOGLE_SECRET: "synthetic-google-secret",
  };
  assert.deepEqual(providerIds(buildAuthConfig(all)), ["github", "google", "discord"]);
  assert.deepEqual(configuredProviderIds(all), ["github", "google", "discord"]);
  const googleOnly = { ...all, AUTH_GITHUB_ID: "", AUTH_DISCORD_SECRET: undefined };
  assert.deepEqual(providerIds(buildAuthConfig(googleOnly)), ["google"]);

  const plainHttp = buildAuthConfig({ ...env, APP_URL: "http://localhost:8080" });
  assert.equal(plainHttp.useSecureCookies, false);
});

test("signIn admits allowlisted owners and provider-verified allowlisted emails only", async () => {
  const config = buildAuthConfig(env);
  assert.equal(
    await signIn(config, githubAccount, { ...githubProfile, email: null, emailVerified: false }),
    true,
  );
  assert.equal(await signIn(config, discordAccount, discordProfile), true);
  assert.equal(await signIn(config, discordAccount, { ...discordProfile, verified: false }), false);
  assert.equal(
    await signIn(
      config,
      { ...githubAccount, providerAccountId: "1" },
      { ...githubProfile, emailVerified: false },
    ),
    false,
  );
  assert.equal(
    await signIn(config, { ...githubAccount, providerAccountId: "1" }, { ...githubProfile, id: 1 }),
    true,
  );
  for (const account of [
    null,
    undefined,
    { ...githubAccount, type: "credentials" },
    { ...githubAccount, type: "email" },
    { ...githubAccount, provider: "gitlab" },
    { ...githubAccount, providerAccountId: "" },
  ]) {
    assert.equal(await signIn(config, account, githubProfile), false, JSON.stringify(account));
  }
});

test("two providers with the same email are separate owners and are never linked", async () => {
  const usersOnly = buildAuthConfig({ ...env, CARBY_ALLOWED_EMAILS: "" });
  assert.equal(await signIn(usersOnly, githubAccount, githubProfile), true);
  assert.equal(await signIn(usersOnly, discordAccount, discordProfile), false);

  const config = buildAuthConfig(env);
  const github = await config.callbacks.jwt({
    token: {},
    account: githubAccount,
    profile: githubProfile,
  });
  const discord = await config.callbacks.jwt({
    token: {},
    account: discordAccount,
    profile: discordProfile,
  });
  assert.equal(github.ownerId, "github:9019718");
  assert.equal(discord.ownerId, "discord:80351110224678912");
});

test("an email list without a user list admits only verified matching emails", async () => {
  const config = buildAuthConfig({ ...env, CARBY_ALLOWED_USERS: " " });
  assert.equal(await signIn(config, githubAccount, githubProfile), true);
  assert.equal(await signIn(config, discordAccount, discordProfile), true);
  assert.equal(await signIn(config, discordAccount, { ...discordProfile, verified: false }), false);
  assert.equal(
    await signIn(config, discordAccount, { ...discordProfile, email: "other@example.test" }),
    false,
  );

  const empty = buildAuthConfig({ ...env, CARBY_ALLOWED_USERS: " ", CARBY_ALLOWED_EMAILS: "" });
  assert.equal(await signIn(empty, githubAccount, githubProfile), false);
  assert.equal(await signIn(empty, discordAccount, discordProfile), false);
});

test("the session token holds only the owner, display name, and email verification", async () => {
  const config = buildAuthConfig(env);
  const token = await config.callbacks.jwt({
    token: {
      name: "Octo Owner",
      email: "owner@example.test",
      picture: "https://p",
      sub: "random-uuid",
    },
    account: { ...githubAccount, access_token: "gho_synthetic" },
    profile: githubProfile,
  });
  assert.deepEqual(token, {
    ownerId: "github:9019718",
    displayName: "Octo Owner",
    email: "owner@example.test",
    emailVerified: true,
  });
  const existing = { ...ownerToken, iat: 1, exp: 2 };
  assert.equal(await config.callbacks.jwt({ token: existing }), existing);
  assert.equal(
    await config.callbacks.jwt({ token: {}, account: { ...githubAccount, type: "credentials" } }),
    null,
  );
});

test("a session read with no new sign-in drops tokens the allowlist no longer admits", async () => {
  const revoked = buildAuthConfig({ ...env, CARBY_ALLOWED_USERS: "github:1" });
  assert.equal(await revoked.callbacks.jwt({ token: { ...ownerToken } }), null);
  const config = buildAuthConfig(env);
  assert.equal(await config.callbacks.jwt({ token: { displayName: "No owner" } }), null);
  const byEmail = { ownerId: "discord:2", email: "owner@example.test", emailVerified: true };
  assert.equal(await config.callbacks.jwt({ token: byEmail }), byEmail);
  assert.equal(await config.callbacks.jwt({ token: { ...byEmail, emailVerified: false } }), null);
});

test("redirects stay on this origin", () => {
  for (const [url, expected] of [
    ["/?view=log", `${origin}/?view=log`],
    [`${origin}/?view=log#today`, `${origin}/?view=log#today`],
    [`${origin}/signin`, `${origin}/signin`],
    ["/signin?return_to=%2F", `${origin}/`],
    ["/signout", `${origin}/`],
    ["/api/auth/signout", `${origin}/`],
    ["//evil.example.com/x", `${origin}/`],
    ["https://evil.example.com/", origin],
    ["https://carby.example.test.evil.example/", origin],
    ["http://carby.example.test/", origin],
    ["javascript:alert(1)", origin],
    ["not a url", origin],
  ]) {
    assert.equal(authRedirectUrl(url, origin), expected, url);
  }
});

test("a genuine session cookie round-trips to the owner", async () => {
  const cookie = await sessionCookie(ownerToken);
  assert.deepEqual(await oauthSessionUser(new Headers({ cookie }), env), {
    userId: "github:9019718",
    displayName: "Octo Owner",
  });
  const unnamed = await sessionCookie({ ...ownerToken, displayName: "" });
  assert.deepEqual(await oauthSessionUser(new Headers({ cookie: unnamed }), env), {
    userId: "github:9019718",
    displayName: "github:9019718",
  });
});

test("removing an allowlist entry revokes an existing session at once", async () => {
  const cookie = await sessionCookie(ownerToken);
  assert.equal(
    await oauthSessionUser(new Headers({ cookie }), { ...env, CARBY_ALLOWED_USERS: "github:1" }),
    null,
  );
  assert.equal(
    await oauthSessionUser(new Headers({ cookie }), { ...env, CARBY_ALLOWED_USERS: "" }),
    null,
  );

  const byEmail = await sessionCookie({
    ownerId: "discord:80351110224678912",
    displayName: "Nelly",
    email: "Owner@Example.test",
    emailVerified: true,
  });
  assert.equal(
    (await oauthSessionUser(new Headers({ cookie: byEmail }), env)).userId,
    "discord:80351110224678912",
  );
  assert.equal(
    await oauthSessionUser(new Headers({ cookie: byEmail }), { ...env, CARBY_ALLOWED_EMAILS: "" }),
    null,
  );
  assert.equal(
    (await oauthSessionUser(new Headers({ cookie: byEmail }), { ...env, CARBY_ALLOWED_USERS: "" }))
      .userId,
    "discord:80351110224678912",
  );
  assert.equal(
    await oauthSessionUser(new Headers({ cookie: byEmail }), {
      ...env,
      CARBY_ALLOWED_USERS: "",
      CARBY_ALLOWED_EMAILS: "",
    }),
    null,
  );
  const unverified = await sessionCookie({
    ownerId: "discord:2",
    email: "owner@example.test",
    emailVerified: "true",
  });
  assert.equal(await oauthSessionUser(new Headers({ cookie: unverified }), env), null);
});

test("forged, tampered, expired, and misplaced session tokens are rejected", async () => {
  const valid = await sessionCookie(ownerToken);
  const value = valid.slice(cookieName.length + 1);
  const flipped = `${value.slice(0, -5)}${value.at(-5) === "A" ? "B" : "A"}${value.slice(-4)}`;
  const cookies = [
    `${cookieName}=${flipped}`,
    `${cookieName}=garbage`,
    `${cookieName}=`,
    await sessionCookie(ownerToken, { secret: "another-synthetic-secret-".padEnd(48, "y") }),
    await sessionCookie(ownerToken, { maxAge: -60 }),
    await sessionCookie(ownerToken, { name: "authjs.session-token", salt: "authjs.session-token" }),
    await sessionCookie({ displayName: "No owner", email: null, emailVerified: false }),
    await sessionCookie({ ...ownerToken, ownerId: 9019718 }),
  ];
  for (const cookie of cookies) {
    assert.equal(await oauthSessionUser(new Headers({ cookie }), env), null, cookie.slice(0, 60));
  }
  assert.equal(
    await oauthSessionUser(new Headers({ authorization: `Bearer ${value}` }), env),
    null,
  );
  assert.equal(
    await oauthSessionUser(new Headers({ cookie: valid }), { ...env, AUTH_SECRET: "" }),
    null,
  );
  assert.equal(
    await oauthSessionUser(new Headers({ cookie: valid }), { ...env, APP_URL: "" }),
    null,
  );
});
