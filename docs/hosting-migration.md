# Deployment prerequisites for real care data

Carby is a public, general-purpose diabetes care dashboard. The source ships no care plan, prescription, or food list, so a new deployment starts empty and asks for setup first.

**Carby is not a medical device.** Nobody has given it a production security or hosting review, and nobody has deployed it to a production host. Use synthetic data only, and keep each deployment's audience restricted until a host meets the requirements below.

## What the current source provides

The runtime pieces a host needs now exist in the repository. They have not been exercised in a deployment.

- **Server runtime.** A plain Node.js process, `scripts/serve-production.mjs`, serving the vinext build from `dist/`. No platform-specific runtime module.
- **Shared persistent storage.** PostgreSQL through `DATABASE_URL`, reached by `db/postgres.ts`. Every replica shares one database, and the app keeps no care data on local disk.
- **Migrations.** `postgres/*.sql`, applied by `scripts/migrate.mjs` under a PostgreSQL advisory lock with a `schema_migrations` table, each file in its own transaction. The `Procfile`'s `release` process runs it once per deploy.
- **Production sign-in.** `@auth/core` with GitHub, Google, and Discord. Sign-in denies by default: an exact `provider:subject` entry in `CARBY_ALLOWED_USERS` or a provider-verified address in `CARBY_ALLOWED_EMAILS` admits a person, and leaving both lists empty denies everyone. Carby rechecks both lists on every session read, so a person keeps access only while some entry still admits them.
- **Configuration and secrets from the environment.** `APP_URL`, `DATABASE_URL`, `AUTH_SECRET`, the provider pairs, the allowlists, and `DEXCOM_SECRET_KEY` are all read at process start. `scripts/serve-production.mjs` refuses to start on a missing or malformed value, and refuses outright if the local-only sign-in variables are present.
- **Socket-bound web process.** `scripts/start-web` runs the app on `127.0.0.1:$PORT` and bridges `$CABOTAGE_SOCKET` (default `/var/run/cabotage/cabotage.sock`) to it with `socat`.
- **Health endpoint.** `GET /_health/` returns `200 ok` with no sign-in and no database work, answered ahead of the request pipeline.
- **Container.** `Dockerfile` builds on `node:22-slim` and runs as the non-root user `carby` (uid 10001).

Feature-level notes:

- The 14-day provider report distinguishes HIGH/LOW without fabricated values; calories are not derived from statuses. Device calibration events are counted alongside coverage, food, and administered insulin.
- The owner's handoff dialog can download a static HTML snapshot or print to PDF. A downloaded copy opens without an account, and possession of a copy is its only access control. It cannot be revoked or kept current after sharing.
- `care_audit` records actor, old and new values, and time for manual entries and calculated-dose records, and `/api/audit` lists the owner's change history. Prior edits are not backfilled.
- The Dexcom Share connection stores `last_attempt_at`, `last_sync`, `latest_reading_at`, `last_error`, and `share_paused_until`. Carby connects to Dexcom only when a signed-in user asks it to; no scheduled sync process ships with the app. Share is called at most once a minute per connection, manual syncs included, and not at all while a Dexcom rate limit pause is in effect.

## Required before live release

1. **Review and agreements.** Select a host and identity provider appropriate for the actual health data being stored (including a minor's data, if applicable), with an appropriate data agreement, retention controls, encryption, and incident response. Commission the security and hosting review Carby has not had. Confirm hosting and Dexcom API terms. Do not send credentials in messages or commit them to source.
2. **Secrets management.** Hold `AUTH_SECRET`, `DATABASE_URL`, `DEXCOM_SECRET_KEY`, `DEXCOM_PASSWORD`, and every OAuth client secret in the host's secret store, not in plain configuration. `AUTH_SECRET` and `DEXCOM_SECRET_KEY` are independent secrets and must differ. Decide how each rotates: rotating `AUTH_SECRET` signs everyone out, while rotating `DEXCOM_SECRET_KEY` makes every stored Dexcom sign-in undecryptable and forces every account to reconnect.
3. **Database operations.** Provision PostgreSQL with backups, point-in-time recovery, and encryption at rest, and restrict network access to the app. Confirm the `release` process runs before the new `web` process takes traffic, and test a migration failure and a rollback.
4. **Data migration with validation.** Apply every pending `postgres/*.sql` migration on the new host. Move records with **Download all data** on the old deployment and **Import a backup** on the new one, as [MIGRATION.md](../MIGRATION.md) describes, then reconnect Dexcom Share from **Care tools > Dexcom · import > Live Share**. The import assigns records to the signed-in account and never copies Dexcom credentials. Afterward, count each table and compare representative timestamp, glucose, food, dose, event, and plan entries. Reserve manual transfer of encrypted Dexcom credentials and `DEXCOM_SECRET_KEY` for a controlled operator migration that maps owner IDs explicitly and rotates the secret afterward.
5. **Dexcom sync.** Carby fetches Dexcom data only when a signed-in user connects and uses the app. If a deployment needs background sync, design, build, and operate it separately, with alarms on repeated failures, delayed readings, and missing samples, and test the upstream-empty, expired-session, bad-credentials, and clock-skew cases. Continue to direct users to their primary glucose device for current treatment decisions.
6. **Caregiver access.** Build a separate caregiver portal with named accounts or expiring invitations, role-based read/write permissions, revocation, server-side checks, and the actor audit. A static snapshot remains available when a live login is unsuitable. No public health-record endpoint.
7. **Test coverage on the real target.** The database-backed tests skip unless `TEST_DATABASE_URL` names an isolated PostgreSQL instance. Run `make ci` against a separate, disposable database in CI before any release, and treat a run that skipped those tests as an incomplete run.
8. **Pre-release validation.** Validate the report, handoff, access rules, sign-in flow, and rollback against a scrubbed staging copy. Move DNS only after parallel data comparison; retain a restricted rollback snapshot under the destination host's retention policy.
