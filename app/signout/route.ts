import { Auth, type AuthConfig } from "@auth/core";
import {
  buildAuthConfig,
  issueCsrfToken,
  hasOAuthSessionCookie,
  withIssuedCsrfCookie,
  type AuthEnv,
} from "@/lib/auth-config";
import { AUTH_BASE_PATH, canonicalOrigin } from "@/lib/auth-origin";
import {
  handleLocalSignOut,
  isPrefetch,
  isSameOriginNavigation,
  localSessionConfig,
  localSessionUser,
  SIGN_IN_PATH,
  textResponse,
} from "@/lib/local-session";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function refuseUntrusted(request: Request, origin: string): Response | null {
  if (!isSameOriginNavigation(request.headers, origin)) {
    return textResponse(403, "Open Carby directly to sign out. Cross-site sign-out is refused.");
  }
  if (isPrefetch(request.headers)) return new Response(null, { status: 204, headers: NO_STORE });
  return null;
}

// Both Auth.js calls run in-process, so the CSRF cookie they share never reaches the browser.
async function oauthSignOut(request: Request, config: AuthConfig, origin: URL): Promise<Response> {
  const incoming = request.headers.get("cookie");
  const { csrfToken, setCookies } = await issueCsrfToken(config, origin, incoming);
  const signOut = new Request(new URL(`${AUTH_BASE_PATH}/signout`, origin), {
    method: "POST",
    headers: {
      cookie: withIssuedCsrfCookie(incoming, origin, setCookies),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      csrfToken,
      callbackUrl: new URL(SIGN_IN_PATH, origin).toString(),
    }).toString(),
  });
  return Auth(signOut, config);
}

async function handle(request: Request): Promise<Response> {
  const env = process.env as AuthEnv;
  const localConfig = localSessionConfig(env);
  if (localConfig && (await localSessionUser(request.headers, localConfig))) {
    return handleLocalSignOut(request, localConfig);
  }

  const origin = canonicalOrigin(env);
  const refused = refuseUntrusted(request, origin?.origin ?? new URL(request.url).origin);
  if (refused) return refused;
  // Any session cookie is cleared, so a revoked owner cannot regain access if re-allowed.
  const config = buildAuthConfig(env);
  if (origin && config && hasOAuthSessionCookie(request.headers, env)) {
    return oauthSignOut(request, config, origin);
  }
  return new Response(null, { status: 302, headers: { ...NO_STORE, Location: SIGN_IN_PATH } });
}

export function GET(request: Request) {
  return handle(request);
}

export function POST(request: Request) {
  return handle(request);
}
