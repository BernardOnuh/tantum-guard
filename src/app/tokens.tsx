"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeStructTag } from "@mysten/sui/utils";
import { SUI_TYPE, fromRaw, type Token } from "./shared";

export type ListedToken = {
  type: string;
  symbol: string;
  name: string;
  decimals: number;
  iconUrl: string | null;
  price: number | null;
  verified: boolean;
};

let listPromise: Promise<ListedToken[]> | null = null;
const loadList = () =>
  (listPromise ??= fetch("/api/tokens")
    .then((r) => r.json())
    .then((j) => (j.tokens ?? []) as ListedToken[])
    .catch(() => ((listPromise = null), [] as ListedToken[])));

/** Verified Sui tokens with logos and USD prices (cached for the session). */
export function useTokenList() {
  const [list, setList] = useState<ListedToken[] | null>(null);
  useEffect(() => {
    let live = true;
    loadList().then((l) => live && setList(l));
    return () => {
      live = false;
    };
  }, []);
  const byType = useMemo(() => new Map((list ?? []).map((t) => [t.type, t])), [list]);
  return { list, byType };
}

const PALETTE = ["#10b981", "#8b5cf6", "#f59e0b", "#3b82f6", "#ec4899", "#14b8a6", "#f97316"];

export function TokenLogo({ type, iconUrl, symbol, size = 28 }: { type?: string; iconUrl?: string | null; symbol: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  const src = type === SUI_TYPE ? "/tokens/sui.svg" : iconUrl;
  if (src && !broken)
    return (
      // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote token icons
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        onError={() => setBroken(true)}
        className="shrink-0 rounded-full bg-white/5 object-cover ring-1 ring-white/10"
        style={{ width: size, height: size }}
      />
    );
  const color = PALETTE[[...symbol].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-semibold text-white ring-1 ring-white/10"
      style={{ width: size, height: size, background: color, fontSize: size * 0.42 }}
    >
      {symbol.replace(/[^A-Za-z0-9]/g, "").slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}

export function TokenPill({ token, onClick }: { token: { type: string; symbol: string; iconUrl?: string | null } | null; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] py-1.5 pl-1.5 pr-3 text-sm font-medium transition hover:bg-white/10"
    >
      {token ? (
        <>
          <TokenLogo type={token.type} iconUrl={token.iconUrl} symbol={token.symbol} size={26} />
          <span className="max-w-[90px] truncate">{token.symbol}</span>
        </>
      ) : (
        <span className="pl-2">Select token</span>
      )}
      <svg width="12" height="12" viewBox="0 0 12 12" className="text-zinc-400">
        <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </svg>
    </button>
  );
}

export type PickedToken = { type: string; symbol: string; decimals: number; iconUrl: string | null; price: number | null };

export function usd(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return null;
  if (n === 0) return "$0";
  if (n < 0.01) return "<$0.01";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: n < 1000 ? 2 : 0 });
}

/**
 * Token search modal: your wallet tokens first, popular chips, then all verified tokens.
 * Paste any coin type to pick an unlisted token (it gets a full Tatum + memory check on review).
 */
export function TokenPicker({
  open,
  onClose,
  onPick,
  wallet,
  list,
  exclude,
  walletOnly,
  title = "Select a token",
}: {
  open: boolean;
  onClose: () => void;
  onPick: (t: PickedToken) => void;
  wallet: Token[] | null;
  list: ListedToken[] | null;
  exclude?: string;
  walletOnly?: boolean;
  title?: string;
}) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => (clearTimeout(t), window.removeEventListener("keydown", onKey));
  }, [open, onClose]);

  const byType = useMemo(() => new Map((list ?? []).map((t) => [t.type, t])), [list]);
  const query = q.trim().toLowerCase();

  const pasted = useMemo(() => {
    if (!/^0x[0-9a-f]+::\w+::\w+$/i.test(q.trim())) return null;
    try {
      return normalizeStructTag(q.trim());
    } catch {
      return null;
    }
  }, [q]);

  const match = (t: { symbol: string; name?: string; type: string }) =>
    !query || t.symbol.toLowerCase().includes(query) || (t.name ?? "").toLowerCase().includes(query) || t.type.toLowerCase() === query;

  const mine = (wallet ?? [])
    .filter((t) => t.type !== exclude)
    .map((t) => ({ ...t, name: byType.get(t.type)?.name ?? t.symbol, iconUrl: byType.get(t.type)?.iconUrl ?? null, price: byType.get(t.type)?.price ?? null }))
    .filter(match);
  const mineTypes = new Set(mine.map((t) => t.type));
  const others = walletOnly ? [] : (list ?? []).filter((t) => t.type !== exclude && !mineTypes.has(t.type) && match(t)).slice(0, 80);
  const chips = walletOnly ? [] : (list ?? []).slice(0, 6).filter((t) => t.type !== exclude);

  if (!open) return null;

  const pick = (t: PickedToken) => {
    onPick(t);
    setQ("");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-[#0d0f14] shadow-2xl sm:rounded-3xl"
      >
        <div className="space-y-3 border-b border-white/10 p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{title}</h3>
            <button onClick={onClose} className="rounded-full p-1 text-zinc-400 hover:bg-white/10 hover:text-white" aria-label="Close">
              ✕
            </button>
          </div>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" />
              <path d="m11 11 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={walletOnly ? "Search your tokens" : "Search name or paste coin type"}
              spellCheck={false}
              className="input pl-9"
            />
          </div>
          {chips.length > 0 && !query && (
            <div className="flex flex-wrap gap-2">
              {chips.map((t) => (
                <button
                  key={t.type}
                  onClick={() => pick(t)}
                  className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-1 pr-2.5 text-sm hover:bg-white/10"
                >
                  <TokenLogo type={t.type} iconUrl={t.iconUrl} symbol={t.symbol} size={20} />
                  {t.symbol}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {pasted && !byType.has(pasted) && !mineTypes.has(pasted) && (
            <Row
              t={{ type: pasted, symbol: pasted.split("::").pop()!, name: "Unlisted token, checked on review", iconUrl: null, price: null }}
              badge={<span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase text-amber-300">unverified</span>}
              onClick={() => pick({ type: pasted, symbol: pasted.split("::").pop()!, decimals: 9, iconUrl: null, price: null })}
            />
          )}

          {mine.length > 0 && <SectionLabel>Your tokens</SectionLabel>}
          {mine.map((t) => (
            <Row
              key={t.type}
              t={t}
              right={
                <div className="text-right">
                  <div className="font-mono text-sm">{fromRaw(t.balance, t.decimals)}</div>
                  {t.price != null && <div className="text-xs text-zinc-500">{usd((Number(t.balance) / 10 ** t.decimals) * t.price)}</div>}
                </div>
              }
              onClick={() => pick({ type: t.type, symbol: t.symbol, decimals: t.decimals, iconUrl: t.iconUrl, price: t.price })}
            />
          ))}

          {others.length > 0 && <SectionLabel>{query ? "Results" : "Verified tokens"}</SectionLabel>}
          {others.map((t) => (
            <Row
              key={t.type}
              t={t}
              right={t.price != null ? <span className="text-xs text-zinc-500">{usd(t.price)}</span> : null}
              onClick={() => pick(t)}
            />
          ))}

          {list === null && !walletOnly && <p className="p-6 text-center text-sm text-zinc-500">Loading tokens…</p>}
          {list !== null && mine.length === 0 && others.length === 0 && !pasted && (
            <p className="p-6 text-center text-sm text-zinc-500">
              {walletOnly ? "No matching tokens in your wallet." : "No match. Paste the full coin type (0x…::module::SYMBOL)."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="px-3 pb-1 pt-3 text-xs uppercase tracking-wider text-zinc-500">{children}</p>;
}

function Row({
  t,
  right,
  badge,
  onClick,
}: {
  t: { type: string; symbol: string; name?: string; iconUrl?: string | null; price?: number | null };
  right?: React.ReactNode;
  badge?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-white/[0.06]">
      <TokenLogo type={t.type} iconUrl={t.iconUrl} symbol={t.symbol} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{t.symbol}</span>
          {badge}
        </div>
        <div className="truncate text-xs text-zinc-500">{t.name}</div>
      </div>
      {right}
    </button>
  );
}
