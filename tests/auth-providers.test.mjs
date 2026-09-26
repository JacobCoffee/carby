import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  discordAvatarUrl,
  githubVerifiedEmail,
  normalizeDiscordProfile,
  normalizeGitHubProfile,
  normalizeGoogleProfile,
  profileIdentity,
} from "../lib/auth-providers.ts";

test("GitHub uses the primary verified email, then any verified one, never an unverified one", () => {
  const primary = { email: "primary@example.test", primary: true, verified: true };
  const other = { email: "other@example.test", primary: false, verified: true };
  const unverifiedPrimary = { email: "unverified@example.test", primary: true, verified: false };
  assert.deepEqual(githubVerifiedEmail([other, primary]), {
    email: "primary@example.test",
    emailVerified: true,
  });
  assert.deepEqual(githubVerifiedEmail([unverifiedPrimary, other]), {
    email: "other@example.test",
    emailVerified: true,
  });
  for (const emails of [[unverifiedPrimary], [], null, { message: "Bad credentials" }, [null, 3]]) {
    assert.deepEqual(githubVerifiedEmail(emails), { email: null, emailVerified: false });
  }
});

test("GitHub profiles use the numeric id as a string and fall back to the login name", () => {
  const profile = normalizeGitHubProfile({
    id: 9019718,
    login: "octo",
    name: null,
    email: "primary@example.test",
    emailVerified: true,
    avatar_url: "https://avatars.githubusercontent.com/u/9019718",
  });
  assert.deepEqual(profile, {
    id: "9019718",
    name: "octo",
    email: "primary@example.test",
    image: "https://avatars.githubusercontent.com/u/9019718",
    emailVerified: true,
  });
  const publicOnly = normalizeGitHubProfile({ id: 1, login: "octo", email: "public@example.test" });
  assert.equal(publicOnly.emailVerified, false);
  assert.throws(() => normalizeGitHubProfile({ login: "octo" }), TypeError);
});

test("Google trusts only a boolean email_verified claim", () => {
  const base = { sub: "104839", name: "Owner", email: "owner@example.test", picture: "https://p" };
  assert.deepEqual(normalizeGoogleProfile({ ...base, email_verified: true }), {
    id: "104839",
    name: "Owner",
    email: "owner@example.test",
    image: "https://p",
    emailVerified: true,
  });
  for (const email_verified of [false, "true", 1, undefined]) {
    assert.equal(normalizeGoogleProfile({ ...base, email_verified }).emailVerified, false);
  }
  assert.throws(() => normalizeGoogleProfile({ email: "owner@example.test" }), TypeError);
});

test("Discord avatars match the built-in provider's derivation", () => {
  const id = "80351110224678912";
  assert.equal(
    discordAvatarUrl({ id, avatar: null, discriminator: "0" }),
    `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(id) >> 22n) % 6}.png`,
  );
  assert.equal(
    discordAvatarUrl({ id, avatar: null, discriminator: "1337" }),
    "https://cdn.discordapp.com/embed/avatars/2.png",
  );
  assert.equal(
    discordAvatarUrl({ id, avatar: "a_1269e74af4df7417b13759eae50c83dc" }),
    `https://cdn.discordapp.com/avatars/${id}/a_1269e74af4df7417b13759eae50c83dc.gif`,
  );
  assert.equal(
    discordAvatarUrl({ id, avatar: "8342729096ea3675442027381ff50dfe" }),
    `https://cdn.discordapp.com/avatars/${id}/8342729096ea3675442027381ff50dfe.png`,
  );
});

test("Discord uses global_name first and trusts only verified === true", () => {
  const base = { id: "80351110224678912", username: "nelly", avatar: null, discriminator: "0" };
  const profile = normalizeDiscordProfile({
    ...base,
    global_name: "Nelly",
    email: "n@example.test",
    verified: true,
  });
  assert.equal(profile.id, "80351110224678912");
  assert.equal(profile.name, "Nelly");
  assert.equal(profile.emailVerified, true);
  assert.equal(
    normalizeDiscordProfile({ ...base, email: "n@example.test", verified: false }).emailVerified,
    false,
  );
  assert.equal(
    normalizeDiscordProfile({ ...base, email: null, verified: true }).emailVerified,
    false,
  );
  assert.equal(normalizeDiscordProfile({ ...base, global_name: null }).name, "nelly");
});

test("profileIdentity reads each provider's own raw fields and refuses unknown input", () => {
  assert.deepEqual(
    profileIdentity("google", {
      sub: "1",
      name: "G",
      email: "g@example.test",
      email_verified: true,
    }),
    { email: "g@example.test", emailVerified: true, displayName: "G" },
  );
  // A Google-style claim on a Discord profile is not Discord's verification flag.
  assert.equal(
    profileIdentity("discord", {
      id: "1",
      username: "d",
      email: "d@example.test",
      email_verified: true,
    }).emailVerified,
    false,
  );
  const none = { email: null, emailVerified: false, displayName: null };
  assert.deepEqual(
    profileIdentity("gitlab", { id: 1, email: "x@example.test", verified: true }),
    none,
  );
  assert.deepEqual(profileIdentity("github", undefined), none);
  assert.deepEqual(
    profileIdentity("github", { email: "x@example.test", emailVerified: true }),
    none,
  );
});
