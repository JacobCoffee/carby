"use client";

import { apiFetch, personHref } from "@/lib/person-request";
import { usePersonAccess } from "./person-context";
import { useEffect, useRef, useState } from "react";
import {
  BackupError,
  BackupParser,
  IMPORT_LIMITS,
  IMPORT_TABLES,
  backupLines,
  tableLabels,
  type BackupSummary,
} from "@/lib/backup-import";

type Outcome = {
  total: number;
  planReady: boolean;
  connectionSkipped: boolean;
  replaced: boolean;
};
type Reply = Partial<Outcome> & {
  error?: string;
  code?: string;
  sessionId?: string;
  state?: string;
  cleanupPending?: boolean;
  empty?: boolean;
  retry?: boolean;
  replaced?: boolean;
};
type Phase =
  | { name: "choose" }
  | { name: "checking"; percent: number }
  | { name: "review"; file: File; summary: BackupSummary; header: unknown }
  | { name: "importing"; summary: BackupSummary; sent: number; replace: boolean }
  | { name: "finishing"; summary: BackupSummary; replace: boolean }
  | { name: "cancelling" }
  | { name: "done"; outcome: Outcome };

class ImportFailure extends Error {
  reply: Reply;
  constructor(message: string, reply: Reply) {
    super(message);
    this.name = "ImportFailure";
    this.reply = reply;
  }
}

const count = (value: number) => value.toLocaleString("en-US");
/** Review dates, in the backup plan's zone when known (its records were logged there). */
const day = (value: string, timeZone: string | undefined) =>
  new Date(value).toLocaleDateString("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
  });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const added = "No records were added.";
const kept = "Your current records were not changed.";
const replaceBody = { mode: "replace", confirmReplace: true } as const;
const outcomeOf = (result: Reply, total: number): Outcome => ({
  total: result.total ?? total,
  planReady: !!result.planReady,
  connectionSkipped: !!result.connectionSkipped,
  replaced: !!result.replaced,
});

async function send(body: Record<string, unknown>, signal?: AbortSignal): Promise<Reply> {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await apiFetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
        cache: "no-store",
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (attempt < 3) {
        await wait(1000 * 2 ** attempt);
        continue;
      }
      throw new ImportFailure(
        "The connection was lost during the import. Check your connection and try again.",
        {},
      );
    }
    const data = (await response.json().catch(() => ({}))) as Reply;
    if (response.ok) return data;
    // Parts are idempotent on the server, so a retried request cannot add a record twice.
    if (response.status >= 500 && attempt < 3) {
      await wait(1000 * 2 ** attempt);
      continue;
    }
    throw new ImportFailure(data.error ?? "The import could not continue. Please retry.", data);
  }
}

/** Remove staged rows left by a cancelled or failed import. Failures here are retried on the next import. */
async function drain(pending: boolean | undefined) {
  for (let i = 0; pending && i < 100; i++) {
    try {
      pending = (await send({ action: "cleanup" })).cleanupPending;
    } catch {
      return;
    }
  }
}

export default function BackupImport({
  hasRecords,
  onUseSettings,
  onBusyChange,
}: {
  hasRecords: boolean;
  onUseSettings: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { person } = usePersonAccess();
  const [phase, setPhase] = useState<Phase>({ name: "choose" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [populated, setPopulated] = useState(hasRecords);
  const [replaceChosen, setReplaceChosen] = useState(false);
  const replacing = populated && replaceChosen;
  const blocked = populated && !replaceChosen;
  const heading = useRef<HTMLHeadingElement>(null);
  const stop = useRef<AbortController | null>(null);
  const session = useRef<string | null>(null);
  const cancelled = useRef(false);
  const replaceRun = useRef(false);
  const busy =
    phase.name === "checking" ||
    phase.name === "importing" ||
    phase.name === "finishing" ||
    phase.name === "cancelling";

  useEffect(() => {
    let active = true;
    void apiFetch("/api/import", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<Reply>) : null))
      .then((data) => {
        if (active && data) setPopulated(data.empty === false);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  useEffect(() => {
    if (phase.name !== "checking" && phase.name !== "importing") heading.current?.focus();
  }, [phase.name]);
  useEffect(() => {
    if (phase.name !== "importing" && phase.name !== "finishing") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase.name]);

  function resetConfirmations() {
    setConfirmed(false);
    setReplaceConfirmed(false);
  }
  function chooseReplace(next: boolean) {
    setReplaceChosen(next);
    resetConfirmations();
    setError("");
    setNotice("");
    if (phase.name === "review") setPhase({ name: "choose" });
  }

  async function check(file: File) {
    setError("");
    setNotice("");
    resetConfirmations();
    cancelled.current = false;
    if (file.size === 0) {
      setError("This file is empty.");
      return;
    }
    if (file.size > IMPORT_LIMITS.maxBytes) {
      setError(
        `This file is larger than Carby can import at once (${Math.round(IMPORT_LIMITS.maxBytes / 1048576)} MB).`,
      );
      return;
    }
    setPhase({ name: "checking", percent: 0 });
    try {
      const parser = new BackupParser();
      let header: unknown = null,
        shown = 0;
      for await (const text of backupLines(file.stream(), (bytes) => {
        const percent = Math.floor((bytes / file.size) * 100);
        if (percent !== shown) {
          shown = percent;
          setPhase({ name: "checking", percent });
        }
      })) {
        if (cancelled.current) {
          setPhase({ name: "choose" });
          return;
        }
        const line = parser.push(text);
        if (line.type === "header") header = line.value;
      }
      setPhase({ name: "review", file, summary: parser.summary(), header });
    } catch (problem) {
      setPhase({ name: "choose" });
      setError(
        problem instanceof BackupError
          ? problem.message
          : "This file could not be read. Choose the .ndjson backup file.",
      );
    }
  }

  async function upload(file: File, summary: BackupSummary, header: unknown, replace: boolean) {
    replaceRun.current = replace;
    const mode = replace ? replaceBody : {};
    const unchanged = replace ? kept : added;
    setError("");
    setNotice("");
    cancelled.current = false;
    const controller = new AbortController();
    stop.current = controller;
    setPhase({ name: "importing", summary, sent: 0, replace });
    let finishing = false;
    try {
      const started = await send({ action: "start", header, ...mode }, controller.signal);
      const sessionId = started.sessionId!;
      session.current = sessionId;
      void drain(started.cleanupPending);
      const parser = new BackupParser();
      let index = 0,
        sent = 0,
        bytes = 0,
        firstLine = 0,
        footer: unknown = null,
        rows: unknown[] = [];
      const flush = async () => {
        if (!rows.length) return;
        await send({ action: "chunk", sessionId, index, firstLine, rows }, controller.signal);
        index += 1;
        sent += rows.length;
        rows = [];
        bytes = 0;
        setPhase({ name: "importing", summary, sent, replace });
      };
      for await (const text of backupLines(file.stream())) {
        if (controller.signal.aborted) return;
        const line = parser.push(text);
        if (line.type === "footer") footer = line.value;
        if (line.type !== "row") continue;
        if (
          rows.length &&
          (rows.length >= IMPORT_LIMITS.chunkRows || bytes + line.length > IMPORT_LIMITS.chunkBytes)
        )
          await flush();
        if (!rows.length) firstLine = line.line;
        rows.push(line.upload);
        bytes += line.length;
      }
      await flush();
      if (parser.summary().totalRows !== summary.totalRows)
        throw new BackupError("The file changed while it was being imported. Choose it again.");
      if (controller.signal.aborted) return;
      setPhase({ name: "finishing", summary, replace });
      finishing = true;
      const result = await send({ action: "finish", sessionId, footer, chunks: index, ...mode });
      session.current = null;
      void drain(result.cleanupPending);
      setPhase({ name: "done", outcome: outcomeOf(result, summary.importRows) });
    } catch (problem) {
      if (cancelled.current || controller.signal.aborted) return;
      const reply: Reply = problem instanceof ImportFailure ? problem.reply : {};
      if (reply.code === "not-empty") {
        setPopulated(true);
        setReplaceChosen(false);
      }
      const sessionId = session.current;
      session.current = null;
      if (sessionId && !reply.code) {
        // The server may have finished even though its reply was lost; cancelling reports that.
        const result = await send({ action: "cancel", sessionId }).catch(() => null);
        if (result?.state === "complete") {
          setPhase({ name: "done", outcome: outcomeOf(result, summary.importRows) });
          return;
        }
        if (!result && finishing) {
          setPhase({ name: "choose" });
          resetConfirmations();
          setError(
            replace
              ? "Carby could not confirm whether the replacement finished. Reload this page to check which records this account has before you try again."
              : "Carby could not confirm whether the import finished. Reload this page to check before you try again.",
          );
          return;
        }
        void drain(result?.cleanupPending);
      } else void drain(reply.cleanupPending);
      setPhase({ name: "choose" });
      resetConfirmations();
      // Activation is one transaction, so every error that reaches here left the account as it was.
      const message = (
        problem instanceof BackupError || problem instanceof ImportFailure
          ? problem.message
          : "The import could not continue. Please retry."
      ).replace(added, unchanged);
      setError(
        message.includes(unchanged) || message.includes("nothing was changed")
          ? message
          : `${message} ${unchanged}`,
      );
    }
  }

  async function cancel() {
    cancelled.current = true;
    if (phase.name === "checking") return;
    stop.current?.abort();
    const sessionId = session.current;
    session.current = null;
    setPhase({ name: "cancelling" });
    if (sessionId) {
      try {
        const result = await send({ action: "cancel", sessionId });
        if (result.state === "complete") {
          setPhase({ name: "done", outcome: outcomeOf(result, 0) });
          return;
        }
        void drain(result.cleanupPending);
      } catch {
        /* staged rows are removed on the next import */
      }
    }
    setPhase({ name: "choose" });
    resetConfirmations();
    setNotice(replaceRun.current ? `Replacement cancelled. ${kept}` : `Import cancelled. ${added}`);
  }

  if (phase.name === "done") {
    const { outcome } = phase;
    return (
      <section
        className="care-setup-form backup-import backup-import-done"
        aria-labelledby="backup-import-title"
      >
        <h2 id="backup-import-title" ref={heading} tabIndex={-1}>
          {outcome.replaced ? "Replacement complete" : "Import complete"}
        </h2>
        <p>
          {outcome.replaced
            ? `Replaced the records in this account with ${count(outcome.total)} records from the backup.`
            : `Added ${count(outcome.total)} records to this account.`}
        </p>
        {outcome.replaced ? (
          <p className="notice">
            This account no longer has a Dexcom Share connection, and no sign-in was imported from
            the backup. Connect Dexcom Share again from Care tools to receive new readings.
          </p>
        ) : (
          outcome.connectionSkipped && (
            <p className="notice">
              Connect Dexcom Share again from Care tools to receive new readings. The sign-in from
              your other deployment was not imported.
            </p>
          )
        )}
        {!outcome.planReady && (
          <p className="notice">
            This backup has no complete care plan for this version of Carby. Next, Carby fills in
            any settings it can use from the latest saved plan and asks you to add the rest.
          </p>
        )}
        <button
          type="button"
          className="button primary full"
          onClick={() => window.location.reload()}
        >
          {outcome.planReady ? "Open Carby" : "Enter care plan settings"}
        </button>
      </section>
    );
  }

  const review = phase.name === "review" ? phase : null;
  const progress = phase.name === "importing" ? phase : null;
  const summary =
    review?.summary ?? progress?.summary ?? (phase.name === "finishing" ? phase.summary : null);
  // Undefined falls back to this device's zone (a backup without a usable plan zone).
  const reviewZone = summary?.latestPlan?.timezone ?? undefined;
  return (
    <section
      className="care-setup-form backup-import"
      aria-labelledby="backup-import-title"
      aria-busy={busy}
    >
      <h2 id="backup-import-title" ref={heading} tabIndex={-1}>
        Import a backup
      </h2>
      <p>Carby checks the whole file before it changes anything in this account.</p>
      {blocked && !busy && (
        <div className="notice backup-choice" role="status">
          <p>
            This account already has records, so a backup cannot be added to it. Open the existing
            records by entering your current care plan settings, or replace every record in this
            account with a backup. Nothing changes until you confirm a replacement.
          </p>
          <div className="backup-actions">
            <button type="button" className="button outline" onClick={onUseSettings}>
              Open existing records
            </button>
            <button type="button" className="button outline" onClick={() => chooseReplace(true)}>
              Replace from backup
            </button>
          </div>
        </div>
      )}
      {replacing && (phase.name === "choose" || phase.name === "checking" || review) && (
        <div className="notice danger backup-replace">
          <h3>Replace every record in this account</h3>
          <p>
            When you confirm, Carby deletes every record this account has at that moment and adds
            the records from the backup instead. Nothing is merged. This covers:
          </p>
          <ul>
            <li>the care plan and every earlier plan version</li>
            <li>saved foods and log entries</li>
            <li>glucose readings and Dexcom events</li>
            <li>change history and illness periods</li>
            <li>the Dexcom Share connection</li>
          </ul>
          <p>
            Records saved in another window or by someone else before the replacement finishes are
            deleted too. If Carby cannot finish, your current records stay as they are.
          </p>
          <p>
            A backup never brings a Dexcom Share sign-in with it. After the replacement, connect
            Dexcom Share again from Care tools to receive new readings.
          </p>
          <p>
            <a href={personHref("/api/export", person)} download>
              Download this account&apos;s records first
            </a>{" "}
            to keep a copy. Carby does not download it for you.
          </p>
          <button
            type="button"
            className="button outline"
            disabled={busy}
            onClick={() => chooseReplace(false)}
          >
            Keep current records
          </button>
        </div>
      )}
      {(phase.name === "choose" || phase.name === "checking") && (
        <>
          <ol className="backup-steps">
            <li>
              On your other deployment, open <strong>Care tools</strong> and choose{" "}
              <strong>Download all data</strong>.
            </li>
            <li>
              Choose the downloaded <code>.ndjson</code> file here.
            </li>
            <li>
              {replacing
                ? "Check the summary, then confirm the replacement."
                : "Check the summary, then confirm the import."}
            </li>
          </ol>
          <label className="field">
            <span>Backup file</span>
            <input
              type="file"
              accept=".ndjson,application/x-ndjson"
              disabled={blocked || busy}
              onClick={(event) => {
                event.currentTarget.value = "";
              }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void check(file);
              }}
            />
            <small>
              The file is read on this device first. Nothing is saved until you confirm.
            </small>
          </label>
        </>
      )}
      {phase.name === "checking" && (
        <div className="backup-progress" role="status">
          <p>Checking the file… {phase.percent}%</p>
          <progress max={100} value={phase.percent} />
          <button type="button" className="button subtle" onClick={() => void cancel()}>
            Stop checking
          </button>
        </div>
      )}
      {review && summary && (
        <div className="backup-review">
          <h3>Check this backup</h3>
          <p className="backup-file">
            {review.file.name}, downloaded {day(summary.exportedAt, reviewZone)}
          </p>
          {summary.firstAt && summary.lastAt && (
            <p>
              Records from {day(summary.firstAt, reviewZone)} to {day(summary.lastAt, reviewZone)}.
              Times stay as recorded.
            </p>
          )}
          <dl>
            {IMPORT_TABLES.filter((table) => summary.counts[table] > 0).map((table) => (
              <div key={table}>
                <dt>
                  {tableLabels[table].many[0].toUpperCase() + tableLabels[table].many.slice(1)}
                </dt>
                <dd>{count(summary.counts[table])}</dd>
              </div>
            ))}
          </dl>
          {summary.latestPlan?.ready && (
            <p className="notice">
              Carby will open with the latest care plan in this backup, saved{" "}
              {day(summary.latestPlan.created, reviewZone)}. Check it against your current care plan
              after the import.
            </p>
          )}
          {summary.latestPlan && !summary.latestPlan.ready && (
            <p className="notice">
              The latest care plan in this backup is missing settings this version of Carby needs.
              After the import, Carby fills in the saved settings and asks you to add the missing
              ones before you use the dashboard. Earlier plan versions stay in your plan history.
            </p>
          )}
          {!summary.latestPlan && (
            <p className="notice">
              This backup has no care plan. After the import, enter your current care plan settings.
            </p>
          )}
          {summary.connectionRows > 0 && (
            <p className="notice">
              Dexcom Share sign-in is not imported, because it only works on the deployment where it
              was saved. Glucose readings and Dexcom events are imported. To receive new readings,
              connect Dexcom Share again from Care tools.
            </p>
          )}
          <label className="check-row">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={blocked}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>This backup belongs to the person whose care I record in this account.</span>
          </label>
          {replacing && (
            <label className="check-row">
              <input
                type="checkbox"
                checked={replaceConfirmed}
                onChange={(event) => setReplaceConfirmed(event.target.checked)}
              />
              <span>I understand this replaces all records currently in this account.</span>
            </label>
          )}
          <div className="backup-actions">
            {replacing ? (
              <button
                type="button"
                className="button destructive"
                disabled={!confirmed || !replaceConfirmed}
                onClick={() => void upload(review.file, summary, review.header, true)}
              >
                Replace records from backup
              </button>
            ) : (
              <button
                type="button"
                className="button primary"
                disabled={!confirmed || blocked}
                onClick={() => void upload(review.file, summary, review.header, false)}
              >
                Import {count(summary.importRows)} records
              </button>
            )}
            <button
              type="button"
              className="button subtle"
              onClick={() => {
                setPhase({ name: "choose" });
                resetConfirmations();
              }}
            >
              Choose another file
            </button>
          </div>
        </div>
      )}
      {progress && (
        <div className="backup-progress" role="status">
          <p>
            Uploaded {count(progress.sent)} of {count(progress.summary.totalRows)} records.
          </p>
          <progress max={progress.summary.totalRows} value={progress.sent} />
          <p className="helper">
            {progress.replace
              ? "Keep this page open. The current records stay until every backup record has been checked."
              : "Keep this page open. The records appear in this account only after every one has been checked."}
          </p>
          <button type="button" className="button subtle" onClick={() => void cancel()}>
            {progress.replace ? "Cancel replacement" : "Cancel import"}
          </button>
        </div>
      )}
      {phase.name === "finishing" && summary && (
        <div className="backup-progress" role="status">
          <p>
            {phase.replace
              ? `Replacing this account's records with ${count(summary.importRows)} records…`
              : `Checking and saving ${count(summary.importRows)} records…`}
          </p>
          <progress />
          <p className="helper">Keep this page open.</p>
        </div>
      )}
      {phase.name === "cancelling" && (
        <p className="backup-progress" role="status">
          Cancelling the import…
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="notice danger" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
