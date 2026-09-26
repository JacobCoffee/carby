import { database } from "@/db/raw";
import { runScheduledClarity } from "@/lib/clarity-sync";

export const dynamic = "force-dynamic";

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

/**
 * Run the daily Clarity sync. scripts/serve-production.mjs calls this over loopback with a token
 * it generates at startup, so it answers nobody else; without that token the route does not exist.
 */
export async function POST(request: Request) {
  const token = process.env.CARBY_SCHEDULER_TOKEN;
  if (!token) return new Response("Not found.", { status: 404 });
  const [expected, given] = await Promise.all([
    digest(`Bearer ${token}`),
    digest(request.headers.get("authorization") ?? ""),
  ]);
  // Equal-length digests compared in full, so timing does not reveal the token.
  if (expected.reduce((diff, byte, i) => diff | (byte ^ given[i]), 0) !== 0)
    return new Response("Not found.", { status: 404 });
  const result = await runScheduledClarity(database());
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
