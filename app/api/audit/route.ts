import { getCurrentUser } from "@/app/auth";
import { accessFor } from "@/app/access";
import { database } from "@/db/raw";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in to review changes." }, { status: 401 });
  const access = await accessFor(request, user, "read");
  if (access instanceof Response) return access;
  const owner = access.person;
  const limit = Math.min(
    100,
    Math.max(1, Number(new URL(request.url).searchParams.get("limit")) || 50),
  );
  try {
    const rows = await database()
      .prepare(
        'SELECT entry_id, actor_id, actor_name, action, "before", "after", at FROM care_audit WHERE owner = $1 ORDER BY at DESC LIMIT $2',
      )
      .bind(owner, limit)
      .all<{
        entry_id: string;
        actor_id: string;
        actor_name: string;
        action: string;
        before: string | null;
        after: string | null;
        at: string;
      }>();
    return Response.json(
      {
        changes: rows.results.map((row) => ({
          ...row,
          before: row.before ? JSON.parse(row.before) : null,
          after: row.after ? JSON.parse(row.after) : null,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "Change history is unavailable." }, { status: 503 });
  }
}
