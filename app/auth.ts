import { headers } from "next/headers";
import { redirect, unauthorized } from "next/navigation";
import { configuredProviderIds, oauthSessionUser, type AuthEnv } from "@/lib/auth-config";
import { safeAuthRedirectPath } from "@/lib/auth-origin";
import {
  canStartLocalSignIn,
  localSessionConfig,
  localSessionUser,
  localSignInPath,
  SIGN_IN_PATH,
} from "@/lib/local-session";

export type User = { userId: string; displayName: string };

function env(): AuthEnv {
  return process.env as AuthEnv;
}

async function sessionUser(requestHeaders: Pick<Headers, "get" | "has">): Promise<User | null> {
  const local = await localSessionUser(requestHeaders, localSessionConfig(env()));
  return local ?? (await oauthSessionUser(requestHeaders, env()));
}

/** The signed-in user, or null. Only a valid session cookie counts; identity headers never do. */
export async function getCurrentUser(): Promise<User | null> {
  return sessionUser(await headers());
}

/** Return the user, start sign-in, or refuse with 401 when this server has no sign-in. */
export async function requireCurrentUser(returnTo: string): Promise<User> {
  const requestHeaders = await headers();
  const user = await sessionUser(requestHeaders);
  if (user) return user;
  if (canStartLocalSignIn(requestHeaders, localSessionConfig(env()))) {
    redirect(localSignInPath(returnTo));
  }
  if (configuredProviderIds(env()).length > 0) {
    redirect(`${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeAuthRedirectPath(returnTo))}`);
  }
  unauthorized();
}
