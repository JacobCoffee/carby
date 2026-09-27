import { cookies } from "next/headers";
import Dashboard from "./dashboard";
import CareSetup from "./care-setup";
import SetupPending from "./setup-pending";
import { requireCurrentUser } from "./auth";
import { listPeople } from "./access";
import { PersonProvider } from "./person-context";
import { database } from "@/db/raw";
import { planDraft, planSchema } from "@/lib/care";
import { careRecordKinds, cleanupImports, importCleanupNeeded } from "@/lib/care-records";
import { PERSON_COOKIE, type PersonAccess } from "@/lib/people";
import { PERSON_META } from "@/lib/person-request";
import { profileSchema } from "@/lib/profile";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireCurrentUser("/");
  const db = database();
  // Every account reaches at least one person; the cookie only picks which one opens first.
  const people = await listPeople(db, user);
  const chosen = (await cookies()).get(PERSON_COOKIE)?.value;
  const active = people.find((p) => p.id === chosen) ?? people[0]!;
  const access: PersonAccess = { person: active.id, role: active.role, people };
  const owner = active.id;
  // Staged import rows are removed here too, so an import abandoned by closing the page does not linger.
  try {
    if (await importCleanupNeeded(db, owner)) await cleanupImports(db, owner);
  } catch {
    /* retried on the next visit */
  }
  const saved = await db
    .prepare("SELECT data FROM plans WHERE owner = $1 ORDER BY created DESC LIMIT 1")
    .bind(owner)
    .first<{ data: string }>();
  const savedData: unknown = saved ? JSON.parse(saved.data) : null;
  const plan = planSchema.safeParse(savedData);
  let body;
  if (plan.success) body = <Dashboard initialPlan={plan.data} />;
  else if (active.role !== "owner") body = <SetupPending />;
  else {
    const existing = await careRecordKinds(db, owner);
    const savedProfile = await db
      .prepare("SELECT data FROM profiles WHERE owner = $1")
      .bind(owner)
      .first<{ data: string }>();
    const parsedProfile = savedProfile
      ? profileSchema.safeParse(JSON.parse(savedProfile.data))
      : null;
    body = (
      <CareSetup
        incompletePlan={saved ? planDraft(savedData) : undefined}
        hasRecords={existing.length > 0}
        profile={parsedProfile && parsedProfile.success ? parsedProfile.data : null}
      />
    );
  }
  return (
    <PersonProvider value={access}>
      {/* apiFetch reads this, so every request from this page names the person it shows. */}
      <meta name={PERSON_META} content={owner} />
      {body}
    </PersonProvider>
  );
}
