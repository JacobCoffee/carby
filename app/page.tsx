import Dashboard from "./dashboard";
import CareSetup from "./care-setup";
import { requireCurrentUser } from "./auth";
import { database } from "@/db/raw";
import { planDraft, planSchema } from "@/lib/care";
import { careRecordKinds, cleanupImports, importCleanupNeeded } from "@/lib/care-records";
import { profileSchema } from "@/lib/profile";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireCurrentUser("/");
  const db = database();
  // Staged import rows are removed here too, so an import abandoned by closing the page does not linger.
  try {
    if (await importCleanupNeeded(db, user.userId)) await cleanupImports(db, user.userId);
  } catch {
    /* retried on the next visit */
  }
  const saved = await db
    .prepare("SELECT data FROM plans WHERE owner = $1 ORDER BY created DESC LIMIT 1")
    .bind(user.userId)
    .first<{ data: string }>();
  const savedData: unknown = saved ? JSON.parse(saved.data) : null;
  const plan = planSchema.safeParse(savedData);
  if (plan.success) return <Dashboard initialPlan={plan.data} />;
  const existing = await careRecordKinds(db, user.userId);
  const savedProfile = await db
    .prepare("SELECT data FROM profiles WHERE owner = $1")
    .bind(user.userId)
    .first<{ data: string }>();
  const parsedProfile = savedProfile
    ? profileSchema.safeParse(JSON.parse(savedProfile.data))
    : null;
  return (
    <CareSetup
      incompletePlan={saved ? planDraft(savedData) : undefined}
      hasRecords={existing.length > 0}
      profile={parsedProfile && parsedProfile.success ? parsedProfile.data : null}
    />
  );
}
