# Carby

> [!TIP]
> [Cabotage](https://preview.cabotage.io/) is the recommended way to self-host Carby. The `Dockerfile` and `Procfile` in this repository already match what Cabotage expects.

Carby is a web app for diabetes logging. It charts glucose readings, records food, insulin, exercise and low treatments, tracks reminders, illness and other periods, and appointments, keeps a clinic-style logbook, and builds reports you can share with a care team. It can also pull readings from Dexcom Share.

![Carby's daily care view with care reminders, quick logging, the latest reading, a one-day glucose chart and the daily log](docs/images/dashboard.webp)

> [!WARNING]
> Carby is experimental and is not a medical device. Its calculations and reminders are not dosing advice. Make treatment decisions with your primary glucose device and your clinician's current care plan. Carby has had no security or hosting audit, so use synthetic data only until your deployment meets the requirements in [docs/hosting-migration.md](docs/hosting-migration.md).

## Run it locally

You need Bun 1.4.2 or newer, Node.js 22.13 or newer, and Docker with Compose running.

```sh
make serve
```

Open <http://localhost:5173>. `make serve` installs dependencies, starts a local PostgreSQL database in Docker, applies migrations, and signs you in to a local account. You do not need an OAuth app or an `.env` file.

A new account starts with no care plan, insulin settings, or food list. Carby opens a setup screen where you enter your own plan or import a backup.

Care contacts and emergency instructions are optional and belong to each account's care plan, not to the deployment. During setup or in **Care tools > Care plan**, enter care team and after-hours names, phone numbers and availability, any other contacts such as a pharmacy or school nurse, and paste the low-glucose, severe-low, high-glucose, illness and when-to-call instructions from your own care plan. Carby shows only what you enter, in the emergency steps and the caregiver handoff, and never generates treatment instructions. A blank section shows general guidance. With no emergency number set, Carby tells you to call your local emergency number.

The care plan also asks for three safety settings, copied from your care plan with no defaults: the glucose number you treat a low below, the number you check ketones above, and how many days in a row of highs or lows count as a pattern. Carby uses these for its low and ketone notices and for the patterns it flags in the logbook, Insights and reports. Optional settings each turn on one feature: a call check after a correction, sick-day check intervals, the low-treatment amount and recheck time, an overnight check with a last night, a snack size below which your plan gives no insulin, the rescue medication name, and your meter's HI and LO limits. None of them changes dose calculations.

An account created before these settings existed opens the setup screen until you enter the three required ones.

During an illness, open the period (or the sick-day reminder) and choose **Log a check-in** to record, at a time, a temperature, symptoms, how many times you vomited since the last check-in, whether fluids are staying down, and how much you are eating. Every detail is optional. Ketones stay with glucose readings, so sick-day timers see them; the check-in form links there. Check-ins show in the period, the daily log and the clinician report. Temperatures are entered and shown in the unit chosen in the care plan (°F or °C) and stored in °C.

The care plan's time zone sets how every view, reminder, report and download name shows dates and times. Pick it from the list or use this device's zone. After a move or a trip, earlier illness periods keep the dates they were logged with and name their zone.

To set optional values such as a Dexcom key, copy the example file. The `-n` flag leaves an existing `.env` and its secrets untouched:

```sh
cp -n .env.example .env
```

If you set `DATABASE_URL` yourself, Carby uses that database as given and never migrates it on its own. Check which database it names, then run `make migrate` when you mean to.

To try a production build on your machine, run `make build` and then `make start`, and open <http://127.0.0.1:8787>. Both local servers listen on loopback only.

### Common commands

| Command        | Purpose                                          |
| -------------- | ------------------------------------------------ |
| `make serve`   | Start the dev server on port 5173                |
| `make build`   | Build the app into `dist/`                       |
| `make start`   | Serve the build on port 8787                     |
| `make migrate` | Apply pending migrations to `DATABASE_URL`       |
| `make test`    | Run the tests                                    |
| `make ci`      | Run lint, format check, type checking, and tests |

Run `make help` for the full list. Pass extra options with `ARGS`, for example `make serve ARGS="--port 3000"`.

Tests that need a database are skipped unless `TEST_DATABASE_URL` points to a separate, disposable PostgreSQL instance. The tests create and drop their own schemas there. Never point it at a personal or shared database, or at the one `make serve` starts.

## Self-hosting

[.env.example](.env.example) lists every variable, with the format rules and generation commands for each secret. A deployment needs:

- `APP_URL`: the public HTTPS address, such as `https://carby.example.org`.
- `DATABASE_URL`: a PostgreSQL connection string.
- `AUTH_SECRET`: a random session secret, separate from `DEXCOM_SECRET_KEY`.
- At least one sign-in provider with both its ID and secret set: `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET`, `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`, or `AUTH_DISCORD_ID` and `AUTH_DISCORD_SECRET`.
- A list of who may sign in. `CARBY_ALLOWED_USERS` takes `provider:subject` entries such as `github:12345`. `CARBY_ALLOWED_EMAILS` takes addresses, and matches one only when the provider reports it as verified. Either list can admit a person on its own. If both lists are empty, nobody can sign in.

Carby does not link accounts across providers. A person who signs in with GitHub and later with Google gets two separate sets of records.

Register a callback URL with each provider you enable, using the host from `APP_URL`:

```text
https://YOUR-CARBY-HOST/api/auth/callback/github
https://YOUR-CARBY-HOST/api/auth/callback/google
https://YOUR-CARBY-HOST/api/auth/callback/discord
```

Keep secrets in your host's configuration or secret store, never in Git or a built image. Carby reads every value when the process starts, so a change needs a restart, not a rebuild.

The `Dockerfile` builds an image that runs as a non-root user. The `Procfile` defines the processes:

- `release` applies database migrations on each deploy.
- `web` serves the app on the Unix socket `/var/run/cabotage/cabotage.sock`, where Cabotage expects it.

Point health checks at `GET /_health/`, which returns `200 ok` without sign-in.

Before you store real care data, work through [docs/hosting-migration.md](docs/hosting-migration.md).

## Dexcom Share and Clarity (optional)

Dexcom support needs `DEXCOM_SECRET_KEY`, exactly 64 hex characters. Generate it once when you set up a new installation:

```sh
openssl rand -hex 32
```

Keep that key stable afterward. Carby uses it to encrypt the Dexcom sign-ins and Clarity share codes it stores, not your other records, and it is not an API key from Dexcom. If the key changes, every account has to reconnect Dexcom. Put it in `.env` locally, or in the host's secret store for a deployment.

To connect, open **Care tools > Dexcom · import > Live Share** and enter a Dexcom Share login. Carby fetches readings only while someone has the app open. No background job syncs them.

[.env.example](.env.example) also documents optional `DEXCOM_USERNAME`, `DEXCOM_PASSWORD`, and `DEXCOM_REGION` defaults that prefill the connect form. The password stays on the server, and a password the user types takes precedence. In a deployment, these defaults apply only to the account named in `DEXCOM_DEFAULT_OWNER`. Users who enter their own login do not need that setting.

### Clarity sync

Clarity sync imports the full Dexcom Clarity history, including calibrations, and archives Clarity's PDF reports. It uses a share code instead of a Dexcom login. Only the Clarity mobile app can make one:

1. Open the Clarity app on your phone.
2. Go to **Profile**.
3. Tap **Authorize Sharing**, then **Generate Code**.
4. Choose the 12-month option and copy the code.

In Carby, open **Care tools > Dexcom · import > Clarity sync**, paste the code, and check whose data it opens before you connect. Carby reads Clarity times in the care plan's time zone. The code stops working when it expires or when you revoke it in the app. Carby shows the expiry date and warns in the last 30 days, and then you generate a new code and connect again.

With daily sync on, the production server imports new Clarity data about once a day, and on the first days of each month it archives the chosen reports for the previous month. A month with no CGM readings is skipped rather than archived as a blank report. Set `CARBY_CLARITY_SCHEDULE=off` to stop that on a deployment. `make serve` and `make start` never sync on a schedule; use **Sync now** instead. Clarity data is retrospective and not for current glucose decisions. Clarity sync uses the same unofficial interface as the Clarity website and may stop working if Dexcom changes it.

Out of range of the phone or receiver, a Dexcom sensor keeps its readings and hands them over when it reconnects. Clarity gets that backfill, but Share does not. With daily sync on, Carby watches for a gap of more than 15 minutes that has since closed and asks Clarity for it: every 10 minutes while the dashboard is open, and hourly on a production server. It asks at most every half hour per gap and stops 6 hours after the gap closed, or as soon as the gap is filled. A gap that is still open, or one longer than a day, is left for the daily sync.

Under the glucose chart, the Today page shows when Clarity last synced, how far its data reaches, and which day the current sensor is on. A sensor counts as current until Clarity has had no readings from it for a day. A failed or overdue sync is marked there. Hover the entry to see the error.

Below the clinician report, the Reports page keeps a long-term record that is not printed. It shows the standard CGM ranges month by month for the past 12 months, every sensor Clarity has reported, and every archived Clarity PDF with a download link.

## Backups and moving data

Carby never moves data between installations on its own. To move an account, choose **Care tools > Download all data** to save a backup file, then sign in to the other installation and choose **Import a backup** on the setup screen.

- Importing into an account that already has records requires **Replace from backup**. This deletes every current record in that account and loads the backup in its place, with no merging. Download the current account's data first.
- If the backup's care plan lacks a setting this version needs, Carby asks you to enter and confirm it. Carby never fills in a medical value for you.
- The import does not restore the Dexcom connection, so reconnect Dexcom afterward.
- Backups leave out the Clarity share code, archived Clarity PDF reports, and the CGM sensor list and alert settings that Clarity sync reads. Download the reports you want to keep, and connect Clarity again on the new installation.
- Keep backups private. A backup can contain encrypted Dexcom credentials.

Data from an older local setup under `.wrangler/state/` stays where it is. [MIGRATION.md](MIGRATION.md) explains how to export that SQLite data into a backup file, and covers the import rules in detail.

## License

Carby is licensed under the [Functional Source License 1.1](https://fsl.software/), MIT Future License. See [LICENSE.md](LICENSE.md). Each version becomes available under the MIT license two years after its release. Carby is source-available Fair Source software, not OSI-approved open source. Third-party files keep their own licenses, such as [vendor/shadcn-tailwind-4.13.0.LICENSE.md](vendor/shadcn-tailwind-4.13.0.LICENSE.md).
