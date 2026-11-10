"use client";

import { useCallback, useEffect, useState } from "react";
import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import { normalizeStructTag } from "@mysten/sui/utils";

export type Level = "safe" | "low" | "medium" | "high" | "critical";
export type Signal = { level: Level; text: string; source: "memory" | "chain" };

export const LEVEL: Record<Level, { label: string; cls: string; advice: string }> = {
  safe: { label: "Trusted", cls: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40", advice: "Your memory trusts this." },
  low: { label: "Low risk", cls: "bg-sky-500/15 text-sky-300 ring-sky-500/40", advice: "Nothing alarming found." },
  medium: { label: "Caution", cls: "bg-amber-500/15 text-amber-300 ring-amber-500/40", advice: "Consider a small test first." },
  high: { label: "High risk", cls: "bg-orange-500/15 text-orange-300 ring-orange-500/40", advice: "Don't continue unless you're certain." },
  critical: { label: "Stop", cls: "bg-rose-500/15 text-rose-300 ring-rose-500/50", advice: "Your memory says no. Do not continue." },
};

export const SUI_TYPE = normalizeStructTag("0x2::sui::SUI");

export const POPULAR = [
  { symbol: "SUI", type: "0x2::sui::SUI", decimals: 9 },
  { symbol: "USDC", type: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC", decimals: 6 },
  { symbol: "WAL", type: "0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL", decimals: 9 },
  { symbol: "DEEP", type: "0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP", decimals: 6 },
  { symbol: "NS", type: "0x5145494a5f5100e645e4b0aa950fa6b68f614e8c59e17bc5ded3495123a79178::ns::NS", decimals: 6 },
  { symbol: "CETUS", type: "0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS", decimals: 9 },
].map((t) => ({ ...t, type: normalizeStructTag(t.type) }));

export type Token = { type: string; symbol: string; decimals: number; balance: bigint };

export const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;
export const suiscanTx = (d: string) => `https://suiscan.xyz/mainnet/tx/${d}`;
export const walruscan = (id: string) => `https://walruscan.com/mainnet/blob/${id}`;

export function toRaw(amount: string, decimals: number): bigint | null {
  const m = /^(\d*)(?:\.(\d*))?$/.exec(amount.trim());
  if (!m || (!m[1] && !m[2])) return null;
  const frac = (m[2] ?? "").slice(0, decimals).padEnd(decimals, "0");
  return BigInt((m[1] || "0") + frac);
}

export function fromRaw(raw: bigint | string, decimals: number, max = 4) {
  const v = BigInt(raw);
  const neg = v < BigInt(0);
  const abs = neg ? -v : v;
  const base = BigInt(10) ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").slice(0, max).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toLocaleString()}${frac ? "." + frac : ""}`;
}

const metaCache = new Map<string, { symbol: string; decimals: number }>();

/** Wallet balances (read via Tatum) with symbol/decimals. */
export function useTokens() {
  const account = useCurrentAccount();
  const client = useCurrentClient();
  const [tokens, setTokens] = useState<Token[] | null>(null);

  const load = useCallback(async () => {
    if (!account) return setTokens(null);
    const { balances } = await client.listBalances({ owner: account.address, limit: 50 });
    const out: Token[] = [];
    for (const b of balances) {
      const type = normalizeStructTag(b.coinType);
      if (BigInt(b.balance) === BigInt(0)) continue;
      let meta = metaCache.get(type) ?? POPULAR.find((p) => p.type === type);
      if (!meta) {
        const r = await client.getCoinMetadata({ coinType: type }).catch(() => null);
        meta = { symbol: r?.coinMetadata?.symbol ?? type.split("::").pop()!, decimals: r?.coinMetadata?.decimals ?? 9 };
        metaCache.set(type, meta);
      }
      out.push({ type, symbol: meta.symbol, decimals: meta.decimals, balance: BigInt(b.balance) });
    }
    out.sort((a, b) => (a.type === SUI_TYPE ? -1 : b.type === SUI_TYPE ? 1 : a.symbol.localeCompare(b.symbol)));
    setTokens(out);
  }, [account, client]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch balances when the account changes
    load().catch(() => setTokens([]));
  }, [load]);

  return { tokens, reload: load };
}

export function decimalsFor(type: string, tokens: Token[] | null) {
  const t = normalizeStructTag(type);
  return (
    tokens?.find((x) => x.type === t) ?? POPULAR.find((p) => p.type === t) ?? metaCache.get(t) ?? { symbol: t.split("::").pop()!, decimals: 9 }
  );
}

export function GuardPanel({ level, signals, title }: { level: Level; signals: Signal[]; title: string }) {
  const lv = LEVEL[level];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${lv.cls}`}>{lv.label}</span>
        <span className="text-sm text-zinc-300">{title}</span>
      </div>
      <ul className="space-y-1.5">
        {signals.map((s, i) => (
          <li key={i} className="flex gap-2 text-sm">
            <span
              className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                s.source === "memory" ? "bg-violet-500/20 text-violet-300" : "bg-zinc-500/20 text-zinc-300"
              }`}
            >
              {s.source === "memory" ? "Walrus" : "Tatum"}
            </span>
            <span className="text-zinc-300">{s.text}</span>
          </li>
        ))}
        {signals.length === 0 && <li className="text-sm text-zinc-500">No warnings.</li>}
      </ul>
    </div>
  );
}

export type BalanceChange = { coinType: string; address: string; amount: string };

export function SimulationPanel({
  changes,
  me,
  tokens,
  gasMocked,
}: {
  changes: BalanceChange[];
  me: string;
  tokens: Token[] | null;
  gasMocked?: boolean;
}) {
  const mine = changes.filter((c) => c.address.toLowerCase() === me.toLowerCase());
  return (
    <div className="space-y-1.5">
      <p className="text-xs uppercase tracking-wider text-zinc-500">Simulated by Tatum · what happens to your wallet</p>
      {mine.length === 0 && <p className="text-sm text-zinc-500">No balance changes for your wallet.</p>}
      {mine.map((c, i) => {
        const m = decimalsFor(c.coinType, tokens);
        const neg = c.amount.startsWith("-");
        return (
          <div key={i} className="flex items-center justify-between rounded-lg bg-black/30 px-3 py-2 font-mono text-sm">
            <span className="text-zinc-400">{m.symbol}</span>
            <span className={neg ? "text-rose-300" : "text-emerald-300"}>
              {neg ? "" : "+"}
              {fromRaw(c.amount, m.decimals, 6)}
            </span>
          </div>
        );
      })}
      {gasMocked && <p className="text-xs text-zinc-500">Gas was estimated with a mock coin.</p>}
    </div>
  );
}
