import { tokenGrant } from "@/app/access";
import { nightscoutPermissions, signJwt } from "@/lib/api-tokens";

/**
 * Nightscout's token exchange: a client sends its token in the path and uses the JWT it gets back
 * as `Authorization: Bearer` (API v3 clients such as AAPS do). The JWT lasts 8 hours and stops
 * working as soon as the token is revoked.
 */
export const dynamic = "force-dynamic";

const CORS = { "Access-Control-Allow-Origin": "*" };

export async function GET(request: Request) {
  const token = decodeURIComponent(new URL(request.url).pathname.split("/").at(-1) ?? "");
  const grant = await tokenGrant(token);
  if (grant instanceof Response) {
    grant.headers.set("Access-Control-Allow-Origin", "*");
    return grant;
  }
  const { jwt, iat, exp } = await signJwt(
    grant.id,
    grant.storedHash,
    grant.label,
    Date.now() / 1000,
  );
  return Response.json(
    {
      token: jwt,
      sub: grant.label,
      permissionGroups: [nightscoutPermissions(grant.scopes)],
      iat,
      exp,
    },
    { headers: { "Cache-Control": "no-store", ...CORS } },
  );
}
