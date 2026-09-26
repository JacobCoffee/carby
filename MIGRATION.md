# Export and restore a Carby deployment's data

Carby stores every record in PostgreSQL. This document covers moving records between deployments, and bringing records forward from an earlier local setup that kept them in SQLite.

## 1. Download the source

Check out this repository at the commit you deployed. The tracked source includes the app, the `postgres/*.sql` migrations, tests, and the export utility. Git ignores `.env` files, dependencies, build artifacts, local data, the local sign-in secret, and runtime secrets, so the source contains none of them.

## 2. Download the database

Sign in as the record owner, open **Care tools**, and choose **Download all data**, or open `/api/export` on the deployment. The download is `carby-backup-YYYY-MM-DD.ndjson`. It contains an exact row export of the signed-in owner's `plans`, `saved_foods`, `entries`, `cgm_readings`, `dexcom_events`, `dexcom_connections`, `care_audit`, `illness_windows`, `profiles`, and `appointments` tables. Backups from before illness tracking have no `illness_windows` table, backups from before profile personalization have no `profiles` table, and backups from before appointments have no `appointments` table. Preserve the header and footer. The footer's per-table counts let an importer reject incomplete downloads. Pause edits and Dexcom sync while taking the final migration backup so all tables reflect the same point in time.

If the account has a Dexcom Share connection, the backup includes its encrypted credentials. Keep every backup private. Those credentials require the separate `DEXCOM_SECRET_KEY` secret to decrypt. If the secret cannot be securely moved, reconnect Dexcom Share after migrating instead. The secret is not in the source or the backup, and Carby does not expose it for download. The in-app import below never copies these credentials.

The backup leaves out the Clarity share code, archived Clarity PDF reports, the CGM sensor list, and the CGM device and alert settings. The next Clarity sync rebuilds the sensor list and settings. Readings and events that Clarity sync imported are in `cgm_readings` and `dexcom_events` like any other. Download each PDF you want to keep from **Care tools > Dexcom · import > Clarity sync** before you move, and connect Clarity again on the new deployment.

## 3. Import into another Carby deployment

Apply every pending migration in `postgres/` to the destination database first. On a deploy, the `Procfile`'s `release` process runs `node scripts/migrate.mjs` and does this; locally, `make migrate` applies them against `DATABASE_URL`, and `make serve` applies them when it provisions the local database itself.

Sign in to the new deployment with the account that should own the records. On the **Set up Carby** screen, choose **Import a backup** and select the `.ndjson` file. The browser checks the whole file and shows record counts, the date range, and whether the latest care plan can be used. Nothing is uploaded until you confirm.

The import:

- only adds records to an account with no records. An account that already has a plan, entries, readings, a Dexcom Share connection, or other records is refused and left unchanged, unless you choose to replace its records (see below).
- assigns every record to the signed-in account. The owner in the backup is checked for consistency but never used for access.
- keeps record IDs, times, meal and dose links, saved food links, plan history, illness and other periods, appointments, the personalization profile, and change history. Glucose reading and Dexcom event IDs are derived from the owner, so they are re-derived for the new account and later syncs merge with them.
- does not import the Dexcom Share sign-in. Readings and events are imported; connect Dexcom Share again from **Care tools**.
- accepts the current ten-table backup, the earlier nine-table backup without `appointments`, the eight-table backup without `profiles` or `appointments`, the seven-table backup without `illness_windows`, `profiles`, or `appointments`, and version 1 backups made before the project was renamed. Those older backups name the earlier project in place of `carby` in the header format (`<name>-d1-ndjson`, where the name uses lowercase letters, digits, and single hyphens). Carby checks the rest of the file exactly as it checks a current backup. Other formats and versions are refused with an explanation.
- maps the insulin products that pre-rename backups recorded to the categories Carby records: Humalog becomes Rapid-acting and Semglee becomes Long-acting. Only the entry's insulin value changes. Units, times, dose purpose, meal links, care plan snapshots, notes, and any other fields stay as exported, even when a note names a product. Any other insulin value is refused rather than guessed. Change history snapshots are imported exactly as recorded, so they keep the product name; Carby shows who changed which entry and when, and does not read those snapshots as current entries.
- refuses an incomplete backup. An export that stopped early has no end marker or fewer records than its footer lists. Download it again from the other deployment; Carby never imports part of a backup.
- accepts up to 150,000 records and 128 MiB (134,217,728 bytes) per backup.

The browser uploads the file in parts of up to 250 records. The server checks every row again, stages it outside the care tables, and compares the totals with the backup's footer. The final step checks that the account is still empty and copies every staged record in one database transaction, so a damaged, truncated, or miscounted backup, a cancelled import, or a record saved in another window adds no records. After an import finishes, fails, or is cancelled, Carby deletes its staged rows in steps of up to 5,000 rows per request, so a large import can take several page loads or import requests to clear. If the page is closed before the import finishes, the import stays unfinished until 24 hours after its last activity. The first page load or import request after that cancels it, and later ones remove its staged rows in the same bounded steps.

Record IDs are unique across a deployment. A backup taken from the same deployment and imported into a different account is refused while the original records exist.

### Replace the records in an account

An account that already has records can take a backup only by replacement. On the **Set up Carby** screen, choose **Import a backup**, then **Replace from backup**. Download the account's current data first with **Download all data** or `/api/export`; Carby offers the link but does not download it for you. Choose the backup, check its summary, and tick both confirmations: that the backup belongs to the person whose care you record, and that it replaces all records currently in the account. Then choose **Replace records from backup**.

The replacement:

- asks for replacement when the import starts and again when it finishes. Carby stores that choice with the import when it starts and never changes it, so a request cannot turn an ordinary import into a replacement at the last step.
- stages and checks the backup exactly as an ordinary import does. Until the last step, the account's records stay as they are and can still change in other windows or through Dexcom sync.
- in its last step deletes every record the signed-in account has at that moment in `plans`, `saved_foods`, `entries`, `cgm_readings`, `dexcom_events`, `dexcom_connections`, `care_audit`, `illness_windows`, `profiles`, and `appointments`, then copies every staged record, in one database transaction. Records saved before that step, including ones saved during the upload, are deleted too. Nothing is merged. Other accounts' records are never touched.
- removes the account's Dexcom Share connection. A backup never brings its encrypted sign-in along, so connect Dexcom Share again from **Care tools** afterward.
- leaves the account's Clarity connection, archived Clarity reports, CGM sensor list, and CGM device settings as they are. They are not in any backup, so a replacement neither restores nor removes them. Disconnect Clarity or delete reports from **Care tools** if you do not want them.
- allows the backup to reuse this account's own record IDs, so a backup of this same account can restore it. An ID that belongs to another account still refuses the backup.
- leaves the account unchanged if you cancel, if the backup is incomplete, miscounted, or empty, if a confirmation is missing, if an ID belongs to another account, or if the database fails partway. The transaction rolls back every delete with it.
- runs once. Repeating the finishing request, for example after a lost reply, reports the first result and never deletes records saved after the replacement.

A very large account plus a very large backup make the last step's transaction longer. If it runs past the database's limits, it rolls back and the account keeps its current records.

If the latest care plan in the backup is missing settings that this version requires, the records are still imported. Carby then asks for the current care plan before it opens the dashboard; older plan versions stay in plan history. Care plans in a pre-rename backup lack the correction review interval, so Carby always asks for current settings after that import; it never fills in a missing setting.

## 4. Bring an earlier local SQLite database forward

An earlier local setup kept records in a SQLite file under `.wrangler/state/`. Nothing migrates those records automatically: a new PostgreSQL database starts empty, and this repository leaves any existing `.wrangler/state/` directory exactly as it is — it never reads it during normal operation, writes to it, or deletes it. Keep that directory until you have confirmed the records arrived in their new home.

`scripts/export-legacy-local.mjs` converts such a file into a backup the in-app import accepts. Run it with Bun, which it requires for `bun:sqlite`:

```sh
bun scripts/export-legacy-local.mjs --input <path to the legacy SQLite file> --output backups/legacy.ndjson --owner local_dev
```

- `--input` is the legacy SQLite database file. **You identify it yourself**; the exporter uses the path you give and never searches for one. Look under `.wrangler/state/` from the earlier setup.
- `--output` is a new file. Git ignores `backups/`.
- `--owner` defaults to `local_dev`, the owner id local sign-in uses. When the database holds no records for the owner you named, the exporter lists the owner ids it found so you can pass one.

What the exporter guarantees:

- **Read-only.** It opens the source read-only and reads it inside a single transaction, so the snapshot is consistent and the legacy database is never modified.
- **Never overwrites.** It stops if the output path already exists, writes to a temporary file, and publishes by hard link, which fails if the destination appeared meanwhile. Choose an output folder on a disk that supports hard links, such as your home folder. Whatever happens, it removes its temporary file.
- **Private permissions.** Both the temporary file and the published file are mode 0600.
- **Canonical NDJSON.** The output is the same `carby-d1-ndjson` format the in-app download produces: a header naming the format, version, and tables; one line per row; and a footer with per-table counts. Before publishing, the exporter parses the file back through the importer's own parser and refuses to publish anything Carby would reject.
- **Schema compatibility unchanged.** It checks each table's columns against what the importer expects and stops on a mismatch. The ten-table layout and each earlier layout (without `appointments`; without `profiles`; without `illness_windows`) all still work, exactly as the in-app import handles them. This exporter reads a legacy SQLite database that predates profile personalization and appointments, so it never emits a `profiles` or `appointments` table itself.
- It refuses rows with non-text values, since the importer accepts text only.

Then import the file as in step 3: sign in to the destination deployment **as the account that should own the records**, open **Set up Carby**, and choose **Import a backup**. Every record lands under that signed-in account, regardless of the `owner` value in the file. The export carries the Dexcom Share connection row still encrypted, but the import never restores it, so reconnect Dexcom Share from **Care tools** afterward.

## 5. Legacy: inspect a backup in SQLite

`scripts/restore-backup.py` predates the move to PostgreSQL. It is a standalone SQLite utility for looking at a backup offline, **not a production restore path** — nothing in the deploy, the `Procfile`, or the app calls it, and it does not write to a Carby database. It builds its destination from the SQLite migrations kept for this purpose in `scripts/legacy-schema/`, so it runs against a checked-out tree and produces a legacy-shaped SQLite file, never a Carby PostgreSQL database. Use the in-app **Import a backup** flow to move records between deployments.

Give it a downloaded `.ndjson` backup and a destination path that does not exist yet:

```sh
python3 scripts/restore-backup.py carby-backup.ndjson carby.sqlite3
```

Then examine that database, or any SQLite database you produced some other way, without printing records:

```sh
sqlite3 carby.sqlite3 'SELECT count(*) FROM cgm_readings;'
```

## Notes for any migration

Records created with local sign-in belong to the owner `local_dev`. OAuth records belong to a `provider:subject` id such as `github:12345`, and Carby links no accounts across providers — the same person signing in through two providers owns two separate sets of records. Map owner IDs explicitly before allowing sign-in on a new host.

Preserve entry IDs, timestamps, source labels, and raw HIGH/LOW status values. Do not turn an insulin calculation into an administered-dose entry.

The source ships no care plan, prescriptions, or food list. Carby has not had a production security or hosting review, and it is not a medical device. Before using it for real health records, choose a host appropriate for those records. Back up, verify counts, and test sign-in and emergency flows before switching users over.
