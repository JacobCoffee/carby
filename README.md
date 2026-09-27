# Carby

> [!TIP]
> [Cabotage](https://preview.cabotage.io/) is the recommended way to self-host Carby. The `Dockerfile` and `Procfile` already match what it expects.

Carby is a web app for diabetes logging: glucose, food, insulin, exercise, low treatments, reminders, illness periods, appointments, a clinic-style logbook, and reports for your care team. It can pull readings from Dexcom Share and Clarity.

![Carby's daily care view with care reminders, quick logging, the latest reading, a one-day glucose chart and the daily log](docs/images/dashboard.webp)

> [!WARNING]
> Carby is experimental and not a medical device. Nothing it shows is dosing advice; follow your glucose device and your clinician's care plan. It has had no security audit, so use synthetic data until your deployment meets [docs/hosting-migration.md](docs/hosting-migration.md).

## Run it locally

Needs Bun 1.4.2+, Node.js 22.13+, and Docker with Compose.

```sh
make serve
```

Open <http://localhost:5173>. This starts PostgreSQL in Docker, runs migrations, and signs you in to a local account. No `.env` or OAuth app needed.

| Command        | Purpose                              |
| -------------- | ------------------------------------ |
| `make serve`   | Dev server on port 5173              |
| `make build`   | Build into `dist/`                   |
| `make start`   | Serve the build on port 8787         |
| `make migrate` | Apply migrations to `DATABASE_URL`   |
| `make test`    | Run tests                            |
| `make ci`      | Lint, format check, typecheck, tests |

`make help` lists the rest. Extra options go in `ARGS`, e.g. `make serve ARGS="--port 3000"`.

- Optional settings (such as the Dexcom key): `cp -n .env.example .env`.
- If you set `DATABASE_URL` yourself, Carby never migrates it automatically. Run `make migrate` when you mean to.
- Database tests need `TEST_DATABASE_URL` pointing at a disposable Postgres. They create and drop schemas, so never use a real database or the `make serve` one.

## First run

New accounts start empty. The setup screen asks you to enter your care plan or import a backup. Carby has no clinical defaults; every value comes from your plan.

- **Required:** the glucose level you treat a low below, the level you check ketones above, and how many days in a row make a pattern.
- **Optional:** care contacts, emergency and sick-day instructions, low-treatment amount, meter HI/LO limits, and similar. Each turns on one feature. Instructions are shown exactly as you enter them. None of these changes dose calculations.
- **Time zone:** all dates and times display in the care plan's zone.

Edit these later in **Care tools > Care plan**.

On a wider screen, add records from the **Log** button in the bottom-right corner; on a phone, use the bar along the bottom. With a keyboard, press `?` to see every shortcut: `L` then `G` logs glucose, `G` then `I` opens Insights, and `⌘K` searches every command.

## Several people and shared care

One account can keep logs for several people, such as two children, and several accounts can share one person's log. Use the name menu at the right of the header to switch people or **Add a person**. Each person has their own care plan, time zone, saved foods, Dexcom connection and backups.

Owners open **Sharing and access** from the same menu to create a single-use invite link (valid for 7 days) and to change or remove access. The person invited signs in with their own account, which must still be allowed by `CARBY_ALLOWED_USERS` or `CARBY_ALLOWED_EMAILS`.

| Role      | Can                                                                         |
| --------- | --------------------------------------------------------------------------- |
| Owner     | Everything, including the care plan, profile, Dexcom, backups and sharing.  |
| Caregiver | See everything and log care. Can't change the care plan, Dexcom or sharing. |
| Viewer    | See everything. Can't log or change anything.                               |

Every person keeps at least one owner. Changes record who made them, and sharing changes appear in the change history.

## Self-hosting

[.env.example](.env.example) documents every variable. A deployment needs:

| Variable                                       | Value                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `APP_URL`                                      | Public HTTPS address                                                           |
| `DATABASE_URL`                                 | PostgreSQL connection string                                                   |
| `AUTH_SECRET`                                  | Random session secret                                                          |
| `AUTH_{GITHUB,GOOGLE,DISCORD}_{ID,SECRET}`     | At least one sign-in provider                                                  |
| `CARBY_ALLOWED_USERS` / `CARBY_ALLOWED_EMAILS` | Who may sign in (`github:12345`, or verified emails). Both empty means nobody. |

Register `https://YOUR-HOST/api/auth/callback/<provider>` with each provider. Accounts are not linked across providers.

- `release` in the `Procfile` runs migrations; `web` serves on `/var/run/cabotage/cabotage.sock`.
- Health check: `GET /_health/`.
- Secrets live in the host's secret store, not Git or the image. Changes need a restart, not a rebuild.

## Dexcom (optional)

Set `DEXCOM_SECRET_KEY` once with `openssl rand -hex 32` and never change it. It encrypts stored Dexcom logins; changing it forces everyone to reconnect.

- **Live Share:** **Care tools > Dexcom · import > Live Share**, enter a Share login. Fetches only while the app is open.
- **Clarity sync:** imports full history, fills gaps Share misses, and archives monthly PDF reports. In the Clarity phone app, go to **Profile > Authorize Sharing > Generate Code** (12 months), then paste it in **Care tools > Dexcom · import > Clarity sync**. Production syncs daily; set `CARBY_CLARITY_SCHEDULE=off` to disable. Locally, use **Sync now**.

Clarity uses an unofficial interface and may break if Dexcom changes it.

## Backups

**Care tools > Download all data** saves a backup of the person you're viewing (owners only). On another install, choose **Import a backup** during setup.

- Importing into a person who already has records replaces everything they have. Download first.
- A backup holds one person's records, not who they're shared with. Invite people again afterward.
- Dexcom connections, Clarity codes, and archived Clarity PDFs are not included. Reconnect afterward.
- Backups may contain encrypted Dexcom credentials. Keep them private.

See [MIGRATION.md](MIGRATION.md) for import rules and moving data from the old `.wrangler/state/` SQLite setup.

## License

[Functional Source License 1.1](https://fsl.software/), MIT Future License: each version becomes MIT two years after release. See [LICENSE.md](LICENSE.md). Third-party files keep their own licenses.
