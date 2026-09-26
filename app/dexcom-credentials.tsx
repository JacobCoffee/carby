"use client";
import { useEffect, useRef, useState } from "react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { DexcomRegion, PublicDexcomDefaults } from "@/lib/dexcom-defaults";

export type DexcomCredentials = {
  username: string;
  password: string;
  region: DexcomRegion;
  useConfiguredPassword: boolean;
};

/** Keeps typed credentials local so each keystroke re-renders this form, not the whole dashboard. */
export default function DexcomCredentialsForm({
  defaults,
  busy,
  connected,
  onConnect,
  onCancel,
}: {
  defaults: PublicDexcomDefaults | null;
  busy: boolean;
  connected: boolean;
  onConnect: (credentials: DexcomCredentials) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [username, setUsername] = useState(defaults?.username ?? ""),
    [password, setPassword] = useState(""),
    [region, setRegion] = useState<DexcomRegion>(defaults?.region ?? "us");
  const touched = useRef(false);
  // Server settings may arrive after mount; apply them once and never over a typed edit.
  useEffect(() => {
    if (!defaults || touched.current) return;
    setUsername((current) => current || defaults.username);
    setRegion(defaults.region);
  }, [defaults]);
  // The configured password covers the configured account only; editing either field drops it.
  const configuredPassword =
    !!defaults?.hasPassword && username.trim() === defaults.username && region === defaults.region;
  async function submit() {
    const connectedNow = await onConnect({
      username,
      password,
      region,
      // Only ever true for the configured account with the password box left blank.
      useConfiguredPassword: configuredPassword && !password,
    });
    if (connectedNow) setPassword("");
  }
  return (
    <>
      <label className="field">
        <span>Dexcom publisher username, email or phone</span>
        <input
          autoComplete="username"
          value={username}
          onChange={(e) => {
            touched.current = true;
            setUsername(e.target.value);
          }}
        />
      </label>
      <label className="field">
        <span>Dexcom password</span>
        <input
          type="password"
          autoComplete="current-password"
          placeholder={
            configuredPassword ? "Leave blank to use the configured password" : undefined
          }
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {defaults?.hasPassword && (
        <p className="helper">
          {configuredPassword
            ? "The server holds a password for this account. Leave the box blank to use it, or type one to override it."
            : "The configured password belongs to a different username or region. Enter the password for this account."}
        </p>
      )}
      <label className="field">
        <span>Dexcom region</span>
        <Select
          value={region}
          onValueChange={(value) => {
            touched.current = true;
            setRegion(value as DexcomRegion);
          }}
        >
          <SelectTrigger className="choice" aria-label="Dexcom region">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["us", "ous", "jp"] as const).map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <button
        className="button primary full"
        disabled={busy || !username || (!password && !configuredPassword)}
        onClick={() => void submit()}
      >
        {busy
          ? "Connecting…"
          : connected
            ? "Verify and replace account"
            : "Connect and pull readings"}
      </button>
      {onCancel && (
        <button className="text-button" onClick={onCancel}>
          Cancel
        </button>
      )}
    </>
  );
}
