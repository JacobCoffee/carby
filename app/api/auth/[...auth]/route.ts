import { Auth } from "@auth/core";
import { buildAuthConfig, type AuthEnv } from "@/lib/auth-config";
import { canonicalOrigin, withCanonicalOrigin } from "@/lib/auth-origin";
import { textResponse } from "@/lib/local-session";

export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  const env = process.env as AuthEnv;
  const origin = canonicalOrigin(env);
  const config = buildAuthConfig(env);
  if (!origin || !config) return textResponse(404, "Not found.");
  return Auth(withCanonicalOrigin(request, origin), config);
}

export { handle as GET, handle as POST };
