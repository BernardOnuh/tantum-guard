"use client";
/* eslint-disable react-hooks/set-state-in-effect -- the check resets/refreshes when the address changes */

import { useEffect, useState } from "react";
import { LEVEL, type Level, type Signal } from "./shared";

export type AddressCheck = {
  address: string;
  level: Level;
  signals: Signal[];
  profile: {
    suinsName: string | null;
    sentCount: number;
    sentMore: boolean;
    receivedCount: number;
    receivedMore: boolean;
    firstSeenMs: number | null;
    lastActiveMs: number | null;
    suiBalance: number;
    isPackageOrObject: boolean;
  } | null;
  memory: {
    own: { verdict: "trust" | "block"; label?: string; reason: string; at: string } | null;
    lookalike: { label?: string; address: string } | null;
    sends: { amount: string; symbol: string; at: string }[];
  };
  errors?: { chain: string | null; memory: string | null };
};

export const isAddr = (s: string) => /^0x[0-9a-f]{64}$/.test(s.trim().toLowerCase());

/** Scans an address (Tatum chain history + Walrus memory) as soon as it's complete. */
export function useAddressCheck(raw: string, refreshKey = 0) {
  const address = raw.trim().toLowerCase();
  const valid = isAddr(address);
  const [check, setCheck] = useState<AddressCheck | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    if (!valid) {
      setCheck(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch("/api/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }) }).then((r) => r.json());
        if (cancelled) return;
        if (r.error) setError(r.error);
        else setCheck(r);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [address, valid, refreshKey]);

  return { address, valid, check: check?.address === address ? check : null, loading, error };
}

/** Deterministic gradient avatar so lookalike addresses look visibly different. */
export function AddressAvatar({ address, size = 36 }: { address: string; size?: number }) {
  const h = address.replace(/^0x/, "");
  return (
    <span
      className="shrink-0 rounded-full ring-1 ring-white/15"
      style={{ width: size, height: size, background: `conic-gradient(from 45deg, #${h.slice(0, 6)}, #${h.slice(28, 34)}, #${h.slice(-6)}, #${h.slice(0, 6)})` }}
    />
  );
}

export function checkName(c: AddressCheck | null) {
  return c?.memory.own?.label ?? c?.profile?.suinsName ?? null;
}

/** Address input with avatar and an inline scan result. */
export function RecipientField({
  value,
  onChange,
  label = "To",
  autoFocus,
  state,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  autoFocus?: boolean;
  state: ReturnType<typeof useAddressCheck>;
}) {
  const { address, valid, check, loading } = state;
  const name = checkName(check);
  return (
    <div className="rounded-2xl border border-white/5 bg-black/30 p-4">
      <div className="mb-2 text-xs text-zinc-400">{label}</div>
      <div className="flex items-center gap-3">
        {valid ? <AddressAvatar address={address} /> : <span className="h-9 w-9 shrink-0 rounded-full border border-dashed border-white/15" />}
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
          placeholder="Paste a Sui address (0x…)"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-zinc-600"
        />
        {value && (
          <button onClick={() => onChange("")} className="text-zinc-500 hover:text-white" aria-label="Clear">
            ✕
          </button>
        )}
      </div>
      {value && !valid && <p className="mt-2 text-xs text-amber-300">A Sui address is 0x followed by 64 hex characters.</p>}
      {valid && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/5 pt-3 text-xs">
          {loading && !check ? (
            <span className="animate-pulse text-zinc-500">Scanning memory + chain…</span>
          ) : check ? (
            <>
              <span className={`rounded-full px-2 py-0.5 font-semibold ring-1 ${LEVEL[check.level].cls}`}>{LEVEL[check.level].label}</span>
              {name && <span className="text-zinc-200">{name}</span>}
              <span className="text-zinc-500">{check.signals[0]?.text}</span>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
