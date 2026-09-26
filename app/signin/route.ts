import {
  buildAuthConfig,
  configuredProviderIds,
  csrfCookieOnly,
  issueCsrfToken,
  oauthSessionUser,
  type AuthEnv,
} from "@/lib/auth-config";
import { AUTH_BASE_PATH, canonicalOrigin, safeAuthRedirectPath } from "@/lib/auth-origin";
import type { ProviderId } from "@/lib/auth-providers";
import {
  canStartLocalSignIn,
  handleLocalSignIn,
  localSessionConfig,
  textResponse,
} from "@/lib/local-session";

export const dynamic = "force-dynamic";

const PROVIDER_LABELS: Record<ProviderId, string> = {
  github: "GitHub",
  google: "Google",
  discord: "Discord",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function providerForm(id: ProviderId, csrfToken: string, callbackUrl: string): string {
  return [
    `<form method="post" action="${AUTH_BASE_PATH}/signin/${id}">`,
    `<input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">`,
    `<input type="hidden" name="callbackUrl" value="${escapeHtml(callbackUrl)}">`,
    `<p><button type="submit">Continue with ${PROVIDER_LABELS[id]}</button></p>`,
    "</form>",
  ].join("");
}

function signInPage(forms: string[], failed: boolean): string {
  return [
    '<!doctype html><meta charset="utf-8"><title>Sign in · Carby</title>',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<main style="max-width: 36rem; margin: 4rem auto; padding: 0 1.5rem">',
    "<h1>Sign in</h1>",
    "<p>Carby shows care records only to an approved account.</p>",
    failed ? "<p>Sign-in was not completed.</p>" : "",
    ...forms,
    "</main>",
  ].join("");
}

export async function GET(request: Request) {
  const env = process.env as AuthEnv;
  const localConfig = localSessionConfig(env);
  if (localConfig && canStartLocalSignIn(request.headers, localConfig)) {
    return handleLocalSignIn(request, localConfig);
  }

  const url = new URL(request.url);
  const returnTo = safeAuthRedirectPath(url.searchParams.get("return_to"));
  const origin = canonicalOrigin(env);
  const config = buildAuthConfig(env);
  const providerIds = configuredProviderIds(env);
  if (!origin || !config || providerIds.length === 0) return textResponse(404, "Not found.");

  if (await oauthSessionUser(request.headers, env)) {
    return new Response(null, {
      status: 302,
      headers: { "Cache-Control": "no-store", Location: new URL(returnTo, origin).toString() },
    });
  }

  const csrfCookie = csrfCookieOnly(request.headers.get("cookie"), origin);
  const { csrfToken, setCookies } = await issueCsrfToken(config, origin, csrfCookie);
  const callbackUrl = new URL(returnTo, origin).toString();
  const forms = providerIds.map((id) => providerForm(id, csrfToken, callbackUrl));
  const response = new Response(signInPage(forms, url.searchParams.has("error")), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "frame-ancestors 'none'",
      "X-Frame-Options": "DENY",
    },
  });
  for (const cookie of setCookies) response.headers.append("set-cookie", cookie);
  return response;
}
