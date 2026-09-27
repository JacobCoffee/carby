"use client";
import { apiFetch } from "@/lib/person-request";
import { useEffect, useEffectEvent, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Thermometer,
  Activity,
  ArrowUpRight,
  BarChart3,
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Command as CommandIcon,
  Droplet,
  Eye,
  Heart,
  Loader2,
  LogOut,
  Moon,
  Plus,
  Settings2,
  Syringe,
  Utensils,
  Calculator,
  Phone,
  FileDown,
  Upload,
  Menu,
  RefreshCw,
  User,
  SunMoon,
  BookOpen,
  Dumbbell,
  Siren,
  Candy,
  Users,
  Keyboard,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import CommandPalette, {
  type CommandPaletteGroup,
  type CommandPaletteItem,
} from "./command-palette";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  THEME_OPTIONS,
  getStoredThemePreference,
  initThemeSync,
  setThemePreference,
  type ThemePreference,
} from "@/lib/theme";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import PersonMenu from "./person-menu";
import LogMenu, { type LogAction } from "./log-menu";
import { useHoverMenu } from "./hover-menu";
import ShortcutsDialog from "./shortcuts-dialog";
import { createShortcutMatcher } from "@/lib/shortcuts";
import { SHOW_HINTS } from "./button-hints";
import { usePersonAccess } from "./person-context";
import { useSheetHeader } from "./sheet-header";
import { can, personLabel } from "@/lib/people";
import { personHref } from "@/lib/person-request";
import { toast } from "sonner";
import DoctorReport from "./doctor-report";
import CareHandoff from "./care-handoff";
import Insights from "./insights";
import GlucoseChart from "./glucose-chart";
import CareSetup from "./care-setup";
import ProfilePrompt from "./profile-prompt";
import { FoodPicker } from "./food-picker";
import ClarityPanel from "./clarity-panel";
import type { Profile } from "@/lib/profile";
import { MealRatioFields } from "./meal-ratio-fields";
import { GlucoseRangeFields } from "./glucose-range-fields";
import {
  CareContactFields,
  OtherContactFields,
  contactIssues,
  otherContactIssues,
} from "./care-contacts";
import {
  PlanSettingsFields,
  planSettingsIssues,
  planSettingsKeys,
  type PlanSettingsKey,
} from "./plan-settings-fields";
import Logbook from "./logbook";
import SickDayDialog from "./sick-day-dialog";
import LowTreatmentDialog from "./low-treatment-dialog";
import CallNotices from "./call-notices";
import AppointmentsPanel, { NextAppointmentChip } from "./appointments-panel";
import { sickDayStatus } from "@/lib/sick-day";
import { callTriggers } from "@/lib/call-triggers";
import { lowRecheck } from "@/lib/low-treatment";
import { overnightBannerShown, overnightCheck } from "@/lib/overnight-check";
import type { Appointment } from "@/lib/appointments";
import {
  CarePlanInstructions,
  EmergencyInstructionFields,
  instructionIssues,
} from "./emergency-instructions";
import "./care-workspace.css";
import Link from "next/link";
import { CarbyWordmark } from "./carby-wordmark";
import { summarizeCgm } from "@/lib/cgm-metrics";
import {
  clarityBehind,
  currentSensor,
  timeAgo,
  type ClarityFreshness,
  type SensorSession,
} from "@/lib/cgm-summary";
import { glucoseLevel, glucoseLevelNames, glucoseLevelRanges } from "@/lib/glucose-metrics";
import { isRecentReading } from "@/lib/reading-freshness";
import { currentShareForCorrection } from "@/lib/correction-reading";
import { correctionMarkerAt } from "@/lib/correction-marker";
import { mealRatioAt } from "@/lib/report-analysis";
import { foodDosePrompt, type FoodDosePrompt } from "@/lib/food-dose-prompt";
import type { SyncStatus } from "@/lib/sync";
import { SyncNotice } from "./sync-notice";
import { correctionReviewStatus, readingAboveRange } from "@/lib/correction-review";
import { nightlyReminder } from "@/lib/nightly-reminder";
import { estimateLabel, glucoseEstimate } from "@/lib/glucose-estimate";
import { EstimateChart } from "./estimate-chart";
import CareHeaderReminders, { OvernightBanner } from "./care-header-reminders";
import DexcomCredentialsForm, { type DexcomCredentials } from "./dexcom-credentials";
import IllnessDialog from "./illness-dialog";
import IllnessCheckInDialog from "./illness-check-in-dialog";
import TimeZoneField from "./time-zone-field";
import EntryDialog, { type EntryModalKind, type EntryPrefill } from "./entry-dialog";
import DailyLog from "./daily-log";
import {
  illnessOverlap,
  periodKind,
  periodKindLabels,
  type IllnessCheckIn,
  type IllnessWindow,
} from "@/lib/illness";
import { chartDayWindow, chartRangeDays, type ChartRange } from "@/lib/chart-window";
import DoseFlow from "./dose-flow";
import {
  foodItemsNote,
  mealLabel,
  mealLinks,
  relatedMealRecords,
  mealDoseFoods,
  type DoseFood,
} from "@/lib/meal-log";
import { parseClarity } from "@/lib/clarity";
import type { PublicDexcomDefaults } from "@/lib/dexcom-defaults";
import { createRefreshGate, CARE_CHANGED, notifyCareChanged } from "@/lib/live-refresh";
import { useClarityBackfill } from "@/hooks/use-clarity-backfill";
import {
  careContactLinks,
  careContactLines,
  glucoseRanges,
  meterStatusLabel,
  getCarbRatio,
  getMealRatios,
  ratioSummary,
  type MealRatio,
  math,
  dateKey,
  localInput,
  fromLocal,
  planSchema,
  type CareContactKey,
  type EmergencyInstructionKey,
  type Plan,
  type PlanDraft,
  type Entry,
  type FoodItem,
  type SavedFood,
  type CgmReading,
  type DexcomEvent,
  savedFoodSchema,
  temperatureUnits,
  temperatureUnitLabels,
  type TemperatureUnit,
} from "@/lib/care";
type CareSnapshot = {
  illnessWindows?: IllnessWindow[];
  appointments?: Appointment[];
  entries: Entry[];
  plan: Plan | null;
  planDraft?: PlanDraft;
  profile?: Profile | null;
  savedFoods: SavedFood[];
  cgm: CgmReading[];
  dexcomEvents: DexcomEvent[];
  historyLimited?: boolean;
  sync?: SyncStatus | null;
  sensor?: SensorSession | null;
  clarity?: ClarityFreshness | null;
  error?: string;
};
type ShareStatus = {
  connected: boolean;
  lastSync?: string | null;
  lastAttemptAt?: string | null;
  lastError?: string | null;
  latestShareAt?: string | null;
  // The server sends the configured username and region only. The password stays there.
  defaults?: PublicDexcomDefaults | null;
};
const fmt = (n: number) => Number(n.toFixed(2)).toString();
export default function Dashboard({ initialPlan }: { initialPlan: Plan }) {
  const [setup, setSetup] = useState<{ incompletePlan?: PlanDraft } | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const personAccess = usePersonAccess();
  const sheetHeader = useSheetHeader();
  const canLog = can(personAccess.role, "log");
  const canManage = can(personAccess.role, "manage");
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [dexcomEvents, setDexcomEvents] = useState<DexcomEvent[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]),
    [savedFoods, setSavedFoods] = useState<SavedFood[]>([]),
    [cgm, setCgm] = useState<CgmReading[]>([]),
    [plan, setPlan] = useState<Plan>(initialPlan),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [now, setNow] = useState<Date | null>(null),
    [day, setDay] = useState("");
  const [illnessWindows, setIllnessWindows] = useState<IllnessWindow[]>([]),
    [illnessEditor, setIllnessEditor] = useState<{ record: IllnessWindow | null } | null>(null),
    [checkInEditor, setCheckInEditor] = useState<{
      illnessId: string;
      checkIn: IllnessCheckIn | null;
    } | null>(null);
  const refreshGate = useRef(createRefreshGate()),
    writeRunning = useRef(false),
    hasLoaded = useRef(false),
    careEtag = useRef<string | null>(null);
  const nextRefreshAt = useRef(0),
    refreshFailures = useRef(0),
    dexcomEpoch = useRef(0),
    lastAttemptRef = useRef<string | null>(null);
  const [refreshing, setRefreshing] = useState(false),
    [refreshError, setRefreshError] = useState(""),
    [lastChecked, setLastChecked] = useState<Date | null>(null),
    [online, setOnline] = useState(true);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const formsOpenRef = useRef(false),
    pendingPlan = useRef<Plan | null>(null);

  const [historyLimited, setHistoryLimited] = useState(false);
  const [syncState, setSyncState] = useState<SyncStatus | null>(null);
  const [sensor, setSensor] = useState<SensorSession | null>(null),
    [claritySync, setClaritySync] = useState<ClarityFreshness | null>(null);
  // Gaps from being out of range of the phone or receiver fill in from Clarity on their own.
  useClarityBackfill(claritySync !== null);
  // Null keeps the chart's responsive default until a range is picked; the pick survives day changes.
  const [chartRange, setChartRange] = useState<ChartRange | null>(null);
  const [importOpen, setImportOpen] = useState(false),
    [importing, setImporting] = useState(false),
    [importMessage, setImportMessage] = useState("");
  const [pendingCsv, setPendingCsv] = useState<{
    fileName: string;
    parsed: ReturnType<typeof parseClarity>;
  } | null>(null);
  const [csvIdentityConfirmed, setCsvIdentityConfirmed] = useState(false);
  const [dexcomConnected, setDexcomConnected] = useState(false),
    [dexcomLastSync, setDexcomLastSync] = useState<string | null>(null),
    [dexcomLastAttempt, setDexcomLastAttempt] = useState<string | null>(null),
    [dexcomFailure, setDexcomFailure] = useState<string | null>(null),
    [dexcomLatestShareAt, setDexcomLatestShareAt] = useState<string | null>(null),
    [dexcomBusy, setDexcomBusy] = useState(false),
    [dexcomMessage, setDexcomMessage] = useState("");
  const [changingDexcomAccount, setChangingDexcomAccount] = useState(false);
  const [dexcomDefaults, setDexcomDefaults] = useState<PublicDexcomDefaults | null>(null);
  // Server settings, applied once per mount; the credentials form owns the typed values.
  const dexcomDefaultsApplied = useRef(false);
  const syncRunning = useRef(false),
    latestShareRef = useRef<string | null>(null),
    lastSyncRef = useRef<string | null>(null);
  const [modal, setModal] = useState<EntryModalKind | null>(null),
    [editing, setEditing] = useState<Entry | null>(null),
    [entryPrefill, setEntryPrefill] = useState<EntryPrefill | null>(null);
  const [cgmInterval, setCgmInterval] = useState<15 | 30 | 60>(30);
  const [selectedFoodIds, setSelectedFoodIds] = useState<string[]>([]);
  // A new food entry at or over the plan's snack cutoff offers the calculator, prefilled.
  const [foodDose, setFoodDose] = useState<FoodDosePrompt | null>(null);
  const [doseFlow, setDoseFlow] = useState<{
    mode: "Carbs" | "Correction" | "Carbs + correction";
    meal: MealRatio | null;
    carbs: string;
    foodItems: FoodItem[];
    linkedFoodIds: string[];
  } | null>(null);
  const linkedRecordIds = useMemo(
    () => new Set(mealLinks(entries).flatMap(({ food, dose }) => [food.id, dose.id])),
    [entries],
  );
  const editingLinks = editing ? relatedMealRecords(editing, entries) : [];
  const [showFoodTools, setShowFoodTools] = useState(false);
  const [foodBuilderItems, setFoodBuilderItems] = useState<FoodItem[]>([]);
  const [nightOpen, setNightOpen] = useState(false);
  const [lowTreatmentOpen, setLowTreatmentOpen] = useState(false);
  const [sickDayOpen, setSickDayOpen] = useState(false);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const careTeamName = plan.contacts?.careTeamName;
  const contactLines = careContactLines(plan.contacts);
  const [emergencyLink] = careContactLinks(plan.contacts, ["emergencyPhone"]);
  const instructions = plan.emergencyInstructions ?? {};
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [shortcutKeys] = useState(() => createShortcutMatcher());
  const careMenu = useHoverMenu();
  const [themePref, setThemePrefState] = useState<ThemePreference>("system");
  useEffect(() => {
    setThemePrefState(getStoredThemePreference());
    return initThemeSync(setThemePrefState);
  }, []);
  function chooseTheme(pref: ThemePreference) {
    setThemePreference(pref);
    setThemePrefState(pref);
  }
  // ⌘K and / open the palette, ? and ⌘/ the shortcut sheet; bare keys run Linear-style shortcuts
  // (C, or L then G) through the palette's own items, so disabled and view-only rules still hold.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const meta = event.metaKey || event.ctrlKey;
    if (meta && (event.key === "k" || event.key === "K")) {
      event.preventDefault();
      setCommandOpen((v) => !v);
      return;
    }
    if (meta && event.key === "/") {
      event.preventDefault();
      setShortcutsOpen((v) => !v);
      return;
    }
    if (meta || event.altKey || event.repeat || event.isComposing || event.key.length !== 1) return;
    const target = event.target as HTMLElement | null;
    const inTextField =
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT");
    // Only the bare page takes shortcuts: never a field, a dialog, a menu or the palette.
    if (
      inTextField ||
      document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')
    ) {
      shortcutKeys.reset();
      return;
    }
    if (event.key === "/" || event.key === "?") {
      event.preventDefault();
      shortcutKeys.reset();
      if (event.key === "/") setCommandOpen(true);
      else setShortcutsOpen(true);
      return;
    }
    const result = shortcutKeys.press(event.key, event.timeStamp);
    if (!result) return;
    event.preventDefault();
    if (result === "pending") return;
    const item = commandGroups()
      .flatMap((group) => group.items)
      .find((candidate) => candidate.id === result.id);
    if (item && !item.disabled) item.onSelect();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);
  const [desktopLog, setDesktopLog] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1000px)");
    const update = () => setDesktopLog(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const [view, setView] = useState("daily");
  const [selectionMeal, setSelectionMeal] = useState<MealRatio | null>(null);
  const formsOpen = !!(
    illnessEditor ||
    modal ||
    doseFlow ||
    showFoodTools ||
    pendingCsv ||
    lowTreatmentOpen ||
    foodDose
  );
  useEffect(() => {
    formsOpenRef.current = formsOpen;
  }, [formsOpen]);
  useEffect(() => {
    if (!formsOpen && pendingPlan.current) {
      setPlan(pendingPlan.current);
      pendingPlan.current = null;
    }
  }, [formsOpen]);
  function load(fresh = false): Promise<boolean> {
    if (writeRunning.current) return Promise.resolve(false);
    if (fresh) refreshGate.current.invalidate();
    setRefreshing(true);
    return refreshGate.current.run(
      async (signal) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        const abort = () => controller.abort();
        signal.addEventListener("abort", abort, { once: true });
        const statusEpoch = dexcomEpoch.current;
        try {
          const [response, status] = await Promise.all([
            apiFetch("/api/care", {
              cache: "no-store",
              signal: controller.signal,
              headers: careEtag.current ? { "If-None-Match": careEtag.current } : {},
            }),
            apiFetch("/api/dexcom", { cache: "no-store", signal: controller.signal })
              .then(async (response) =>
                response.ok ? ((await response.json()) as ShareStatus) : null,
              )
              .catch(() => null),
          ]);
          const data = response.status === 304 ? null : ((await response.json()) as CareSnapshot);
          if (response.status !== 304 && !response.ok)
            throw new Error(data?.error ?? "Could not refresh the care log.");
          return { data, etag: response.headers.get("ETag"), status, statusEpoch };
        } finally {
          clearTimeout(timeout);
          signal.removeEventListener("abort", abort);
        }
      },
      ({ data, etag, status, statusEpoch }) => {
        if (data) {
          setProfile(data.profile ?? null);
          if (!data.plan) {
            setSetup({ incompletePlan: data.planDraft });
            return;
          }
          const loadedTimezone = data.plan.timezone;
          setIllnessWindows(data.illnessWindows ?? []);
          setAppointments(data.appointments ?? []);
          setEntries(data.entries);
          setHistoryLimited(!!data.historyLimited);
          setSyncState(data.sync ?? null);
          setSensor(data.sensor ?? null);
          setClaritySync(data.clarity ?? null);
          setSavedFoods(data.savedFoods ?? []);
          setCgm(data.cgm ?? []);
          setDexcomEvents(data.dexcomEvents ?? []);
          if (formsOpenRef.current && hasLoaded.current) pendingPlan.current = data.plan;
          else {
            setPlan(data.plan);
            pendingPlan.current = null;
          }
          setDay((day) => day || dateKey(new Date(), loadedTimezone));
        }
        // Server settings, not live status: apply them once and never over a typed edit.
        if (status && !dexcomDefaultsApplied.current) {
          dexcomDefaultsApplied.current = true;
          setDexcomDefaults(status.defaults ?? null);
        }
        if (status && statusEpoch === dexcomEpoch.current && !syncRunning.current) {
          lastSyncRef.current = status.lastSync ?? null;
          latestShareRef.current = status.latestShareAt ?? null;
          lastAttemptRef.current = status.lastAttemptAt ?? null;
          setDexcomConnected(!!status.connected);
          setDexcomLastSync(lastSyncRef.current);
          setDexcomLastAttempt(lastAttemptRef.current);
          setDexcomFailure(status.lastError ?? null);
          setDexcomLatestShareAt(latestShareRef.current);
        }
        careEtag.current = etag;
        hasLoaded.current = true;
        refreshFailures.current = 0;
        nextRefreshAt.current = 0;
        setNow(new Date());
        setLastChecked(new Date());
        setError("");
        setRefreshError("");
        setLoading(false);
        setRefreshing(false);
      },
      (error) => {
        const message =
          error instanceof Error && error.name !== "AbortError"
            ? error.message
            : "Could not refresh. Retrying automatically.";
        if (hasLoaded.current) setRefreshError(message);
        else setError(message);
        refreshFailures.current++;
        nextRefreshAt.current =
          Date.now() + Math.min(120_000, 30_000 * 2 ** refreshFailures.current);
        setLoading(false);
        setRefreshing(false);
      },
    );
  }
  // Update data without replacing the page or any open drafts.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const eligible = () => document.visibilityState === "visible" && navigator.onLine;
    const refresh = () => {
      setOnline(navigator.onLine);
      setNow(new Date());
      if (eligible()) void load();
    };
    const changed = () => {
      nextRefreshAt.current = 0;
      if (eligible()) void load(true);
    };
    const offline = () => setOnline(false);
    const channel =
      typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CARE_CHANGED);
    if (channel) channel.onmessage = changed;
    const gate = refreshGate.current;
    setOnline(navigator.onLine);
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        setNow(new Date());
        if (eligible() && Date.now() >= nextRefreshAt.current) void load();
      }
    }, 30_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener(CARE_CHANGED, changed);
    return () => {
      clearInterval(timer);
      gate.invalidate();
      channel?.close();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener(CARE_CHANGED, changed);
    };
  }, []);
  async function refreshAll() {
    setManualRefreshing(true);
    window.dispatchEvent(new Event(CARE_CHANGED));
    try {
      await Promise.all([load(), dexcomConnected ? syncDexcom(true) : Promise.resolve(null)]);
    } finally {
      setManualRefreshing(false);
    }
  }
  async function syncDexcom(manual = false) {
    if (syncRunning.current) {
      if (manual) toast.info("Dexcom sync is already in progress.");
      return null;
    }
    syncRunning.current = true;
    dexcomEpoch.current++;
    lastAttemptRef.current = new Date().toISOString();
    try {
      if (manual) setDexcomBusy(true);
      const response = await apiFetch("/api/dexcom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync", force: manual }),
      });
      const data = (await response.json()) as {
        error?: string;
        lastSync?: string;
        count?: number;
        rawCount?: number;
        latestShareAt?: string | null;
        alreadyRecent?: boolean;
        lastAttemptAt?: string | null;
        lastError?: string | null;
      };
      if (!response.ok) throw new Error(data.error ?? "Dexcom sync failed.");
      lastSyncRef.current = data.lastSync ?? null;
      setDexcomLastSync(lastSyncRef.current);
      setDexcomLastAttempt(data.lastAttemptAt ?? null);
      setDexcomFailure(data.lastError ?? null);
      latestShareRef.current = data.latestShareAt ?? null;
      setDexcomLatestShareAt(latestShareRef.current);
      if (manual) {
        const newest = data.latestShareAt
          ? `${date(data.latestShareAt)} at ${time(data.latestShareAt)}`
          : "none";
        const stale =
          !data.latestShareAt || Date.now() - Date.parse(data.latestShareAt) > 30 * 60000;
        setDexcomMessage(
          data.alreadyRecent
            ? "Share was checked within the last four minutes."
            : data.rawCount === 0
              ? "Dexcom Share returned no readings from the past 24 hours. Check Share in the G7 app and the phone’s connection."
              : data.count === 0
                ? `Share returned ${data.rawCount} values; none changed the log. Newest saved Share point: ${newest}.`
                : stale
                  ? `${data.count} readings added or updated, but the newest is ${newest}. No current reading was available. Check Share in the G7 app and the phone’s connection; use the G7 app or receiver for current glucose.`
                  : `${data.count} readings added or updated. Newest: ${newest}.`,
        );
      }
      await load(true);
      return data;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Dexcom sync failed.";
      setDexcomMessage(message);
      setDexcomFailure(message);
      setDexcomLastAttempt(new Date().toISOString());
      if (manual) toast.error(message);
      return null;
    } finally {
      syncRunning.current = false;
      if (manual) setDexcomBusy(false);
    }
  }
  async function syncForCorrection(): Promise<CgmReading | null> {
    if (!dexcomConnected) return null;
    const result = await syncDexcom(true);
    if (!result) return null;
    try {
      const response = await apiFetch("/api/care", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not read the synced glucose log.");
      const data = (await response.json()) as { cgm: CgmReading[] };
      const share = currentShareForCorrection(
        data.cgm ?? [],
        true,
        result.latestShareAt ?? null,
        Date.now(),
      );
      if (!share) {
        toast.info(
          "Share has no numeric reading from the last 10 minutes. Check the primary device or enter a new finger-stick.",
        );
        return null;
      }
      toast.success("Current Dexcom reading filled in. Confirm it matches the primary device.");
      return share;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not use the synced reading.");
      return null;
    }
  }
  async function connectDexcom(credentials: DexcomCredentials) {
    if (syncRunning.current) return false;
    syncRunning.current = true;
    dexcomEpoch.current++;
    setDexcomBusy(true);
    setDexcomMessage("");
    try {
      const response = await apiFetch("/api/dexcom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "connect", ...credentials }),
      });
      const data = (await response.json()) as {
        error?: string;
        lastSync?: string;
        count?: number;
        rawCount?: number;
        latestShareAt?: string | null;
      };
      if (!response.ok) throw new Error(data.error ?? "Could not connect.");
      setDexcomConnected(true);
      setChangingDexcomAccount(false);
      lastSyncRef.current = data.lastSync ?? null;
      latestShareRef.current = data.latestShareAt ?? null;
      setDexcomLastSync(lastSyncRef.current);
      setDexcomLatestShareAt(latestShareRef.current);
      setDexcomMessage(`Connected. ${data.count ?? 0} readings added or updated.`);
      void load();
      return true;
    } catch (e) {
      setDexcomMessage(e instanceof Error ? e.message : "Could not connect Dexcom.");
      return false;
    } finally {
      syncRunning.current = false;
      setDexcomBusy(false);
      notifyCareChanged();
    }
  }
  async function disconnectDexcom() {
    if (syncRunning.current) return;
    syncRunning.current = true;
    dexcomEpoch.current++;
    setDexcomBusy(true);
    try {
      const response = await apiFetch("/api/dexcom", { method: "DELETE" });
      if (!response.ok) throw new Error("Could not disconnect.");
      setDexcomConnected(false);
      setDexcomLastSync(null);
      setDexcomLastAttempt(null);
      setDexcomFailure(null);
      setDexcomLatestShareAt(null);
      setDexcomMessage("Disconnected. Imported readings stay in the log.");
    } catch (e) {
      setDexcomMessage(e instanceof Error ? e.message : "Could not disconnect.");
    } finally {
      syncRunning.current = false;
      setDexcomBusy(false);
      notifyCareChanged();
    }
  }
  // Keep Share checks at their existing five-minute cadence; retry failures no faster than once a minute.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!dexcomConnected) return;
    const check = () => {
      if (
        document.visibilityState === "visible" &&
        navigator.onLine &&
        (!lastSyncRef.current || Date.now() - Date.parse(lastSyncRef.current) >= 300_000) &&
        (!lastAttemptRef.current || Date.now() - Date.parse(lastAttemptRef.current) >= 60_000)
      )
        void syncDexcom();
    };
    const timer = setInterval(check, 30_000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    check();
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
    };
  }, [dexcomConnected]);
  const time = (value: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: plan.timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  const date = (value: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: plan.timezone,
      month: "short",
      day: "numeric",
    }).format(new Date(value));
  const today = now ? dateKey(now, plan.timezone) : "";
  const previousToday = useRef("");
  useEffect(() => {
    if (!today || formsOpen) return;
    const previous = previousToday.current;
    previousToday.current = today;
    if (previous && previous !== today)
      setDay((selected) => (selected === previous ? today : selected));
  }, [today, formsOpen]);
  const dayEntries = useMemo(
    () => entries.filter((e) => dateKey(new Date(e.at), plan.timezone) === day),
    [entries, day, plan.timezone],
  );
  const dayIllnesses = useMemo(() => {
    if (!day || !now) return [];
    const bounds = chartDayWindow(day, plan.timezone);
    return illnessWindows.filter((illness) =>
      illnessOverlap(illness, bounds.start, bounds.end, now.getTime()),
    );
  }, [illnessWindows, day, plan.timezone, now]);
  const dayDoseFoods = useMemo(() => mealDoseFoods(dayEntries), [dayEntries]);
  const recentFoodItems = useMemo(() => {
    const seen = new Set<string>();
    const items: FoodItem[] = [];
    for (const entry of [...entries].sort((a, b) => b.at.localeCompare(a.at))) {
      if (entry.kind !== "food" || !entry.foodItems) continue;
      for (const item of entry.foodItems) {
        const key = item.savedFoodId ?? item.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
        if (items.length >= 8) break;
      }
      if (items.length >= 8) break;
    }
    return items;
  }, [entries]);
  const readings = useMemo(
    () => dayEntries.filter((e) => e.kind === "glucose").sort((a, b) => a.at.localeCompare(b.at)),
    [dayEntries],
  );
  const repeatMeals = useMemo(() => {
    const seen = new Set<string>();
    return entries
      .filter((e) => e.kind === "food" && e.foodItems?.length)
      .filter((e) => {
        const key = JSON.stringify([
          e.meal,
          e.foodItems?.map((item) => [item.name, item.amount, item.unit]),
        ]);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 4);
  }, [entries]);
  const selectedFoods = dayEntries.filter(
    (e) => e.kind === "food" && selectedFoodIds.includes(e.id),
  );
  const selectedCarbs = selectedFoods.reduce((total, e) => total + (e.carbs ?? 0), 0);
  const selectedRatio = getCarbRatio(plan, selectionMeal);
  const selectedFoodMath = math(
    null,
    selectedRatio === null ? 0 : selectedCarbs,
    plan,
    false,
    selectionMeal,
  );
  const dayCgm = useMemo(
    () => cgm.filter((r) => dateKey(new Date(r.at), plan.timezone) === day),
    [cgm, day, plan.timezone],
  );
  const sampledCgm = useMemo(
    () => [
      ...dayCgm
        .reduce((buckets, reading) => {
          const parts = new Intl.DateTimeFormat("en-GB", {
            timeZone: plan.timezone,
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
          })
            .format(new Date(reading.at))
            .split(":");
          const bucket = Math.floor((Number(parts[0]) * 60 + Number(parts[1])) / cgmInterval);
          const existing = buckets.get(bucket);
          if (!existing || reading.at > existing.at) buckets.set(bucket, reading);
          return buckets;
        }, new Map<number, CgmReading>())
        .values(),
    ],
    [dayCgm, cgmInterval, plan.timezone],
  );
  const dayDexcomEvents = dexcomEvents.filter(
    (e) => dateKey(new Date(e.at), plan.timezone) === day,
  );
  const earliestLoadedCgm = useMemo(() => {
    let earliest = Infinity;
    for (const reading of cgm) earliest = Math.min(earliest, Date.parse(reading.at));
    return Number.isFinite(earliest) ? earliest : null;
  }, [cgm]);
  // The next two hours' likely range, fitted on this person's CGM history. Never dosing advice.
  const estimate = useMemo(() => glucoseEstimate(cgm, now?.getTime() ?? NaN), [cgm, now]);
  // The care API loads CGM and Dexcom events from the last 45 days, newest first, up to 15,000 CGM rows.
  const cgmHistoryStart = historyLimited
    ? earliestLoadedCgm
    : now
      ? now.getTime() - 45 * 86400000
      : null;
  const chartMultiDay = chartRange !== null && chartRangeDays[chartRange] > 1;
  const dailyEvents = useMemo(
    () =>
      [
        ...dayEntries.map(
          (e) => ["manual", e] as [string, Entry | CgmReading | DexcomEvent | DoseFood],
        ),
        ...dayDoseFoods.map(
          (food) => ["dose-food", food] as [string, Entry | CgmReading | DexcomEvent | DoseFood],
        ),
        ...sampledCgm.map((e) => ["cgm", e] as [string, Entry | CgmReading | DexcomEvent]),
        ...dayDexcomEvents.map(
          (e) => ["dexcom-event", e] as [string, Entry | CgmReading | DexcomEvent],
        ),
      ].sort((a, b) => b[1].at.localeCompare(a[1].at)),
    [dayEntries, dayDoseFoods, sampledCgm, dayDexcomEvents],
  );
  const groupedEvents = useMemo(() => {
    const rows: {
      kind: string;
      item: Entry | CgmReading | DexcomEvent | DoseFood;
      firstAt: string;
      count: number;
    }[] = [];
    for (const [kind, item] of dailyEvents) {
      const previous = rows[rows.length - 1];
      if (
        kind === "cgm" &&
        previous?.kind === "cgm" &&
        (item as CgmReading).status &&
        (previous.item as CgmReading).status === (item as CgmReading).status &&
        Date.parse(previous.firstAt) - Date.parse(item.at) <= cgmInterval * 90000
      ) {
        previous.firstAt = item.at;
        previous.count++;
      } else rows.push({ kind, item, firstAt: item.at, count: 1 });
    }
    return rows;
  }, [dailyEvents, cgmInterval]);
  const dailyCgmSummary = useMemo(() => {
    if (!day) return summarizeCgm([], new Date().toISOString(), new Date().toISOString());
    const start = fromLocal(day + "T00:00", plan.timezone);
    const following = new Date(day + "T12:00:00Z");
    following.setUTCDate(following.getUTCDate() + 1);
    const end =
      day === today && now
        ? now.toISOString()
        : fromLocal(following.toISOString().slice(0, 10) + "T00:00", plan.timezone);
    return summarizeCgm(dayCgm, start, end);
  }, [day, dayCgm, plan.timezone, today, now]);
  const csvRange = useMemo(() => {
    if (!pendingCsv) return null;
    let first = "",
      last = "";
    for (const row of [...pendingCsv.parsed.readings, ...pendingCsv.parsed.events]) {
      if (!first || row.at < first) first = row.at;
      if (!last || row.at > last) last = row.at;
    }
    return first ? { first, last } : null;
  }, [pendingCsv]);
  const latestManual = readings[readings.length - 1];
  const latestCgm = dayCgm.reduce<CgmReading | null>(
    (current, reading) => (!current || reading.at > current.at ? reading : current),
    null,
  );
  const latestIsCgm = !!latestCgm && (!latestManual || latestCgm.at > latestManual.at);
  const latest =
    latestIsCgm && latestCgm
      ? {
          at: latestCgm.at,
          value: latestCgm.value,
          status: latestCgm.status,
          source: latestCgm.source,
        }
      : latestManual
        ? {
            at: latestManual.at,
            value: latestManual.glucose,
            status: latestManual.status ?? null,
            source: latestManual.source,
          }
        : null;
  const latestAgeMinutes =
    latest && now && day === today
      ? Math.max(0, Math.floor((now.getTime() - Date.parse(latest.at)) / 60000))
      : null;
  const importedAgeMinutes =
    dexcomLatestShareAt && now
      ? Math.max(0, Math.floor((now.getTime() - Date.parse(dexcomLatestShareAt)) / 60000))
      : null;
  const shareDelayed = dexcomConnected && (importedAgeMinutes === null || importedAgeMinutes > 30);
  const readingAgeLabel =
    latestAgeMinutes === null
      ? ""
      : latestAgeMinutes < 1
        ? "Logged just now"
        : latestAgeMinutes < 60
          ? `Logged ${latestAgeMinutes} min ago`
          : `Logged ${Math.floor(latestAgeMinutes / 60)} hr ${latestAgeMinutes % 60} min ago`;
  // A Clarity export is retrospective even when its record timestamp is recent.
  // Manual Dexcom entries can also be copied from an older display; only a fresh
  // finger-stick or a verified recent Share import may drive an imperative banner.
  const readingCurrent =
    day === today &&
    isRecentReading(latest?.at, now?.getTime() ?? NaN) &&
    (latestIsCgm
      ? latestCgm?.source === "Dexcom Share" &&
        dexcomConnected &&
        isRecentReading(dexcomLatestShareAt, now?.getTime() ?? NaN)
      : latestManual?.source === "Finger-stick");
  const ranges = glucoseRanges(plan);
  const highReading =
    !!latest &&
    (latest.status === "High" || (latest.value !== null && latest.value > plan.ketoneCheckAbove));
  const lowReading =
    !!latest &&
    (latest.status === "Low" || (latest.value !== null && latest.value < plan.lowThreshold));
  const ketoneWarning = readingCurrent && highReading;
  // Clarity's level names on the plan's ranges. The low alert keeps its own threshold.
  const latestLevel = latest ? glucoseLevel(latest, ranges) : null;
  const levelLabel = latestLevel
    ? lowReading && latestLevel !== "low" && latestLevel !== "veryLow"
      ? "Low reading"
      : `${glucoseLevelNames[latestLevel]} · ${glucoseLevelRanges(ranges)[latestLevel]} mg/dL`
    : "";
  const runningSensor = now && sensor ? currentSensor([sensor], now.getTime()) : null;
  const lastRapid = entries.find(
    (e) =>
      e.kind === "insulin" &&
      e.insulin === "Rapid-acting" &&
      (!now || Date.parse(e.at) <= now.getTime()),
  );
  const latestVerifiedGlucose = [
    ...cgm.filter((r) => r.source === "Dexcom Share"),
    ...entries.filter((e) => e.kind === "glucose" && e.source === "Finger-stick"),
  ].sort((a, b) => b.at.localeCompare(a.at))[0];
  const doseGlucoseAge =
    latestVerifiedGlucose && now
      ? Math.max(0, Math.floor((now.getTime() - Date.parse(latestVerifiedGlucose.at)) / 60000))
      : null;
  const doseGlucoseText = latestVerifiedGlucose
    ? "kind" in latestVerifiedGlucose
      ? latestVerifiedGlucose.glucose === null
        ? `${meterStatusLabel(latestVerifiedGlucose.status!, plan.meter)} · finger-stick`
        : `${latestVerifiedGlucose.glucose} mg/dL · finger-stick`
      : latestVerifiedGlucose.value === null
        ? `${latestVerifiedGlucose.status?.toUpperCase()} · exact value unknown`
        : `${latestVerifiedGlucose.value} mg/dL · Dexcom Share`
    : null;
  const lastCorrection = entries.find(
    (e) =>
      e.kind === "insulin" &&
      e.insulin === "Rapid-acting" &&
      (e.purpose === "Correction only" || e.purpose === "Meal + correction") &&
      (!now || Date.parse(e.at) <= now.getTime()),
  );
  const correctionReview = correctionReviewStatus(
    lastCorrection?.at,
    now?.getTime() ?? NaN,
    plan.timezone,
    plan.correctionHours,
  );
  const chartCorrectionAt = correctionMarkerAt(
    correctionReview,
    readingCurrent,
    latest?.value ?? null,
    latest?.status ?? null,
    plan.target,
    ranges.high,
  );
  // Same above-range rule as the chart marker. The header shows the review only while it holds,
  // and escalates once the review time arrives.
  const aboveRange =
    !!readingCurrent &&
    !!latest &&
    readingAboveRange(latest.value, latest.status, plan.target, ranges.high);
  const reviewStillHigh =
    aboveRange && latest && correctionReview && correctionReview.state !== "upcoming"
      ? latest.status === "High"
        ? "HIGH"
        : `${latest.value} mg/dL`
      : null;
  const nightly = nightlyReminder(entries, now?.getTime() ?? NaN, plan);
  const nowMs = now?.getTime() ?? NaN;
  const sickStatus = Number.isFinite(nowMs)
    ? sickDayStatus({ illnesses: illnessWindows, entries, cgm, plan, now: nowMs })
    : null;
  const triggers = Number.isFinite(nowMs) ? callTriggers({ entries, cgm, plan, now: nowMs }) : [];
  const lowRecheckState = Number.isFinite(nowMs)
    ? lowRecheck({ entries, cgm, plan, now: nowMs })
    : null;
  const overnight = Number.isFinite(nowMs) ? overnightCheck({ entries, plan, now: nowMs }) : null;
  // Close to the check the chip moves out of the reminder row into a banner above the header.
  const overnightBanner =
    !loading && !error && overnightBannerShown(overnight, nowMs) ? overnight : null;
  const lastBasal = entries.find((e) => e.kind === "insulin" && e.insulin === "Long-acting");
  const basalToday = entries.filter(
    (e) =>
      e.kind === "insulin" &&
      e.insulin === "Long-acting" &&
      dateKey(new Date(e.at), plan.timezone) === today,
  );
  function openDoseFlow(
    mode?: "Carbs" | "Correction" | "Carbs + correction",
    meal: MealRatio | null = null,
    opts?: { carbs?: string; foodItems?: FoodItem[]; linkedFoodIds?: string[] },
  ) {
    setNow(new Date());
    setDoseFlow({
      mode: mode ?? "Carbs",
      meal,
      carbs: opts?.carbs ?? "",
      foodItems: opts?.foodItems ?? [],
      linkedFoodIds: opts?.linkedFoodIds ?? [],
    });
  }
  function openActualDoseLog(mode: "Carbs" | "Correction" | "Carbs + correction") {
    setDoseFlow(null);
    open("insulin", undefined, {
      dosePurpose: mode === "Carbs + correction" ? "Meal + correction" : "Correction only",
      at: "",
      historicalDoseLog: true,
    });
  }
  function selectDay(next: string) {
    setDay(next);
    setSelectedFoodIds([]);
  }
  async function submitDoseFlow(records: {
    dose: Entry;
    glucoseEntry: Entry | null;
    foodEntry: Entry | null;
  }) {
    const { dose, glucoseEntry, foodEntry } = records;
    if (await mutate({ action: "logCalculation", dose, glucoseEntry, foodEntry: foodEntry })) {
      selectDay(dateKey(new Date(dose.at), plan.timezone));
      void load();
      return true;
    }
    return false;
  }
  function open(kind: EntryModalKind, entry?: Entry, prefill?: EntryPrefill) {
    setShowFoodTools(false);
    setEditing(entry ?? null);
    setEntryPrefill(prefill ?? null);
    setModal(kind);
  }
  function openDoseFood(dose: Entry) {
    if (!dose.calculation || dose.calculation.carbs <= 0 || dose.calculation.foodEntryIds.length)
      return;
    open("food", undefined, {
      foodDoseSource: dose,
      at: localInput(new Date(dose.at), plan.timezone),
      carbs: String(dose.calculation.carbs),
      meal: mealLabel(dose.calculation.ratioMeal),
      note: (dose.calculation.foodDescription ?? "Food from recorded meal-dose calculation").slice(
        0,
        1000,
      ),
    });
  }
  function toggleFoodSelection(id: string, checked: boolean) {
    setSelectedFoodIds((ids) => (checked ? [...ids, id] : ids.filter((x) => x !== id)));
    setSelectionMeal(mealRatioAt(new Date(), plan.timezone));
  }
  function logSelectedFoodDose() {
    setDoseFlow({
      mode: "Carbs",
      meal: selectionMeal,
      carbs: fmt(selectedCarbs),
      foodItems: [],
      linkedFoodIds: selectedFoods.map((e) => e.id),
    });
  }
  async function mutate(body: unknown, onSaved?: (data: { illness?: IllnessWindow }) => void) {
    if (writeRunning.current) return false;
    if (!canLog) {
      toast.error("Your access is view only.");
      return false;
    }
    writeRunning.current = true;
    refreshGate.current.invalidate();
    setRefreshing(false);
    setSaving(true);
    try {
      const r = await apiFetch("/api/care", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await r.json()) as { error?: string; illness?: IllnessWindow };
      if (!r.ok) throw new Error(data.error);
      onSaved?.(data);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
      return false;
    } finally {
      writeRunning.current = false;
      setSaving(false);
      notifyCareChanged();
    }
  }
  async function saveEntry(entry: Entry, foodDoseSource: Entry | null): Promise<boolean> {
    const ok = await mutate(
      foodDoseSource
        ? {
            action: "logMealFood",
            doseId: foodDoseSource.id,
            doseRevision: foodDoseSource.revision,
            food: entry,
          }
        : { action: "entry", entry },
    );
    if (ok) {
      setEntries((prev) =>
        [
          entry,
          ...prev
            .filter((x) => x.id !== entry.id)
            .map((record) =>
              foodDoseSource && record.id === foodDoseSource.id && record.calculation
                ? {
                    ...record,
                    calculation: {
                      ...record.calculation,
                      foodEntryIds: [entry.id],
                      foodLog: "separate" as const,
                    },
                  }
                : record,
            ),
        ].sort((a, b) => b.at.localeCompare(a.at)),
      );
      selectDay(dateKey(new Date(entry.at), plan.timezone));
      toast.success("Entry saved");
      void load();
    }
    return ok;
  }
  async function deleteEntry(entry: Entry): Promise<boolean> {
    const ok = await mutate({ action: "delete", id: entry.id });
    if (ok) {
      setEntries((current) => current.filter((x) => x.id !== entry.id));
      toast.success("Entry deleted");
      void load();
    }
    return ok;
  }
  async function saveFoodFavorite(food: SavedFood): Promise<boolean> {
    const parsed = savedFoodSchema.safeParse(food);
    if (!parsed.success) {
      toast.error("Enter a name, carbs, serving size and unit.");
      return false;
    }
    const saved = await mutate({ action: "food", food: parsed.data });
    if (saved) {
      toast.success("Saved food");
      void load();
    }
    return saved;
  }
  async function removeFavorite(food: SavedFood): Promise<boolean> {
    const removed = await mutate({ action: "deleteFood", id: food.id });
    if (removed) {
      toast.success("Saved food removed");
      void load();
    }
    return removed;
  }
  async function previewImportFile(file: File) {
    setImporting(true);
    setPendingCsv(null);
    setCsvIdentityConfirmed(false);
    setImportMessage("");
    try {
      if (file.size > 15_000_000) throw new Error("Choose a CSV smaller than 15 MB.");
      const parsed = parseClarity(await file.text(), plan.timezone);
      if (parsed.readings.length + parsed.events.length === 0)
        throw new Error(
          "This file contains no usable glucose readings or Dexcom events. Nothing was imported.",
        );
      setPendingCsv({ fileName: file.name, parsed });
    } catch (e) {
      setImportMessage(e instanceof Error ? e.message : "Could not read this file.");
    } finally {
      setImporting(false);
    }
  }
  async function confirmImportFile() {
    if (!pendingCsv || importing || !csvIdentityConfirmed) return;
    setImporting(true);
    setImportMessage("");
    const { parsed } = pendingCsv;
    try {
      let changed = 0,
        unchanged = 0,
        eventsChanged = 0,
        eventsUnchanged = 0,
        legacyDuplicatesRemoved = 0;
      for (let i = 0; i < parsed.readings.length; i += 200) {
        const response = await apiFetch("/api/care", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "importCgm",
            readings: parsed.readings.slice(i, i + 200),
          }),
        });
        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          throw new Error(data.error ?? "Import stopped.");
        }
        const outcome = (await response.json()) as {
          changed?: number;
          unchanged?: number;
          legacyDuplicatesRemoved?: number;
        };
        changed += outcome.changed ?? 0;
        unchanged += outcome.unchanged ?? 0;
        legacyDuplicatesRemoved += outcome.legacyDuplicatesRemoved ?? 0;
      }
      for (let i = 0; i < parsed.events.length; i += 200) {
        const response = await apiFetch("/api/care", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "importDexcomEvents",
            events: parsed.events.slice(i, i + 200),
          }),
        });
        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          throw new Error(data.error ?? "Event import stopped.");
        }
        const outcome = (await response.json()) as { changed?: number; unchanged?: number };
        eventsChanged += outcome.changed ?? 0;
        eventsUnchanged += outcome.unchanged ?? 0;
      }
      setImportMessage(
        `${changed} glucose readings added or updated · ${unchanged} unchanged · ${eventsChanged} Dexcom events added · ${eventsUnchanged} unchanged${legacyDuplicatesRemoved ? ` · ${legacyDuplicatesRemoved} older duplicate points removed` : ""}${parsed.skipped ? ` · ${parsed.skipped} invalid rows skipped` : ""}.`,
      );
      toast.success(
        changed || eventsChanged
          ? `${changed} glucose points and ${eventsChanged} events imported`
          : "No new readings or events in this file",
      );
      setPendingCsv(null);
      setCsvIdentityConfirmed(false);
      notifyCareChanged();
      void load(true);
    } catch (e) {
      setImportMessage(e instanceof Error ? e.message : "Could not import this file.");
    } finally {
      setImporting(false);
    }
  }
  /** Saves a whole period (dates, notes or check-ins); the server audits and conflict-checks it. */
  async function saveIllness(illness: IllnessWindow, message: string) {
    const saved = await mutate({ action: "illness", illness }, (data) => {
      if (data.illness)
        setIllnessWindows((current) =>
          [data.illness!, ...current.filter((item) => item.id !== illness.id)].sort((a, b) =>
            b.startDate.localeCompare(a.startDate),
          ),
        );
    });
    if (saved) {
      toast.success(message);
      void load(true);
    }
    return saved;
  }
  const checkInIllness = checkInEditor
    ? (illnessWindows.find((w) => w.id === checkInEditor.illnessId) ?? null)
    : null;
  function shiftDay(delta: number) {
    const d = new Date(day + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + delta);
    selectDay(d.toISOString().slice(0, 10));
  }
  // Rebuilt every render from current handlers, so no command runs a stale closure.
  function commandGroups(): CommandPaletteGroup[] {
    const busy = loading || !!error;
    const logGroup: CommandPaletteItem[] = [
      {
        id: "log-glucose",
        label: "Log glucose",
        icon: <Droplet size={17} />,
        keywords: ["glucose", "bg", "blood sugar", "finger-stick", "reading"],
        disabled: busy,
        onSelect: () => open("glucose"),
      },
      {
        id: "log-food",
        label: "Log food",
        icon: <Utensils size={17} />,
        keywords: ["food", "carbs", "meal", "eat"],
        disabled: busy,
        onSelect: () => open("food"),
      },
      {
        id: "log-insulin",
        label: "Log insulin",
        icon: <Syringe size={17} />,
        keywords: ["insulin", "dose", "bolus", "shot", "injection"],
        disabled: busy,
        onSelect: () => open("insulin"),
      },
      {
        id: "log-low-treatment",
        label: "Treat a low",
        icon: <Candy size={17} />,
        keywords: ["low", "hypo", "treatment", "juice", "glucose tabs", "rule of 15"],
        disabled: busy,
        onSelect: () => setLowTreatmentOpen(true),
      },
      {
        id: "log-exercise",
        label: "Log exercise",
        icon: <Dumbbell size={17} />,
        keywords: ["exercise", "activity", "sport", "play"],
        disabled: busy,
        onSelect: () => open("exercise"),
      },
      {
        id: "log-rescue",
        label: "Log emergency medication",
        icon: <Siren size={17} />,
        keywords: ["rescue", "glucagon", "severe low", "emergency", plan.rescueMedication ?? ""],
        disabled: busy,
        onSelect: () => open("rescue"),
      },
      {
        id: "log-illness",
        label: "Log illness or other period",
        icon: <Thermometer size={17} />,
        keywords: ["illness", "sick", "ill", "fever", "sick day", "stress", "vacation", "period"],
        onSelect: () => setIllnessEditor({ record: null }),
      },
      {
        id: "log-nightly",
        label: "Nightly long-acting",
        icon: <Moon size={17} />,
        keywords: ["nightly", "long-acting", "basal", "night"],
        disabled: plan.basal === 0,
        onSelect: () => setNightOpen(true),
      },
    ];
    const calculateGroup: CommandPaletteItem[] = [
      {
        id: "calc-open",
        label: "Insulin calculator",
        icon: <Calculator size={17} />,
        keywords: ["calculator", "dose", "bolus", "carbs"],
        onSelect: () => openDoseFlow(),
      },
      {
        id: "calc-carbs",
        label: "Calculate: Carbs",
        icon: <Calculator size={17} />,
        keywords: ["calculator", "carbs", "meal"],
        onSelect: () => openDoseFlow("Carbs"),
      },
      {
        id: "calc-correction",
        label: correctionReview?.menuLabel ?? "Calculate: Correction",
        icon: <Clock3 size={17} />,
        keywords: ["correction", "high", "review", "bolus"],
        disabled: busy,
        onSelect: () => openDoseFlow("Correction"),
      },
      {
        id: "calc-carbs-correction",
        label: "Calculate: Carbs + correction",
        icon: <Calculator size={17} />,
        keywords: ["carbs", "correction", "combo"],
        onSelect: () => openDoseFlow("Carbs + correction"),
      },
    ];
    const viewGroup: CommandPaletteItem[] = [
      {
        id: "view-daily",
        label: "Daily care",
        icon: <Activity size={17} />,
        keywords: ["daily", "log", "home"],
        onSelect: () => setView("daily"),
      },
      {
        id: "view-insights",
        label: "Insights",
        icon: <BarChart3 size={17} />,
        keywords: ["insights", "trends", "patterns"],
        disabled: busy,
        onSelect: () => setView("insights"),
      },
      {
        id: "view-logbook",
        label: "Logbook",
        icon: <BookOpen size={17} />,
        keywords: [
          "logbook",
          "call in",
          "call-in",
          "breakfast",
          "lunch",
          "dinner",
          "bedtime",
          "appointments",
        ],
        disabled: busy,
        onSelect: () => setView("logbook"),
      },
      {
        id: "view-reports",
        label: "Doctor report",
        icon: <FileDown size={17} />,
        keywords: ["report", "doctor", "clinician", "pdf"],
        disabled: busy,
        onSelect: () => setView("reports"),
      },
      {
        id: "view-low-help",
        label: "Low glucose and emergency steps",
        icon: <Heart size={17} />,
        keywords: ["low", "hypo", "emergency", "help", "glucagon", "severe"],
        onSelect: () => setEmergencyOpen(true),
      },
      {
        id: "view-handoff",
        label: "Caregiver handoff",
        icon: <FileDown size={17} />,
        keywords: ["handoff", "caregiver", "babysitter", "school"],
        disabled: busy,
        onSelect: () => setHandoffOpen(true),
      },
      {
        id: "view-food-builder",
        label: "Food builder",
        icon: <Utensils size={17} />,
        keywords: ["food builder", "favorites", "quick add"],
        onSelect: () => {
          setView("daily");
          setShowFoodTools(true);
        },
      },
      {
        id: "nav-today",
        label: "Go to today",
        icon: <ChevronRight size={17} />,
        keywords: ["today", "current day"],
        disabled: !today || day === today,
        onSelect: () => selectDay(today),
      },
      {
        id: "nav-previous-day",
        label: "Previous day",
        icon: <ChevronLeft size={17} />,
        keywords: ["previous day", "yesterday", "back"],
        onSelect: () => shiftDay(-1),
      },
      {
        id: "nav-next-day",
        label: "Next day",
        icon: <ChevronRight size={17} />,
        keywords: ["next day", "tomorrow", "forward"],
        disabled: day === today,
        onSelect: () => shiftDay(1),
      },
    ];
    const chartGroup: CommandPaletteItem[] =
      view === "daily"
        ? [
            { value: "day", label: "Chart: Day" },
            { value: "12h", label: "Chart: 12 hours" },
            { value: "6h", label: "Chart: 6 hours" },
            { value: "3d", label: "Chart: 3 days" },
            { value: "7d", label: "Chart: 7 days" },
            { value: "14d", label: "Chart: 14 days" },
            { value: "30d", label: "Chart: 30 days" },
          ].map(({ value, label }) => ({
            id: `chart-${value}`,
            label,
            icon: <BarChart3 size={17} />,
            keywords: ["chart", "range", "window", "glucose graph"],
            disabled: busy,
            onSelect: () => setChartRange(value as ChartRange),
          }))
        : [];
    const dataGroup: CommandPaletteItem[] = [
      {
        id: "data-refresh",
        label: "Refresh data",
        icon: <RefreshCw size={17} />,
        keywords: ["refresh", "sync", "update", "reload"],
        disabled: manualRefreshing || saving || !online,
        onSelect: () => void refreshAll(),
      },
      {
        id: "show-hints",
        label: "Show button hints",
        icon: <Keyboard size={17} />,
        keywords: ["keyboard", "hints", "buttons", "press", "navigate"],
        onSelect: () => window.dispatchEvent(new Event(SHOW_HINTS)),
      },
      {
        id: "data-dexcom",
        label: `Dexcom ${shareDelayed ? "· data delayed" : dexcomConnected ? "· connected" : "· import"}`,
        icon: <Upload size={17} />,
        keywords: ["dexcom", "share", "connect", "csv", "clarity", "import"],
        disabled: busy,
        onSelect: () => setImportOpen(true),
      },
      ...(canManage
        ? [
            {
              id: "data-export",
              label: "Download all data",
              icon: <FileDown size={17} />,
              keywords: ["download", "export", "backup", "csv"],
              disabled: busy,
              onSelect: () => {
                const link = document.createElement("a");
                link.href = personHref("/api/export", personAccess.person);
                link.download = "";
                link.click();
              },
            },
          ]
        : []),
      {
        id: "data-care-plan",
        label: "Care plan",
        icon: <Settings2 size={17} />,
        keywords: ["care plan", "settings", "ratios", "contacts"],
        onSelect: () => window.location.assign("/plan"),
      },
    ];
    const savedFoodGroup: CommandPaletteItem[] = savedFoods.map((food) => ({
      id: `saved-food-${food.id}`,
      label: `${food.name} · ${food.carbs} g / ${food.serving} ${food.unit}`,
      icon: <Utensils size={17} />,
      keywords: ["food", "saved", "favorite", "quick add", food.name],
      disabled: busy,
      onSelect: () => {
        setFoodBuilderItems((current) => [
          ...current,
          {
            name: food.name,
            carbs: food.carbs,
            amount: food.serving,
            unit: food.unit,
            savedFoodId: food.id,
          },
        ]);
        setView("daily");
        setShowFoodTools(true);
        open("food");
      },
    }));
    const accountGroup: CommandPaletteItem[] = [
      {
        id: "account-sign-out",
        label: "Sign out",
        icon: <LogOut size={17} />,
        keywords: ["sign out", "log out", "logout"],
        onSelect: () => {
          window.location.href = "/signout";
        },
      },
    ];
    const themeGroup: CommandPaletteItem[] = THEME_OPTIONS.map((option) => ({
      id: `theme-${option.value}`,
      label: `Theme: ${option.label}`,
      icon: <Check size={17} className={themePref === option.value ? "" : "invisible"} />,
      keywords: ["theme", "appearance", "dark mode", "color scheme", option.label.toLowerCase()],
      onSelect: () => chooseTheme(option.value),
    }));
    return [
      // Viewers get no ways to add records; the server refuses them anyway.
      ...(canLog
        ? [
            { heading: "Log", items: logGroup },
            { heading: "Calculate", items: calculateGroup },
          ]
        : []),
      { heading: "View", items: [...viewGroup, ...chartGroup] },
      { heading: "Data", items: dataGroup },
      ...(canLog ? [{ heading: "Saved foods", items: savedFoodGroup }] : []),
      { heading: "Account", items: accountGroup },
      { heading: "Theme", items: themeGroup },
    ];
  }
  // A time-of-day greeting in the care plan's timezone; falls back to a plain heading with no name.
  const greeting = useMemo(() => {
    if (!profile?.name) return null;
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: plan.timezone,
        hour: "numeric",
        hour12: false,
      }).format(now ?? new Date()),
    );
    const part = hour < 5 ? "evening" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
    return `Good ${part}, ${profile.name}`;
  }, [profile?.name, plan.timezone, now]);
  useEffect(() => {
    document.title = profile?.name ? `${profile.name} · Carby` : "Carby";
  }, [profile?.name]);
  if (setup) return <CareSetup incompletePlan={setup.incompletePlan} profile={profile} />;
  const basalLabel =
    plan.basal > 0
      ? // A wall-clock time in the plan's zone: format it as UTC so the device zone never shifts it.
        new Date("2000-01-01T" + plan.basalTime + ":00Z").toLocaleTimeString("en-US", {
          timeZone: "UTC",
          hour: "numeric",
          minute: "2-digit",
        })
      : "No scheduled dose";
  const paletteGroups = commandGroups();
  const liveStatus = !online
    ? "Offline"
    : refreshError
      ? "Update delayed"
      : refreshing
        ? "Updating…"
        : lastChecked
          ? `Live · ${time(lastChecked.toISOString())}`
          : "Connecting…";
  function logAction(action: LogAction) {
    switch (action) {
      case "food":
      case "insulin":
      case "glucose":
      case "exercise":
      case "rescue":
        return open(action);
      case "illness":
        return setIllnessEditor({ record: null });
      case "low":
        return setLowTreatmentOpen(true);
      case "nightly":
        return setNightOpen(true);
      case "calculator":
        return openDoseFlow();
      case "food-builder":
        setView("daily");
        return setShowFoodTools(true);
    }
  }
  return (
    <Tabs
      value={view}
      onValueChange={setView}
      className="app-shell care-redesign care-page-tabs"
      data-view={view}
    >
      <Toaster richColors />
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} groups={paletteGroups} />
      <ShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        available={new Set(paletteGroups.flatMap((group) => group.items.map((item) => item.id)))}
      />
      {overnightBanner && (
        <OvernightBanner
          check={overnightBanner}
          now={nowMs}
          timezone={plan.timezone}
          stale={!online || !!refreshError}
          onLog={() => open("glucose")}
        />
      )}
      <header className="topbar care-workspace-topbar" {...sheetHeader}>
        <Link className="carby-brand" href="/" aria-label="Carby home">
          <CarbyWordmark />
        </Link>
        <TabsList className="workspace-nav" aria-label="Main navigation">
          <TabsTrigger value="daily" title="Daily care · G then D">
            <Activity size={17} />
            <span>Daily care</span>
          </TabsTrigger>
          <TabsTrigger value="insights" disabled={loading || !!error} title="Insights · G then I">
            <BarChart3 size={17} />
            <span>Insights</span>
          </TabsTrigger>
          <TabsTrigger value="logbook" disabled={loading || !!error} title="Logbook · G then L">
            <BookOpen size={17} />
            <span>Logbook</span>
          </TabsTrigger>
          <TabsTrigger value="reports" disabled={loading || !!error} title="Reports · G then R">
            <FileDown size={17} />
            <span>Reports</span>
          </TabsTrigger>
        </TabsList>
        <div className="workspace-header-tools">
          <button
            type="button"
            className="care-header-status"
            data-state={
              !online ? "offline" : refreshError ? "delayed" : lastChecked ? "live" : "connecting"
            }
            title={refreshError || "Refresh care log and Dexcom"}
            aria-label={`Refresh data. ${liveStatus}`}
            onClick={() => void refreshAll()}
            disabled={manualRefreshing || saving || !online}
          >
            <span className="care-header-status-dot" aria-hidden="true" />
            <span role="status" className="care-header-status-text">
              {liveStatus}
            </span>
            <RefreshCw
              size={15}
              aria-hidden="true"
              className={manualRefreshing ? "spin" : undefined}
            />
          </button>
          <button
            className="button subtle care-command-trigger"
            type="button"
            onClick={() => setCommandOpen(true)}
            aria-label="Open command palette"
            aria-haspopup="dialog"
          >
            <CommandIcon size={17} />
            <span className="care-command-trigger-label">Search</span>
            <KbdGroup className="care-command-trigger-kbd">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>
          </button>
          <button
            className="care-workspace-emergency-link"
            type="button"
            onClick={() => setEmergencyOpen(true)}
            aria-label="Open low glucose and emergency steps"
          >
            <Heart size={17} />
            <span>Low help</span>
          </button>
          <DropdownMenu {...careMenu.root}>
            <DropdownMenuTrigger asChild>
              <button
                className="button subtle care-workspace-more"
                type="button"
                disabled={loading || !!error}
                aria-label={shareDelayed ? "Care tools · Dexcom data delayed" : "Care tools"}
                data-open={careMenu.open || undefined}
                {...careMenu.trigger}
              >
                <Menu size={18} aria-hidden="true" />
                {shareDelayed && (
                  <span className="care-workspace-menu-attention" aria-hidden="true" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="care-workspace-menu header-menu"
              {...careMenu.content}
            >
              <DropdownMenuLabel className="header-menu-title">Care tools</DropdownMenuLabel>
              {canLog && (
                <>
                  <DropdownMenuLabel>Log</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => openDoseFlow()}>
                    <Calculator size={17} />
                    Insulin calculator
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={loading || !!error} onSelect={() => open("exercise")}>
                    <Dumbbell size={17} />
                    Log exercise
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={plan.basal === 0} onSelect={() => setNightOpen(true)}>
                    <Moon size={17} />
                    Nightly Long-acting
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setView("daily");
                      setShowFoodTools(true);
                    }}
                  >
                    <Utensils size={17} />
                    Food builder
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuLabel>Share and data</DropdownMenuLabel>
              <DropdownMenuItem disabled={loading || !!error} onSelect={() => setHandoffOpen(true)}>
                <Users size={17} />
                Caregiver handoff
              </DropdownMenuItem>
              <DropdownMenuItem disabled={loading || !!error} onSelect={() => setImportOpen(true)}>
                <Upload size={17} />
                Dexcom{" "}
                {shareDelayed ? "· data delayed" : dexcomConnected ? "· connected" : "· import"}
              </DropdownMenuItem>
              {canManage && (
                <DropdownMenuItem asChild disabled={loading || !!error}>
                  <a href={personHref("/api/export", personAccess.person)} download>
                    <FileDown size={17} />
                    Download all data
                  </a>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Settings</DropdownMenuLabel>
              <DropdownMenuItem asChild>
                <Link href="/plan">
                  <Settings2 size={17} />
                  Care plan
                </Link>
              </DropdownMenuItem>
              {canManage && (
                <DropdownMenuItem onSelect={() => setProfileDialogOpen(true)}>
                  <User size={17} />
                  Profile
                </DropdownMenuItem>
              )}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <SunMoon size={17} />
                  Theme
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent {...careMenu.sub}>
                  <DropdownMenuRadioGroup
                    value={themePref}
                    onValueChange={(value) => chooseTheme(value as ThemePreference)}
                  >
                    {THEME_OPTIONS.map((option) => (
                      <DropdownMenuRadioItem key={option.value} value={option.value}>
                        {option.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
          <PersonMenu name={profile?.name} timezone={plan.timezone} />
        </div>
      </header>
      <div className="care-sheet">
        <CareHeaderReminders
          correction={aboveRange ? correctionReview : null}
          nightly={nightly}
          now={now?.getTime() ?? NaN}
          plan={plan}
          loading={loading}
          unavailable={!!error}
          stale={!online || !!refreshError}
          stillHigh={reviewStillHigh}
          overnight={overnightBanner ? null : overnight}
          lowRecheck={lowRecheckState}
          sickDay={sickStatus}
          onCorrection={() => openDoseFlow("Correction")}
          onNightly={() => setNightOpen(true)}
          onOvernight={() => open("glucose")}
          onLowRecheck={() => open("glucose")}
          onSickDay={() => setSickDayOpen(true)}
        />
        <main>
          <ProfilePrompt
            profile={profile}
            timezone={plan.timezone}
            onSaved={setProfile}
            open={profileDialogOpen}
            onOpenChange={setProfileDialogOpen}
          />
          <TabsContent
            value="daily"
            forceMount
            hidden={view !== "daily"}
            className="care-page-panel"
          >
            <div className="page-heading care-workspace-heading">
              <div>
                <NextAppointmentChip
                  appointments={appointments}
                  timezone={plan.timezone}
                  now={nowMs}
                />
                <h1>{greeting ?? "Your day"}</h1>
              </div>
              {canLog && (
                <nav
                  className="quick-actions mobile-actions care-workspace-mobile-actions"
                  aria-label="Quick logging"
                >
                  <button
                    type="button"
                    className="quick-food"
                    onClick={() => open("food")}
                    disabled={loading || !!error}
                  >
                    <Utensils size={20} aria-hidden="true" />
                    <span>
                      <span className="quick-verb">Log </span>food
                    </span>
                    <Plus size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => open("insulin")}
                    disabled={loading || !!error}
                  >
                    <Syringe size={20} aria-hidden="true" />
                    <span>
                      <span className="quick-verb">Log </span>insulin
                    </span>
                    <Plus size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => open("glucose")}
                    disabled={loading || !!error}
                  >
                    <Droplet size={20} aria-hidden="true" />
                    <span>
                      <span className="quick-verb">Log </span>glucose
                    </span>
                    <Plus size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="quick-illness"
                    onClick={() => setIllnessEditor({ record: null })}
                    disabled={loading || !!error}
                  >
                    <Thermometer size={20} aria-hidden="true" />
                    <span>
                      <span className="quick-verb">Log </span>illness
                    </span>
                    <Plus size={16} aria-hidden="true" />
                  </button>
                </nav>
              )}
              <div className="date-control">
                <button aria-label="Previous day" onClick={() => shiftDay(-1)} disabled={!day}>
                  <ChevronLeft size={18} />
                </button>
                <input
                  aria-label="Selected day"
                  type="date"
                  value={day}
                  onChange={(e) => {
                    if (e.target.value) selectDay(e.target.value);
                  }}
                />
                <button aria-label="Next day" onClick={() => shiftDay(1)} disabled={!day}>
                  <ChevronRight size={18} />
                </button>
                {day !== today && (
                  <button className="today-button" onClick={() => selectDay(today)}>
                    Today
                  </button>
                )}
              </div>
            </div>
            <div className="daily-alerts">
              {error && (
                <div className="error-banner" role="alert">
                  {error}{" "}
                  <button
                    onClick={() => {
                      void load(true);
                    }}
                  >
                    Retry
                  </button>
                </div>
              )}
              {shareDelayed && (
                <div className="notice timing-warning share-status-banner" role="status">
                  <strong>Dexcom data delayed.</strong> Last reading:{" "}
                  {dexcomLatestShareAt
                    ? `${date(dexcomLatestShareAt)} at ${time(dexcomLatestShareAt)}`
                    : "none received"}
                  . Last attempt:{" "}
                  {dexcomLastAttempt
                    ? `${date(dexcomLastAttempt)} at ${time(dexcomLastAttempt)}`
                    : "not yet"}
                  . {dexcomFailure && <span>{dexcomFailure} </span>}Use the G7 app or primary device
                  for current treatment decisions.{" "}
                  <button
                    type="button"
                    className="button subtle"
                    onClick={() => setImportOpen(true)}
                  >
                    Sync details
                  </button>
                </div>
              )}
              {syncState && (
                <SyncNotice
                  status={syncState}
                  busy={saving}
                  canManage={canManage}
                  onResolve={(action) =>
                    void mutate({ action }).then((ok) => {
                      if (ok) void load(true);
                    })
                  }
                />
              )}
              {historyLimited && (
                <p className="notice" role="status">
                  Loaded CGM history reached its limit. Earlier days may be incomplete; check
                  coverage before comparing periods.
                </p>
              )}

              {day && day !== today && (
                <div className="history-context" role="status">
                  <Clock3 size={17} />
                  <span>
                    Reviewing {date(fromLocal(day + "T12:00", plan.timezone))}. This is a historical
                    view.
                  </span>
                  <button type="button" onClick={() => selectDay(today)}>
                    Back to today
                  </button>
                </div>
              )}
              <CallNotices triggers={triggers} plan={plan} />
            </div>

            <div className="workspace" data-layout="overview">
              <section className="main-column">
                <div className="reading-card">
                  <div className="reading-top">
                    <div>
                      <span className="overline">
                        <Activity size={16} /> LATEST LOGGED ·{" "}
                        {day === today ? "TODAY" : "SELECTED DAY"}
                      </span>
                      <div className="reading-value">
                        {loading ? (
                          <Loader2 className="spin" />
                        ) : latest?.status ? (
                          latestIsCgm ? (
                            latest.status.toUpperCase()
                          ) : (
                            meterStatusLabel(latest.status)
                          )
                        ) : (
                          (latest?.value ?? "—")
                        )}
                        {latest?.value != null && <span>mg/dL</span>}
                      </div>
                      <p>
                        {latest
                          ? `${latest.source} · ${date(latest.at)}, ${time(latest.at)}`
                          : "No reading recorded for this day."}
                      </p>
                      {readingAgeLabel && (
                        <span
                          className={`care-workspace-reading-age${readingCurrent ? "" : " is-delayed"}`}
                        >
                          {readingAgeLabel}
                          {!readingCurrent ? " · check a current reading" : ""}
                        </span>
                      )}
                      {dexcomConnected && day === today && shareDelayed && (
                        <button
                          type="button"
                          className="care-workspace-reading-sync"
                          disabled={dexcomBusy}
                          onClick={() => {
                            setImportOpen(true);
                            void syncDexcom(true);
                          }}
                        >
                          {dexcomBusy ? (
                            <Loader2 size={15} className="spin" />
                          ) : (
                            <RefreshCw size={15} />
                          )}
                          Sync Dexcom
                        </button>
                      )}
                    </div>
                    <div className="reading-top-alert">
                      {ketoneWarning && (
                        <div className="reading-notice warning" role="alert">
                          <strong>Check ketones</strong>
                          <span>
                            {latest!.status === "High"
                              ? latestIsCgm
                                ? "CGM reports HIGH."
                                : "Meter reads HI."
                              : `Glucose above ${plan.ketoneCheckAbove} mg/dL.`}{" "}
                            Follow your sick-day plan and contact your care team for guidance.
                          </span>
                        </div>
                      )}
                      {!ketoneWarning && (
                        <span className="reading-pill">
                          {!latest
                            ? "No reading yet"
                            : day !== today
                              ? "Past day · for review"
                              : latestIsCgm && latestCgm?.source === "Dexcom Clarity"
                                ? "Clarity data · check primary device"
                                : !readingCurrent
                                  ? lowReading
                                    ? "Earlier low · recheck glucose now"
                                    : "Stored reading · check current glucose"
                                  : levelLabel}
                        </span>
                      )}
                    </div>
                  </div>
                  {readingCurrent && lowReading && (
                    <div className="care-workspace-low" role="alert">
                      <strong>Low glucose · follow your care plan</strong>
                      <p>
                        Check your primary device and follow your clinician’s low-glucose
                        instructions. Do not give insulin to treat a low.
                      </p>
                      <p>
                        If unconscious, having a seizure, or unable to swallow safely, call your
                        local emergency number immediately. Use prescribed rescue medicine according
                        to its instructions.
                      </p>
                      <div className="care-workspace-low-actions">
                        <button type="button" onClick={() => setEmergencyOpen(true)}>
                          {instructions.lowGlucose || instructions.severeLow
                            ? "Open your low-glucose instructions"
                            : "See emergency guidance"}
                        </button>
                        <button type="button" onClick={() => setLowTreatmentOpen(true)}>
                          Log treatment
                        </button>
                        <button type="button" onClick={() => open("glucose")}>
                          Log recheck
                        </button>
                      </div>
                    </div>
                  )}

                  <GlucoseChart
                    plan={plan}
                    illnesses={illnessWindows}
                    now={now?.getTime() ?? NaN}
                    correctionAt={chartCorrectionAt}
                    correctionHours={plan.correctionHours}
                    estimate={estimate}
                    onSelectIllness={(illness) => setIllnessEditor({ record: illness })}
                    key={day}
                    onSelectDoseFood={(dose) => openDoseFood(dose)}
                    onSelectEntry={(entry) => open(entry.kind, entry)}
                    entries={entries}
                    cgm={cgm}
                    dexcomEvents={dexcomEvents}
                    timezone={plan.timezone}
                    day={day}
                    today={today}
                    range={chartRange}
                    onRangeChange={setChartRange}
                    cgmHistoryStart={cgmHistoryStart}
                    cgmHistoryCapped={historyLimited}
                  />
                  <div className="data-quality">
                    {chartMultiDay && day && (
                      <span>
                        <strong>{date(fromLocal(day + "T12:00", plan.timezone))} only:</strong>{" "}
                        coverage, totals and the daily log
                      </span>
                    )}
                    <span>
                      Observed CGM coverage: <strong>{dailyCgmSummary.coveragePercent}%</strong>
                    </span>
                    <span>
                      {latestCgm && day === today && now
                        ? `Latest imported point: ${timeAgo(latestCgm.at, now.getTime())}`
                        : `${dailyCgmSummary.uniqueReadings} unique CGM points`}
                    </span>
                    {day === today && runningSensor && (
                      <span title={`Sensor ending ${runningSensor.sensorId.slice(-4)}`}>
                        {runningSensor.inUse ? (
                          <>
                            Sensor day <strong>{runningSensor.day}</strong> · started{" "}
                            {date(runningSensor.firstAt)}
                          </>
                        ) : (
                          `Last sensor: ${date(runningSensor.firstAt)} – ${date(runningSensor.lastAt)}`
                        )}
                      </span>
                    )}
                    {day === today && now && claritySync && (
                      <span
                        className={
                          clarityBehind(claritySync, now.getTime()) ? "is-delayed" : undefined
                        }
                        title={claritySync.lastError ?? undefined}
                      >
                        {claritySync.lastError
                          ? "Clarity sync failed"
                          : claritySync.lastSync
                            ? `Clarity synced ${timeAgo(claritySync.lastSync, now.getTime())}`
                            : "Clarity not synced yet"}
                        {claritySync.latestAt &&
                          ` · data through ${date(claritySync.latestAt)}, ${time(claritySync.latestAt)}`}
                      </span>
                    )}
                    {dailyCgmSummary.longestGapMinutes > 30 && (
                      <span>Longest gap: {dailyCgmSummary.longestGapMinutes} min</span>
                    )}
                  </div>
                </div>
                <div className="mini-stats care-workspace-stats">
                  <div>
                    <span className="icon-circle food">
                      <Utensils size={19} />
                    </span>
                    <div>
                      <p>Carbs logged</p>
                      <strong>
                        {fmt(
                          dayEntries.reduce(
                            (n, e) => n + (e.kind === "food" ? (e.carbs ?? 0) : 0),
                            0,
                          ),
                        )}
                        <small> g</small>
                      </strong>
                      {dayDoseFoods.length > 0 && (
                        <span className="reading-breakdown">
                          + {fmt(dayDoseFoods.reduce((sum, food) => sum + food.carbs, 0))} g in
                          meal-dose records
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="icon-circle insulin">
                      <Syringe size={19} />
                    </span>
                    <div>
                      <p>Rapid-acting logged</p>
                      <strong>
                        {fmt(
                          dayEntries.reduce(
                            (n, e) => n + (e.insulin === "Rapid-acting" ? (e.units ?? 0) : 0),
                            0,
                          ),
                        )}
                        <small> units</small>
                      </strong>
                    </div>
                  </div>
                  <div>
                    <span className="icon-circle glucose">
                      <Droplet size={19} />
                    </span>
                    <div>
                      <p>Glucose readings</p>
                      <strong>
                        {readings.length + dailyCgmSummary.uniqueReadings}
                        <small> total</small>
                      </strong>
                      <span className="reading-breakdown">
                        {readings.length} manual · {dailyCgmSummary.uniqueReadings} CGM
                      </span>
                    </div>
                  </div>
                </div>
                <div className="recent-care" aria-label="Latest recorded care across all days">
                  <div>
                    <span>
                      <Syringe size={16} />
                      Latest Rapid-acting
                    </span>
                    <strong>
                      {lastRapid ? `${fmt(lastRapid.units ?? 0)} units` : "None recorded"}
                    </strong>
                    <small>
                      {lastRapid
                        ? `${date(lastRapid.at)} · ${time(lastRapid.at)}`
                        : "Check the full care history"}
                    </small>
                  </div>
                  <div>
                    <span>
                      <Moon size={16} />
                      Latest Long-acting
                    </span>
                    <strong>
                      {lastBasal ? `${fmt(lastBasal.units ?? 0)} units` : "None recorded"}
                    </strong>
                    <small>
                      {lastBasal
                        ? `${date(lastBasal.at)} · ${time(lastBasal.at)}`
                        : "No dose recorded"}
                    </small>
                  </div>
                  <button
                    type="button"
                    disabled={plan.basal === 0}
                    onClick={() => setNightOpen(true)}
                  >
                    <Moon size={17} />
                    <span>
                      Evening routine<small>{basalLabel}</small>
                    </span>
                    <ChevronRight size={17} />
                  </button>
                </div>
                <Dialog open={showFoodTools} onOpenChange={setShowFoodTools}>
                  <DialogContent className="care-dialog food-builder-dialog">
                    <DialogHeader>
                      <DialogTitle>Food builder</DialogTitle>
                      <DialogDescription>
                        Search saved foods, add something new, and set the portion eaten. This is
                        calculation support, not an instruction to give insulin.
                      </DialogDescription>
                    </DialogHeader>
                    <FoodPicker
                      savedFoods={savedFoods}
                      items={foodBuilderItems}
                      onItemsChange={setFoodBuilderItems}
                      onSaveFood={saveFoodFavorite}
                      onDeleteFood={removeFavorite}
                      recentFoods={recentFoodItems}
                    />
                    {foodBuilderItems.length > 0 && (
                      <div className="food-builder-actions">
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => {
                            const items = foodBuilderItems;
                            setShowFoodTools(false);
                            openDoseFlow("Carbs", null, {
                              carbs: fmt(items.reduce((sum, item) => sum + item.carbs, 0)),
                              foodItems: items,
                            });
                          }}
                        >
                          Use these carbs in insulin calculator
                        </button>
                        <button
                          type="button"
                          className="button full outline"
                          disabled={
                            loading ||
                            !!error ||
                            foodBuilderItems.reduce((sum, item) => sum + item.carbs, 0) > 1000
                          }
                          onClick={() => {
                            const items = foodBuilderItems;
                            setShowFoodTools(false);
                            open("food", undefined, {
                              carbs: fmt(items.reduce((sum, item) => sum + item.carbs, 0)),
                              foodItems: items,
                              note: foodItemsNote(items),
                            });
                          }}
                        >
                          Log this food
                          <ArrowUpRight size={16} />
                        </button>
                        <p className="tiny centered">
                          Food logging does not record an insulin dose.
                        </p>
                      </div>
                    )}
                  </DialogContent>
                </Dialog>
                <div className="team-card care-workspace-team">
                  <Phone size={18} />
                  <div>
                    <strong>Questions about a dose or symptoms?</strong>
                    <p>
                      Follow your current care plan and contact{" "}
                      {careTeamName ?? "your own diabetes care team"}. Carby does not provide a
                      clinical contact service.
                    </p>
                    {contactLines
                      // A care team name with nothing else is already named in the sentence above.
                      .filter((line) => line.key !== "careTeam" || line.phone || line.availability)
                      .map((line) => (
                        <div key={line.key} className="care-workspace-contact">
                          {line.phone ? (
                            <a href={line.phone.href}>
                              {line.title}: {line.phone.number}
                            </a>
                          ) : (
                            <strong>{line.title}</strong>
                          )}
                          {line.availability && <p>{line.availability}</p>}
                        </div>
                      ))}
                    <button type="button" onClick={() => setEmergencyOpen(true)}>
                      Low glucose & emergency help
                    </button>
                  </div>
                </div>
              </section>
              <aside className="side-column">
                {canLog ? (
                  <div className="quick-actions">
                    <button
                      type="button"
                      onClick={() => open("glucose")}
                      disabled={loading || !!error}
                    >
                      <Droplet size={19} />
                      Log glucose
                      <Plus size={17} />
                    </button>
                    <button
                      type="button"
                      onClick={() => open("food")}
                      disabled={loading || !!error}
                    >
                      <Utensils size={19} />
                      Meal or snack
                      <Plus size={17} />
                    </button>
                    <button
                      type="button"
                      onClick={() => open("insulin")}
                      disabled={loading || !!error}
                    >
                      <Syringe size={19} />
                      Log insulin
                      <Plus size={17} />
                    </button>
                  </div>
                ) : (
                  <p className="notice view-only-banner" role="status">
                    <Eye size={16} aria-hidden="true" />
                    View only. You can see {personLabel(profile?.name)}’s log but can’t add to it.
                  </p>
                )}
                <DailyLog
                  day={day}
                  today={today}
                  plan={plan}
                  desktopLog={desktopLog}
                  loading={loading}
                  groupedEvents={groupedEvents}
                  dayIllnesses={dayIllnesses}
                  entryCount={dayEntries.length}
                  doseFoodRecords={dayDoseFoods}
                  cgmCount={sampledCgm.length}
                  dayCgmCount={dayCgm.length}
                  dailyCgmUniqueReadings={dailyCgmSummary.uniqueReadings}
                  cgmInterval={cgmInterval}
                  onCgmIntervalChange={setCgmInterval}
                  entries={entries}
                  linkedRecordIds={linkedRecordIds}
                  selectedFoodIds={selectedFoodIds}
                  onToggleFoodSelection={toggleFoodSelection}
                  selectedFoods={selectedFoods}
                  selectedCarbs={selectedCarbs}
                  selectedRatio={selectedRatio}
                  selectedFoodMath={selectedFoodMath}
                  selectionMeal={selectionMeal}
                  onSelectionMealChange={setSelectionMeal}
                  onClearSelectedFoods={() => setSelectedFoodIds([])}
                  onLogSelectedFoodDose={logSelectedFoodDose}
                  onEditIllness={(illness) => setIllnessEditor({ record: illness })}
                  onSelectEntry={open}
                  onSelectDoseFood={openDoseFood}
                />
              </aside>
            </div>
          </TabsContent>
          <TabsContent
            value="insights"
            forceMount
            hidden={view !== "insights"}
            className="care-page-panel"
          >
            <Insights
              active={view === "insights"}
              entries={entries}
              cgm={cgm}
              timezone={plan.timezone}
              illnesses={illnessWindows}
              patientName={profile?.name}
              plan={plan}
              onLogIllness={canLog ? () => setIllnessEditor({ record: null }) : undefined}
            />
          </TabsContent>
          <TabsContent
            value="logbook"
            forceMount
            hidden={view !== "logbook"}
            className="care-page-panel"
          >
            {Number.isFinite(nowMs) && (
              <Logbook
                entries={entries}
                cgm={cgm}
                plan={plan}
                illnesses={illnessWindows}
                now={nowMs}
              />
            )}
            <AppointmentsPanel
              appointments={appointments}
              plan={plan}
              now={nowMs}
              onSave={async (appointment) => {
                const ok = await mutate({ action: "saveAppointment", appointment });
                if (ok) {
                  toast.success("Appointment saved");
                  void load(true);
                }
                return ok;
              }}
              onDelete={async (appointment) => {
                const ok = await mutate({ action: "deleteAppointment", id: appointment.id });
                if (ok) {
                  setAppointments((current) =>
                    current.filter((item) => item.id !== appointment.id),
                  );
                  toast.success("Appointment deleted");
                  void load(true);
                }
                return ok;
              }}
            />
          </TabsContent>
          <TabsContent
            value="reports"
            forceMount
            hidden={view !== "reports"}
            className="care-page-panel"
          >
            <DoctorReport
              entries={entries}
              cgm={cgm}
              dexcomEvents={dexcomEvents}
              timezone={plan.timezone}
              illnesses={illnessWindows}
              patientName={profile?.name}
              plan={plan}
              active={view === "reports"}
            />
          </TabsContent>
          <footer>
            <span>Carby · Your daily care log</span>
            <span>
              Times in {plan.timezone} ·{" "}
              {dexcomConnected ? "Dexcom Share connected" : "Dexcom Share not connected"}
            </span>
          </footer>
        </main>
      </div>
      {canLog && (
        <LogMenu
          name={profile?.name}
          disabled={loading || !!error}
          nightlyDisabled={plan.basal === 0}
          onSelect={logAction}
        />
      )}
      <button
        type="button"
        className="shortcuts-fab"
        aria-label="Keyboard shortcuts"
        aria-keyshortcuts="?"
        onClick={() => setShortcutsOpen(true)}
      >
        <span aria-hidden="true">?</span>
        <span className="shortcuts-fab-label" aria-hidden="true">
          Keyboard shortcuts
        </span>
      </button>
      <Dialog open={emergencyOpen} onOpenChange={setEmergencyOpen}>
        <DialogContent className="care-dialog care-workspace-emergency-dialog">
          <DialogHeader>
            <DialogTitle>Low, high & emergency steps</DialogTitle>
            <DialogDescription>
              Keep this available even if the chart has no current reading. Use your current care
              plan and primary device.
            </DialogDescription>
          </DialogHeader>
          {/* Urgent guardrails and the call button stay above any saved care-plan text. */}
          <section className="care-workspace-guidance is-urgent">
            <h3>Seizure, unconscious, or cannot swallow safely</h3>
            <p>
              {emergencyLink
                ? "Call your emergency number immediately."
                : "Call your local emergency number immediately."}{" "}
              Give nothing by mouth if swallowing is unsafe. Do not give insulin to treat a low.
              Carby is not an emergency service.
            </p>
            {emergencyLink && (
              <a className="care-workspace-emergency-call" href={emergencyLink.href}>
                <Phone size={17} />
                Call emergency number {emergencyLink.number}
              </a>
            )}
            {instructions.severeLow ? (
              <CarePlanInstructions text={instructions.severeLow} />
            ) : (
              <p>Use prescribed rescue medication according to its instructions.</p>
            )}
            <button
              className="button subtle"
              type="button"
              onClick={() => {
                setEmergencyOpen(false);
                open("rescue");
              }}
            >
              Log emergency medication given
            </button>
          </section>
          <section className="care-workspace-guidance">
            <h3>Low glucose and able to swallow</h3>
            {instructions.lowGlucose ? (
              <CarePlanInstructions text={instructions.lowGlucose} />
            ) : (
              <p>
                Follow your clinician’s low-glucose plan for treatment amounts and when to recheck.
                Use your primary glucose device.
              </p>
            )}
            <button
              className="button subtle"
              type="button"
              onClick={() => {
                setEmergencyOpen(false);
                setLowTreatmentOpen(true);
              }}
            >
              Log treatment actually taken
            </button>
          </section>
          <section className="care-workspace-guidance">
            <h3>High glucose</h3>
            {instructions.highGlucose ? (
              <CarePlanInstructions text={instructions.highGlucose} />
            ) : (
              <p>Follow your clinician’s high-glucose plan, including when to check ketones.</p>
            )}
          </section>
          <section className="care-workspace-guidance">
            <h3>Illness, ketones & questions</h3>
            {instructions.sickDay ? (
              <CarePlanInstructions text={instructions.sickDay} />
            ) : (
              <p>Follow your clinician’s sick-day and ketone instructions.</p>
            )}
            {instructions.whenToCall && (
              <>
                <h4>When to call the care team</h4>
                <CarePlanInstructions text={instructions.whenToCall} />
              </>
            )}
            <p>
              Contact {careTeamName ?? "your own diabetes care team"} for advice. Severe symptoms
              such as vomiting, confusion, or difficulty breathing need urgent medical attention.
            </p>
            {contactLines.length > 0 && (
              <div className="care-workspace-care-contacts">
                {contactLines.map((line) =>
                  line.phone ? (
                    <a key={line.key} href={line.phone.href}>
                      {line.title}
                      <small>{line.phone.number}</small>
                      {line.availability && <small>{line.availability}</small>}
                    </a>
                  ) : (
                    <span key={line.key}>
                      {line.title}
                      {line.availability && <small>{line.availability}</small>}
                    </span>
                  ),
                )}
              </div>
            )}
          </section>
        </DialogContent>
      </Dialog>
      <LowTreatmentDialog
        open={lowTreatmentOpen}
        onOpenChange={setLowTreatmentOpen}
        plan={plan}
        savedFoods={savedFoods}
        onSave={async (entry) => {
          if (!(await saveEntry(entry, null))) throw new Error("Could not save.");
        }}
      />
      <SickDayDialog
        status={sickStatus}
        plan={plan}
        open={sickDayOpen}
        onOpenChange={setSickDayOpen}
        onLogGlucose={() => {
          setSickDayOpen(false);
          open("glucose");
        }}
        onLogKetones={() => {
          setSickDayOpen(false);
          open("glucose");
        }}
        onCheckIn={(illnessId, checkIn) => {
          setSickDayOpen(false);
          setCheckInEditor({ illnessId, checkIn });
        }}
      />
      <DoseFlow
        open={doseFlow !== null}
        onClose={() => setDoseFlow(null)}
        initialMode={doseFlow?.mode ?? "Carbs"}
        initialMeal={doseFlow?.meal ?? null}
        initialCarbs={doseFlow?.carbs ?? ""}
        initialFoodItems={doseFlow?.foodItems ?? []}
        initialLinkedFoodIds={doseFlow?.linkedFoodIds ?? []}
        savedFoods={savedFoods}
        recentFoods={recentFoodItems}
        onSaveFood={saveFoodFavorite}
        onDeleteFood={removeFavorite}
        plan={plan}
        entries={entries}
        cgm={cgm}
        day={day}
        today={today}
        now={now}
        dexcomConnected={dexcomConnected}
        dexcomLatestShareAt={dexcomLatestShareAt}
        dexcomBusy={dexcomBusy}
        onSyncDexcom={syncForCorrection}
        saving={saving}
        onSubmit={submitDoseFlow}
        onLogActualDose={openActualDoseLog}
      />
      {illnessEditor && (
        <IllnessDialog
          initial={illnessEditor.record}
          timezone={plan.timezone}
          day={day}
          unit={plan.temperatureUnit}
          saving={saving}
          onClose={() => setIllnessEditor(null)}
          onCheckIn={(illnessId, checkIn) => {
            setIllnessEditor(null);
            setCheckInEditor({ illnessId, checkIn });
          }}
          onSave={(illness, ended) =>
            saveIllness(
              illness,
              ended
                ? "All better! Illness period ended."
                : `${periodKindLabels[periodKind(illness)]} period saved`,
            )
          }
          onDelete={async (illness) => {
            const deleted = await mutate({ action: "deleteIllness", illness });
            if (deleted) {
              setIllnessWindows((current) => current.filter((item) => item.id !== illness.id));
              toast.success(`${periodKindLabels[periodKind(illness)]} period deleted`);
              void load(true);
            }
            return deleted;
          }}
        />
      )}
      {checkInEditor && checkInIllness && (
        <IllnessCheckInDialog
          key={`${checkInEditor.illnessId}:${checkInEditor.checkIn?.id ?? "new"}`}
          illness={checkInIllness}
          timezone={plan.timezone}
          initial={checkInEditor.checkIn}
          unit={plan.temperatureUnit}
          saving={saving}
          onClose={() => setCheckInEditor(null)}
          onSave={saveIllness}
          onLogKetones={() => {
            setCheckInEditor(null);
            open("glucose");
          }}
          onChooseUnit={() => window.location.assign("/plan#schedule")}
        />
      )}
      <Dialog open={nightOpen} onOpenChange={setNightOpen}>
        <DialogContent className="care-dialog night-dialog">
          <section className="night-card night-dialog-card">
            <div className="night-title">
              <Moon size={20} />
              <span>Evening routine</span>
              <Bell size={17} />
            </div>
            <div className="night-time">
              {basalLabel}
              <span>{plan.timezone}</span>
            </div>
            <p className="night-occurrence">
              {nightly
                ? `Schedule for ${date(nightly.at)} · ${nightly.state === "logged" ? "dose recorded" : "no matching dose logged"}`
                : "Nightly schedule"}
            </p>
            <div className="night-dose">
              <strong>Long-acting</strong>
              <span>{plan.basal} units · prescribed</span>
            </div>
            <div className="night-status">
              {nightly?.logged.length ? (
                <>
                  <Check size={16} />
                  {nightly.logged
                    .map((e) => `${e.units} units logged ${date(e.at)} at ${time(e.at)}`)
                    .join("; ")}
                </>
              ) : (
                <>
                  <Clock3 size={16} />
                  {lastBasal
                    ? `Last: ${lastBasal.units} units · ${date(lastBasal.at)}, ${time(lastBasal.at)}`
                    : "No Long-acting dose recorded yet"}
                </>
              )}
            </div>
            <button
              type="button"
              className="button full"
              disabled={loading || !!error}
              onClick={() => open("insulin", undefined, { insulin: "Long-acting" })}
            >
              Record actual dose
              <Plus size={16} />
            </button>
            <section className="night-estimate" aria-labelledby="night-estimate-title">
              <h3 id="night-estimate-title">Likely range, next 2 hours</h3>
              {estimate.state === "ready" ? (
                <>
                  <EstimateChart estimate={estimate} ranges={ranges} time={time} />
                  <dl>
                    {[2, 4, 8].flatMap((i) => {
                      const point = estimate.points[i];
                      return point
                        ? [
                            <div key={point.at}>
                              <dt>{time(point.at)}</dt>
                              <dd>
                                <strong>{estimateLabel(point.median)}</strong> median · most likely{" "}
                                {estimateLabel(point.low)}–{estimateLabel(point.high)} mg/dL
                              </dd>
                            </div>,
                          ]
                        : [];
                    })}
                  </dl>
                  <p className="night-estimate-note">
                    From how your CGM readings moved after trends like this one, over about{" "}
                    {Math.round((estimate.examples * 5) / 60)} hours of your history. It uses CGM
                    only, so it can’t see food, insulin or activity, and it is not dosing advice.
                  </p>
                </>
              ) : (
                <p className="night-estimate-note">
                  {estimate.state === "learning"
                    ? "The likely range shows after about a day of CGM readings."
                    : "Needs a current CGM reading and the hour before it."}
                </p>
              )}
            </section>
            <p>
              The header reminder uses this schedule and actual Long-acting logs nearest to it,
              including after midnight. Check the actual times before giving insulin. A missing log
              does not confirm a missed dose.
            </p>
          </section>
        </DialogContent>
      </Dialog>
      <Dialog
        open={importOpen}
        onOpenChange={(v) => {
          if (importing || dexcomBusy) return;
          setImportOpen(v);
          if (!v) {
            setPendingCsv(null);
            setCsvIdentityConfirmed(false);
            setImportMessage("");
          }
        }}
      >
        <DialogContent className="care-dialog">
          <DialogHeader>
            <DialogTitle>Dexcom glucose</DialogTitle>
            <DialogDescription>
              Bring recent Share readings in automatically while this dashboard is open, import a
              Clarity export, or connect Clarity share-code sync.
            </DialogDescription>
          </DialogHeader>
          {!canManage && (
            <p className="notice" role="status">
              Only an owner can connect or disconnect Dexcom. You can still refresh readings.
            </p>
          )}
          <Tabs defaultValue="share">
            <TabsList>
              <TabsTrigger value="share">Live Share</TabsTrigger>
              <TabsTrigger value="csv">Clarity CSV</TabsTrigger>
              <TabsTrigger value="clarity">Clarity sync</TabsTrigger>
            </TabsList>
            <TabsContent value="share">
              <div className="entry-form">
                {dexcomConnected ? (
                  <>
                    <p className="notice">
                      Last attempt:{" "}
                      {dexcomLastAttempt
                        ? `${date(dexcomLastAttempt)} at ${time(dexcomLastAttempt)}`
                        : "not yet"}
                      . Last successful check:{" "}
                      {dexcomLastSync
                        ? `${date(dexcomLastSync)} at ${time(dexcomLastSync)}`
                        : "not yet"}
                      . Last actual Share reading:{" "}
                      {dexcomLatestShareAt
                        ? `${date(dexcomLatestShareAt)} at ${time(dexcomLatestShareAt)}`
                        : "none received"}
                      . {dexcomFailure && <span>Sync issue: {dexcomFailure}</span>}
                    </p>
                    {shareDelayed && (
                      <div
                        className="notice timing-warning care-workspace-sync-warning"
                        role="status"
                      >
                        <p>
                          Share data is over 30 minutes old or unavailable. Check the G7 app, Share,
                          and the phone’s internet connection. Use your primary device for current
                          readings.
                        </p>
                        <button
                          type="button"
                          className="button subtle care-workspace-sync-button"
                          disabled={dexcomBusy}
                          onClick={() => void syncDexcom(true)}
                        >
                          {dexcomBusy ? (
                            <Loader2 size={16} className="spin" />
                          ) : (
                            <RefreshCw size={16} />
                          )}
                          Sync now
                        </button>
                      </div>
                    )}
                    {!shareDelayed && (
                      <button
                        type="button"
                        className="button primary full"
                        disabled={dexcomBusy}
                        onClick={() => void syncDexcom(true)}
                      >
                        {dexcomBusy ? "Syncing…" : "Pull recent readings"}
                      </button>
                    )}
                    <button
                      className="text-button"
                      disabled={dexcomBusy}
                      onClick={() => {
                        setChangingDexcomAccount(true);
                        setDexcomMessage("");
                      }}
                    >
                      Change publisher account
                    </button>
                    <button
                      className="text-button delete"
                      disabled={dexcomBusy}
                      onClick={() => void disconnectDexcom()}
                    >
                      Disconnect Share
                    </button>
                  </>
                ) : null}
                {(!dexcomConnected || changingDexcomAccount) && (
                  <>
                    <p className="helper">
                      In the G7 app, turn on Share and add at least one follower. Enter the
                      credentials for the account signed in to your G7 app, not the follower’s
                      login. A different account can sign in successfully but return no readings.
                      The current connection stays in place unless the new account returns readings.
                    </p>
                    <DexcomCredentialsForm
                      defaults={dexcomDefaults}
                      busy={dexcomBusy}
                      connected={dexcomConnected}
                      onConnect={connectDexcom}
                      onCancel={dexcomConnected ? () => setChangingDexcomAccount(false) : undefined}
                    />
                  </>
                )}
                {dexcomMessage && (
                  <p className="notice" role="status">
                    {dexcomMessage}
                  </p>
                )}
                <p className="helper">
                  The login is encrypted on this private site and only sent to Dexcom Share. Share
                  is an unofficial interface and may stop working. It offers glucose readings only;
                  use Clarity CSV to import calibrations and other logged events. This is a review
                  log, not a glucose alert or a treatment device.
                </p>
              </div>
            </TabsContent>
            <TabsContent value="csv">
              <div className="entry-form">
                <p className="helper">
                  Export a CSV from{" "}
                  <a href="https://clarity.dexcom.com/" target="_blank" rel="noreferrer">
                    Dexcom Clarity
                  </a>
                  . Preview the person, dates, and contents before adding anything to the care log.
                  Export times are interpreted in {plan.timezone}.
                </p>
                <label className="field">
                  <span>Choose Clarity CSV</span>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    disabled={importing}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void previewImportFile(file);
                      e.target.value = "";
                    }}
                  />
                </label>
                {pendingCsv && (
                  <section className="care-workspace-csv-preview" aria-label="Clarity CSV preview">
                    <h3>Review before importing</h3>
                    <p className="care-workspace-csv-file">{pendingCsv.fileName}</p>
                    <dl>
                      <div>
                        <dt>Patient in file</dt>
                        <dd>
                          {pendingCsv.parsed.identity.firstName ||
                          pendingCsv.parsed.identity.lastName
                            ? `${pendingCsv.parsed.identity.firstName ?? ""} ${pendingCsv.parsed.identity.lastName ?? ""}`.trim()
                            : "Not provided"}
                        </dd>
                      </div>
                      {pendingCsv.parsed.identity.dateOfBirth && (
                        <div>
                          <dt>Date of birth</dt>
                          <dd>{pendingCsv.parsed.identity.dateOfBirth}</dd>
                        </div>
                      )}
                      <div>
                        <dt>Date range</dt>
                        <dd>
                          {csvRange
                            ? `${date(csvRange.first)}, ${time(csvRange.first)} – ${date(csvRange.last)}, ${time(csvRange.last)}`
                            : "No dated records"}
                        </dd>
                      </div>
                      <div>
                        <dt>Contents</dt>
                        <dd>
                          {pendingCsv.parsed.readings.length} glucose readings ·{" "}
                          {pendingCsv.parsed.events.length} events
                        </dd>
                      </div>
                    </dl>
                    <p className="notice timing-warning">
                      Carby cannot verify who this file belongs to. Check the identity, source, and
                      date range before importing into this account.
                    </p>
                    {pendingCsv.parsed.events.length === 0 && (
                      <p className="helper">
                        No timestamped Dexcom events were found. A calibration will only appear if
                        it is included in this export.
                      </p>
                    )}
                    {pendingCsv.parsed.skipped > 0 && (
                      <p className="helper">
                        {pendingCsv.parsed.skipped} unreadable rows will be skipped.
                      </p>
                    )}
                    <label className="check-row">
                      <Checkbox
                        checked={csvIdentityConfirmed}
                        onCheckedChange={(value) => setCsvIdentityConfirmed(value === true)}
                      />
                      <span>
                        I verified this file belongs to the person whose care I am recording and the
                        date range is right.
                      </span>
                    </label>
                    <div className="care-workspace-csv-actions">
                      <button
                        type="button"
                        className="button primary"
                        disabled={importing || !csvIdentityConfirmed}
                        onClick={() => void confirmImportFile()}
                      >
                        {importing ? "Importing…" : "Confirm and import"}
                      </button>
                      <button
                        type="button"
                        className="button subtle"
                        disabled={importing}
                        onClick={() => {
                          setPendingCsv(null);
                          setCsvIdentityConfirmed(false);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </section>
                )}
                {importing && !pendingCsv && <p role="status">Reading file…</p>}
                {importMessage && (
                  <p className="notice" role="status">
                    {importMessage}
                  </p>
                )}
                <p className="helper">
                  Imported glucose and Dexcom events remain distinct from manual entries. Repeating
                  an import skips unchanged records.
                </p>
              </div>
            </TabsContent>
            <TabsContent value="clarity">
              <ClarityPanel timezone={plan.timezone} onImported={() => void load()} />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
      {handoffOpen && (
        <CareHandoff
          open={handoffOpen}
          onClose={() => setHandoffOpen(false)}
          entries={entries}
          cgm={cgm}
          plan={plan}
          illnesses={illnessWindows}
          patientName={profile?.name}
        />
      )}
      <EntryDialog
        modal={modal}
        editing={editing}
        prefill={entryPrefill}
        plan={plan}
        savedFoods={savedFoods}
        recentFoods={recentFoodItems}
        repeatMeals={repeatMeals}
        editingLinks={editingLinks}
        lastRapid={lastRapid}
        lastBasal={lastBasal}
        basalToday={basalToday}
        doseGlucoseText={doseGlucoseText}
        doseGlucoseAge={doseGlucoseAge}
        saving={saving}
        onSave={async (entry, foodDoseSource) => {
          const isNew = !editing;
          const ok = await saveEntry(entry, foodDoseSource);
          if (ok && isNew && !foodDoseSource)
            setFoodDose(foodDosePrompt({ entry, plan, now: Date.now(), aboveRange }));
          return ok;
        }}
        onDelete={deleteEntry}
        onClose={() => setModal(null)}
        onSaveFood={saveFoodFavorite}
        onDeleteFood={removeFavorite}
        onOpenEntry={open}
        onOpenDoseFood={openDoseFood}
        onCalculateAndLog={openDoseFlow}
      />
      <Dialog open={!!foodDose} onOpenChange={(v) => !v && setFoodDose(null)}>
        <DialogContent className="care-dialog food-dose-dialog">
          {foodDose && (
            <>
              <DialogHeader>
                <DialogTitle>{fmt(foodDose.carbs)} g reaches your snack insulin cutoff</DialogTitle>
                <DialogDescription>
                  Your care plan gives no insulin for snacks under {fmt(foodDose.cutoff)} g.
                  {foodDose.mode === "Carbs + correction" && latest
                    ? ` The current reading, ${latest.status === "High" ? "HIGH" : `${latest.value} mg/dL`}, is above your range.`
                    : ""}{" "}
                  Check your care plan before giving insulin.
                </DialogDescription>
              </DialogHeader>
              <div className="food-dose-actions">
                <button
                  type="button"
                  className="button primary"
                  onClick={() => {
                    setFoodDose(null);
                    openDoseFlow(
                      foodDose.mode,
                      foodDose.ratioMeal ?? mealRatioAt(new Date(foodDose.at), plan.timezone),
                      {
                        carbs: fmt(foodDose.carbs),
                        linkedFoodIds: [foodDose.entryId],
                      },
                    );
                  }}
                >
                  <Calculator size={16} aria-hidden="true" />
                  {foodDose.mode === "Carbs + correction"
                    ? "Open calculator: carbs + correction"
                    : "Open calculator: carbs"}
                </button>
                <button type="button" className="button outline" onClick={() => setFoodDose(null)}>
                  Not now
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
