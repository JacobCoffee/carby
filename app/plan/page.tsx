import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireCurrentUser } from "../auth";
import { pagePeople } from "../access";
import { PersonProvider } from "../person-context";
import PlanPage, { type PlanVersion } from "../plan-page";
import { database } from "@/db/raw";
import { planSchema } from "@/lib/care";
import { PERSON_COOKIE, type PersonAccess } from "@/lib/people";
import { PERSON_META } from "@/lib/person-request";
import { profileSchema } from "@/lib/profile";

export const dynamic = "force-dynamic";

/** The care plan, one section at a time. Setup on `/` owns a plan that is missing or incomplete. */
export default async function CarePlan() {
  const user = await requireCurrentUser("/plan");
  const db = database();
  const { people, active } = await pagePeople(
    db,
    user,
    (await cookies()).get(PERSON_COOKIE)?.value,
  );
  const access: PersonAccess = { person: active.id, role: active.role, people };
  const owner = active.id;
  const [saved, profileRow] = await Promise.all([
    db
      .prepare("SELECT data, created FROM plans WHERE owner = $1 ORDER BY created DESC LIMIT 20")
      .bind(owner)
      .all<{ data: string; created: string | Date }>(),
    db.prepare("SELECT data FROM profiles WHERE owner = $1").bind(owner).first<{ data: string }>(),
  ]);
  const versions = saved.results.map((row) => ({
    parsed: planSchema.safeParse(JSON.parse(row.data)),
    at: new Date(row.created).toISOString(),
  }));
  const current = versions[0]?.parsed;
  if (!current?.success) redirect("/");
  // An older version saved under an earlier schema is left out rather than shown half-read.
  const history: PlanVersion[] = versions.flatMap(({ parsed, at }) =>
    parsed.success ? [{ plan: parsed.data, at }] : [],
  );
  const profile = profileRow ? profileSchema.safeParse(JSON.parse(profileRow.data)) : null;
  return (
    <PersonProvider value={access}>
      {/* apiFetch reads this, so every request from this page names the person it shows. */}
      <meta name={PERSON_META} content={owner} />
      <PlanPage
        initialPlan={current.data}
        initialHistory={history}
        name={profile?.success ? profile.data.name : undefined}
      />
    </PersonProvider>
  );
}
