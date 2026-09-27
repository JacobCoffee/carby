"use client";
import { apiFetch, personHref } from "@/lib/person-request";
import { usePersonAccess } from "./person-context";
import { useEffect, useId, useRef, useState } from "react";
import { Check, Loader2, RefreshCw, Trash2 } from "lucide-react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { ClarityReport } from "@/lib/clarity-client";
import type { ClarityStatus, ClaritySyncResult } from "@/lib/clarity-sync";

export const REPORT_KINDS: { id: ClarityReport; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "patterns", label: "Patterns" },
  { id: "daily", label: "Daily" },
  { id: "compare", label: "Compare" },
  { id: "overlay", label: "Overlay" },
  { id: "hourlyStatistics", label: "Hourly statistics" },
  { id: "dailyStatistics", label: "Daily statistics" },
  { id: "agp", label: "AGP report" },
];

function toggleKind(list: ClarityReport[], id: ClarityReport): ClarityReport[] {
  return list.includes(id) ? list.filter((k) => k !== id) : [...list, id];
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The report kinds in a PDF, named as Clarity names them and in Clarity's order. */
export function reportKindNames(kinds: ClarityReport[]) {
  return REPORT_KINDS.filter((r) => kinds.includes(r.id))
    .map((r) => r.label)
    .join(", ");
}

/** A short name for a set of monthly reports, for a collapsed section's summary line. */
function monthlyKindsSummary(kinds: ClarityReport[]) {
  return kinds.length > 2 ? `${kinds.length} report types` : reportKindNames(kinds);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function syncSummary(result: ClaritySyncResult): string {
  if (result.changed === 0 && result.newEvents === 0) return "Clarity had nothing new";
  return `${result.changed} new glucose points and ${result.newEvents} events from Clarity`;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function errorMessage(data: Record<string, unknown>, fallback: string): string {
  return typeof data.error === "string" && data.error ? data.error : fallback;
}

/** A failed sync or report stores its reason on the connection, so callers reload to show it. */
async function fetchStatus(): Promise<ClarityStatus> {
  const response = await apiFetch("/api/clarity", { cache: "no-store" });
  const data = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(data, "Could not load Clarity status."));
  return data as unknown as ClarityStatus;
}

export default function ClarityPanel({
  timezone,
  onImported,
}: {
  timezone: string;
  onImported: () => void;
}) {
  const { person } = usePersonAccess();
  const [status, setStatus] = useState<ClarityStatus | null>(null);
  // Read once per mount; the expiry warning does not need to tick.
  const [mountedAt] = useState(Date.now);
  const ids = useId();
  const [loadError, setLoadError] = useState("");

  // Connect form
  const [code, setCode] = useState("");
  const [region, setRegion] = useState<"us" | "ous">("us");
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [checkResult, setCheckResult] = useState<{
    subjectName: string;
    expiresAt: string | null;
  } | null>(null);
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [connectAutoSync, setConnectAutoSync] = useState(true);
  const [connectMonthlyReports, setConnectMonthlyReports] = useState<ClarityReport[]>([]);
  const [connecting, setConnecting] = useState(false);

  // Connected state
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  // Settings
  const [settingsAutoSync, setSettingsAutoSync] = useState(true);
  const [settingsMonthlyReports, setSettingsMonthlyReports] = useState<ClarityReport[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const settingsInitialized = useRef(false);

  // Report generation
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  const [reportKinds, setReportKinds] = useState<ClarityReport[]>(["overview", "agp"]);
  const [reportStart, setReportStart] = useState(addDays(today, -13));
  const [reportEnd, setReportEnd] = useState(today);
  const [reportBusy, setReportBusy] = useState(false);
  const [deletingReportId, setDeletingReportId] = useState<string | null>(null);

  useEffect(() => {
    fetchStatus()
      .then(setStatus)
      .catch((e) =>
        setLoadError(e instanceof Error ? e.message : "Could not load Clarity status."),
      );
  }, []);

  useEffect(() => {
    if (status?.connected && !settingsInitialized.current) {
      settingsInitialized.current = true;
      setSettingsAutoSync(status.autoSync);
      setSettingsMonthlyReports(status.monthlyReports);
    }
    if (!status?.connected) settingsInitialized.current = false;
  }, [status]);

  const dateTimeFmt = (iso: string) =>
    `${new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric", year: "numeric" }).format(new Date(iso))} at ${new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(iso))}`;
  const dateFmt = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso));
  const dateOnlyFmt = (dateStr: string) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)));
  };

  const normalizedCode = code.replace(/[\s-]/g, "");
  const busy =
    checking ||
    connecting ||
    syncing ||
    disconnecting ||
    savingSettings ||
    reportBusy ||
    !!deletingReportId;

  async function checkCode() {
    setChecking(true);
    setCheckError("");
    try {
      const response = await apiFetch("/api/clarity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check", code: normalizedCode, region }),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(errorMessage(data, "Could not check that code."));
      setCheckResult({
        subjectName: data.subjectName as string,
        expiresAt: (data.expiresAt as string | null) ?? null,
      });
      setIdentityConfirmed(false);
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : "Could not check that code.");
      setCheckResult(null);
    } finally {
      setChecking(false);
    }
  }

  async function connectAndImport() {
    if (!checkResult || !identityConfirmed) return;
    setConnecting(true);
    setCheckError("");
    try {
      const connectResponse = await apiFetch("/api/clarity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "connect",
          code: normalizedCode,
          region,
          subjectName: checkResult.subjectName,
          autoSync: connectAutoSync,
          monthlyReports: connectMonthlyReports,
        }),
      });
      const connectData = await readJson(connectResponse);
      if (!connectResponse.ok)
        throw new Error(errorMessage(connectData, "Could not connect Clarity."));
      setStatus(connectData as unknown as ClarityStatus);
      const syncResponse = await apiFetch("/api/clarity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync", start: addDays(today, -89), end: today }),
      });
      const syncData = await readJson(syncResponse);
      if (!syncResponse.ok)
        throw new Error(errorMessage(syncData, "Connected, but the first sync failed."));
      setStatus(syncData as unknown as ClarityStatus);
      toast.success(syncSummary(syncData.result as ClaritySyncResult));
      onImported();
      setCode("");
      setCheckResult(null);
      setIdentityConfirmed(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not connect Clarity.");
      void fetchStatus().then(setStatus, () => undefined);
    } finally {
      setConnecting(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    try {
      const start = status?.syncedThrough ? addDays(status.syncedThrough, -2) : addDays(today, -13);
      const response = await apiFetch("/api/clarity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync", start, end: today }),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(errorMessage(data, "Sync failed."));
      setStatus(data as unknown as ClarityStatus);
      toast.success(syncSummary(data.result as ClaritySyncResult));
      onImported();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed.");
      void fetchStatus().then(setStatus, () => undefined);
    } finally {
      setSyncing(false);
    }
  }

  async function saveSettings() {
    setSavingSettings(true);
    try {
      const response = await apiFetch("/api/clarity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "settings",
          autoSync: settingsAutoSync,
          monthlyReports: settingsMonthlyReports,
        }),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(errorMessage(data, "Could not save settings."));
      setStatus(data as unknown as ClarityStatus);
      toast.success("Clarity settings saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save settings.");
    } finally {
      setSavingSettings(false);
    }
  }

  async function generateReport() {
    if (!reportKinds.length) return;
    setReportBusy(true);
    try {
      const response = await apiFetch("/api/clarity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "report",
          reports: reportKinds,
          start: reportStart,
          end: reportEnd,
        }),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(errorMessage(data, "Could not generate the report."));
      setStatus(data as unknown as ClarityStatus);
      toast.success("Clarity report ready.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate the report.");
      void fetchStatus().then(setStatus, () => undefined);
    } finally {
      setReportBusy(false);
    }
  }

  async function deleteReport(id: string) {
    setDeletingReportId(id);
    try {
      const response = await apiFetch(`/api/clarity/report?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(errorMessage(data, "Could not delete the report."));
      setStatus((current) =>
        current ? { ...current, reports: current.reports.filter((r) => r.id !== id) } : current,
      );
      toast.success("Report deleted.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete the report.");
    } finally {
      setDeletingReportId(null);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    try {
      const response = await apiFetch("/api/clarity", { method: "DELETE" });
      const data = await readJson(response);
      if (!response.ok) throw new Error(errorMessage(data, "Could not disconnect."));
      setStatus(data as unknown as ClarityStatus);
      toast.success("Disconnected. Readings and reports stay in the log.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not disconnect.");
    } finally {
      setDisconnecting(false);
      setConfirmDisconnect(false);
    }
  }

  if (!status && !loadError) return <p role="status">Loading Clarity status…</p>;
  if (loadError && !status)
    return (
      <p className="notice danger" role="alert">
        {loadError}
      </p>
    );
  if (!status) return null;

  const daysUntilExpiry = status.expiresAt
    ? Math.floor((Date.parse(status.expiresAt) - mountedAt) / 86_400_000)
    : null;

  return (
    <div className="entry-form clarity-panel">
      <p className="helper">
        Clarity data is retrospective. Do not use it to make current glucose decisions — check the
        primary device instead.
      </p>
      {!status.connected ? (
        <>
          <p className="helper">
            Make a code in the Clarity mobile app: Profile → Authorize Sharing → Generate Code →
            12-month option.
          </p>
          <div className="clarity-code-row">
            <label className="field">
              <span>Share code</span>
              <input
                value={code}
                disabled={busy}
                placeholder="XXXX-XXXX-XXXX"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => {
                  setCode(e.target.value);
                  setCheckResult(null);
                  setCheckError("");
                }}
              />
            </label>
            <label className="field" htmlFor={`${ids}-region`}>
              <span>Region</span>
              <Select
                value={region}
                onValueChange={(v) => setRegion(v as "us" | "ous")}
                disabled={busy}
              >
                <SelectTrigger className="choice" id={`${ids}-region`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="us">United States</SelectItem>
                  <SelectItem value="ous">Outside the United States</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
          <button
            type="button"
            className="button subtle"
            disabled={busy || !normalizedCode}
            onClick={() => void checkCode()}
          >
            {checking ? <Loader2 size={16} className="spin" /> : null}
            Check code
          </button>
          {checkError && (
            <p className="notice danger" role="alert">
              {checkError}
            </p>
          )}
          {checkResult && (
            <>
              <p className="notice" role="status">
                This code opens Clarity data for {checkResult.subjectName}.{" "}
                {checkResult.expiresAt
                  ? `It expires on ${dateFmt(checkResult.expiresAt)}.`
                  : "It has no listed expiry."}
              </p>
              <label className="check-row" htmlFor={`${ids}-identity`}>
                <Checkbox
                  id={`${ids}-identity`}
                  checked={identityConfirmed}
                  onCheckedChange={(v) => setIdentityConfirmed(v === true)}
                  disabled={busy}
                />
                <span>This is the person this care log belongs to.</span>
              </label>
              <label className="check-row" htmlFor={`${ids}-connect-daily`}>
                <Checkbox
                  id={`${ids}-connect-daily`}
                  checked={connectAutoSync}
                  onCheckedChange={(v) => setConnectAutoSync(v === true)}
                  disabled={busy}
                />
                <span>Sync every day</span>
              </label>
              <details className="clarity-section">
                <summary>
                  <span>Monthly report archive</span>
                  <small>
                    {connectMonthlyReports.length
                      ? monthlyKindsSummary(connectMonthlyReports)
                      : "Optional · off"}
                  </small>
                </summary>
                <p className="helper">
                  Generate and keep these reports once a month. You can also make reports whenever
                  you like after connecting.
                </p>
                <div className="clarity-kind-grid">
                  {REPORT_KINDS.map((kind) => (
                    <label className="check-row" key={kind.id}>
                      <Checkbox
                        checked={connectMonthlyReports.includes(kind.id)}
                        onCheckedChange={() =>
                          setConnectMonthlyReports(toggleKind(connectMonthlyReports, kind.id))
                        }
                        disabled={busy}
                      />
                      <span>{kind.label}</span>
                    </label>
                  ))}
                </div>
              </details>
              <button
                type="button"
                className="button primary full"
                disabled={busy || !identityConfirmed}
                onClick={() => void connectAndImport()}
              >
                {connecting ? <Loader2 size={17} className="spin" /> : <Check size={17} />}
                Connect and import the last 90 days
              </button>
            </>
          )}
        </>
      ) : (
        <>
          <dl className="clarity-status">
            <div>
              <dt>Connected as</dt>
              <dd>{status.subjectName ?? "This account"}</dd>
            </div>
            <div>
              <dt>Share code expires</dt>
              <dd>{status.expiresAt ? dateFmt(status.expiresAt) : "No expiry"}</dd>
            </div>
            <div>
              <dt>Last sync</dt>
              <dd>{status.lastSync ? dateTimeFmt(status.lastSync) : "Not yet"}</dd>
            </div>
            <div>
              <dt>Data through</dt>
              <dd>{status.syncedThrough ? dateOnlyFmt(status.syncedThrough) : "Not yet"}</dd>
            </div>
          </dl>
          {daysUntilExpiry !== null && daysUntilExpiry < 30 && (
            <p className="notice timing-warning" role="alert">
              {daysUntilExpiry < 0
                ? "The Clarity share code has expired."
                : `The Clarity share code expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? "" : "s"}.`}{" "}
              Generate a new code in the Clarity app (Profile → Authorize Sharing → Generate Code)
              and reconnect below.
            </p>
          )}
          {status.lastError && (
            <p className="notice danger" role="alert">
              {status.lastError}
            </p>
          )}
          <button
            type="button"
            className="button primary full"
            disabled={busy}
            onClick={() => void syncNow()}
          >
            {syncing ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
            Sync now
          </button>

          <details className="clarity-section">
            <summary>
              <span>Automatic sync</span>
              <small>
                {status.autoSync ? "Daily" : "Off"}
                {status.monthlyReports.length
                  ? ` · monthly: ${monthlyKindsSummary(status.monthlyReports)}`
                  : " · no monthly reports"}
              </small>
            </summary>
            <label className="check-row" htmlFor={`${ids}-daily`}>
              <Checkbox
                id={`${ids}-daily`}
                checked={settingsAutoSync}
                onCheckedChange={(v) => setSettingsAutoSync(v === true)}
                disabled={busy}
              />
              <span>Sync every day</span>
            </label>
            <p className="helper">Monthly report archive</p>
            <div className="clarity-kind-grid">
              {REPORT_KINDS.map((kind) => (
                <label className="check-row" key={kind.id}>
                  <Checkbox
                    checked={settingsMonthlyReports.includes(kind.id)}
                    onCheckedChange={() =>
                      setSettingsMonthlyReports(toggleKind(settingsMonthlyReports, kind.id))
                    }
                    disabled={busy}
                  />
                  <span>{kind.label}</span>
                </label>
              ))}
            </div>
            <button
              type="button"
              className="button outline"
              disabled={busy}
              onClick={() => void saveSettings()}
            >
              {savingSettings ? <Loader2 size={15} className="spin" /> : null}
              Save settings
            </button>
          </details>

          <details className="clarity-section">
            <summary>
              <span>Make a report</span>
              <small>PDF from Clarity, up to 90 days</small>
            </summary>
            <div className="clarity-kind-grid">
              {REPORT_KINDS.map((kind) => (
                <label className="check-row" key={kind.id}>
                  <Checkbox
                    checked={reportKinds.includes(kind.id)}
                    onCheckedChange={() => setReportKinds(toggleKind(reportKinds, kind.id))}
                    disabled={busy}
                  />
                  <span>{kind.label}</span>
                </label>
              ))}
            </div>
            <div className="illness-field-row">
              <label className="field">
                <span>Start</span>
                <input
                  type="date"
                  value={reportStart}
                  max={reportEnd}
                  disabled={busy}
                  onChange={(e) => setReportStart(e.target.value)}
                />
              </label>
              <label className="field">
                <span>End</span>
                <input
                  type="date"
                  value={reportEnd}
                  min={reportStart}
                  max={today}
                  disabled={busy}
                  onChange={(e) => setReportEnd(e.target.value)}
                />
              </label>
            </div>
            <button
              type="button"
              className="button outline"
              disabled={busy || !reportKinds.length}
              onClick={() => void generateReport()}
            >
              {reportBusy ? <Loader2 size={16} className="spin" /> : null}
              {reportBusy ? "Generating… this can take a couple of minutes" : "Generate report"}
            </button>
          </details>

          <fieldset className="clarity-kinds">
            <legend>Reports ({status.reports.length})</legend>
            {status.reports.length === 0 ? (
              <p className="helper">No reports yet.</p>
            ) : (
              <ul className="clarity-report-list">
                {status.reports.map((report) => (
                  <li key={report.id} className="clarity-report-row">
                    <div>
                      <strong>
                        {dateOnlyFmt(report.startDate)} – {dateOnlyFmt(report.endDate)}
                      </strong>{" "}
                      {report.scheduled && <Badge variant="secondary">Monthly</Badge>}
                      <p className="helper">
                        {reportKindNames(report.reports)}
                        {" · "}
                        {formatSize(report.size)}
                      </p>
                    </div>
                    <div className="clarity-report-actions">
                      <a
                        className="button subtle"
                        href={personHref(
                          `/api/clarity/report?id=${encodeURIComponent(report.id)}`,
                          person,
                        )}
                        download
                      >
                        Download
                      </a>
                      <button
                        type="button"
                        className="text-button delete"
                        disabled={deletingReportId === report.id}
                        onClick={() => void deleteReport(report.id)}
                      >
                        {deletingReportId === report.id ? (
                          <Loader2 size={15} className="spin" />
                        ) : (
                          <Trash2 size={15} />
                        )}
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

          <button
            type="button"
            className="text-button delete"
            disabled={busy}
            onClick={() => setConfirmDisconnect(true)}
          >
            Disconnect Clarity
          </button>
        </>
      )}
      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogTitle>Disconnect Clarity?</AlertDialogTitle>
          <AlertDialogDescription>
            Readings and reports already imported stay in the log. Daily sync and the monthly report
            archive stop until you reconnect.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnecting}>Keep connected</AlertDialogCancel>
            <AlertDialogAction
              disabled={disconnecting}
              className="danger-button"
              onClick={(event) => {
                event.preventDefault();
                void disconnect();
              }}
            >
              {disconnecting ? <Loader2 size={16} className="spin" /> : null}
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
