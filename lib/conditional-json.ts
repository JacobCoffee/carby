/** Avoid retransmitting unchanged private snapshots during in-place refreshes. */
export async function conditionalJson(request: Request, data: unknown) {
  const body = JSON.stringify(data);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const etag =
    '"' +
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("") +
    '"';
  const headers = {
    "Cache-Control": "private, no-store",
    ETag: etag,
    "Content-Type": "application/json",
  };
  return request.headers.get("If-None-Match") === etag
    ? new Response(null, { status: 304, headers })
    : new Response(body, { headers });
}
