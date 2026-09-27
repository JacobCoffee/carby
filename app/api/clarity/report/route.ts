import { getCurrentUser } from "@/app/auth";
import { accessFor } from "@/app/access";
import { database } from "@/db/raw";

export const dynamic = "force-dynamic";
function reply(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** Download one archived Clarity PDF: GET /api/clarity/report?id=… */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return reply({ error: "Sign in first." }, 401);
  const access = await accessFor(request, user, "read");
  if (access instanceof Response) return access;
  const owner = access.person;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  try {
    const row = await database()
      .prepare("SELECT start_date, end_date, pdf FROM clarity_reports WHERE id = $1 AND owner = $2")
      .bind(id, owner)
      .first<{ start_date: string; end_date: string; pdf: Buffer }>();
    if (!row) return reply({ error: "Report not found." }, 404);
    return new Response(new Uint8Array(row.pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="clarity-${row.start_date}-to-${row.end_date}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return reply({ error: "The report is unavailable." }, 503);
  }
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return reply({ error: "Sign in first." }, 401);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return reply({ error: "Request origin rejected." }, 403);
  const access = await accessFor(request, user, "manage");
  if (access instanceof Response) return access;
  const owner = access.person;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  try {
    const { meta } = await database()
      .prepare("DELETE FROM clarity_reports WHERE id = $1 AND owner = $2")
      .bind(id, owner)
      .run();
    return meta.changes ? reply({ ok: true }) : reply({ error: "Report not found." }, 404);
  } catch {
    return reply({ error: "Could not delete the report." }, 503);
  }
}
