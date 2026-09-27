"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";

export default function InviteAccept({ token, name }: { token: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function accept() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", token }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not join. Please retry.");
      window.location.assign("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not join. Please retry.");
      setBusy(false);
    }
  }
  return (
    <>
      <div className="invite-actions">
        <button
          type="button"
          className="button primary"
          disabled={busy}
          onClick={() => void accept()}
        >
          {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
          {busy ? "Joining…" : `Join ${name}’s care`}
        </button>
      </div>
      {error && (
        <p className="notice danger" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
