import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Cabotage's health probe: unauthenticated, fast, no heavy work. */
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/_health" || request.nextUrl.pathname === "/_health/") {
    return new Response("ok", { status: 200, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/_health", "/_health/"],
};
