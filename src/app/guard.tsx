"use client";

import { useCallback, useEffect, useState } from "react";
import { GuardPanel, LEVEL, fromRaw, short, suiscanTx, walruscan } from "./shared";
import { AddressAvatar, checkName, useAddressCheck, type AddressCheck } from "./recipient";
import { TokenLogo } from "./tokens";

type VerdictMemory = { kind?: "address" | "token"; address: string; verdict: "trust" | "block"; reason: string; label?: string; at: string; blobId: string };
type SendMemory = { to: string; amount: string; symbol: string; at: string; digest: string };

const fmtDate = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleDateString() : "—");
const suiscan = (a: string) => `https://suiscan.xyz/mainnet/account/${a}`;

export type GuardAction = "send" | "swap";

export default function Guard({
  panel,
  onAction,
}: {
  panel?: React.ReactNode;
  onAction?: (action: GuardAction, address: string) => void;
}) {
  const [memory, setMemory] = useState<VerdictMemory[] | null>(null);
  const [sends, setSends] = useState<SendMemory[]>([]);
  const [memError, setMemError] = useState<string | null>(null);
  const [addr, setAddr] = useState("");

  const loadMemory = useCallback(async () => {
    const r = await fetch("/api/memory").then((r) => r.json()).catch((e) => ({ error: String(e), latest: [] }));
    setMemory(r.latest ?? []);
    setSends(r.sends ?? []);
    setMemError(r.error ?? null);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial recall from Walrus
    loadMemory();
    const onUpdate = () => loadMemory();
    window.addEventListener("memory-updated", onUpdate);
    return () => window.removeEventListener("memory-updated", onUpdate);
  }, [loadMemory]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <section className="min-w-0">{panel ?? <CheckPanel addr={addr} setAddr={setAddr} onAction={onAction} />}</section>

      <aside className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 lg:self-start">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-medium">Your memory</h2>
          <button onClick={loadMemory} className="text-xs text-zinc-400 hover:text-zinc-200">
            Refresh
          </button>
        </div>
        <p className="mb-3 text-xs text-zinc-500">Recalled live from Walrus Memory. Clear your browser and it&apos;s still here.</p>
        {memError && <p className="text-xs text-amber-300/80">{memError}</p>}
        {memory === null && <p className="animate-pulse text-sm text-zinc-500">Recalling…</p>}
        {memory?.length === 0 && !memError && <p className="text-sm text-zinc-500">No verdicts yet.</p>}
        <ul className="space-y-2">
          {memory?.map((m) => (
            <li key={`${m.kind}:${m.address}`}>
              <button
                onClick={() => {
                  if (m.kind === "token") return;
                  if (panel) onAction?.("send", m.address);
                  else setAddr(m.address);
                }}
                className="flex w-full items-center gap-3 rounded-2xl border border-white/5 bg-black/30 p-3 text-left hover:border-white/20"
              >
                {m.kind === "token" ? (
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-[10px] uppercase text-zinc-300">tok</span>
                ) : (
                  <AddressAvatar address={m.address} size={32} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm">{m.label || (m.kind === "token" ? m.address.split("::").pop() : short(m.address))}</span>
                    <span className={`shrink-0 text-xs ${m.verdict === "trust" ? "text-emerald-400" : "text-rose-400"}`}>
                      {m.verdict === "trust" ? "trusted" : "blocked"}
                    </span>
                  </div>
                  {m.reason && <p className="truncate text-xs text-zinc-500">{m.reason}</p>}
                </div>
              </button>
            </li>
          ))}
        </ul>
        {sends.length > 0 && (
          <>
            <h3 className="mb-2 mt-4 text-xs uppercase tracking-wider text-zinc-500">Recent sends</h3>
            <ul className="space-y-1.5">
              {sends.slice(0, 5).map((s) => (
                <li key={s.digest} className="flex items-center gap-2 text-xs text-zinc-400">
                  <AddressAvatar address={s.to} size={18} />
                  <span className="font-mono text-zinc-300">
                    {s.amount} {s.symbol}
                  </span>
                  <span className="truncate">→ {short(s.to)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
    </div>
  );
}

function CheckPanel({
  addr,
  setAddr,
  onAction,
}: {
  addr: string;
  setAddr: (v: string) => void;
  onAction?: (action: GuardAction, address: string) => void;
}) {
  const [refresh, setRefresh] = useState(0);
  const { address, valid, check, loading, error } = useAddressCheck(addr, refresh);
  const [mode, setMode] = useState<null | "trust" | "block">(null);
  const [label, setLabel] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ blobId: string; verdict: string } | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the action form for a new address
    setMode(null);
    setSaved(null);
    setSaveErr(null);
    setReason("");
  }, [address]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prefill the label from memory/SuiNS
    if (check) setLabel(check.memory.own?.label ?? check.profile?.suinsName ?? "");
  }, [check]);

  async function save() {
    if (!mode) return;
    setSaving(true);
    setSaveErr(null);
    try {
      const r = await fetch("/api/verdict", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address,
          verdict: mode,
          reason,
          label,
          signals: check?.signals.filter((s) => s.source === "chain").map((s) => s.text),
        }),
      }).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      setSaved({ blobId: r.blobId, verdict: mode });
      setMode(null);
      setRefresh((n) => n + 1);
      window.dispatchEvent(new Event("memory-updated"));
    } catch (e) {
      setSaveErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const name = checkName(check);
  const lv = check ? LEVEL[check.level] : null;
  const p = check?.profile;

  return (
    <div className="mx-auto w-full max-w-[560px] space-y-3">
      <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-2 shadow-[0_0_60px_-20px_rgba(139,92,246,0.35)]">
        <div className="px-3 pb-2 pt-1">
          <div className="font-medium">Check an address</div>
          <p className="text-xs text-zinc-500">Paste any Sui address. It&apos;s scanned instantly against your memory and its onchain history.</p>
        </div>
        <div className="rounded-2xl border border-white/5 bg-black/30 p-4">
          <div className="flex items-center gap-3">
            {valid ? <AddressAvatar address={address} size={40} /> : <span className="h-10 w-10 shrink-0 rounded-full border border-dashed border-white/15" />}
            <input
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              autoFocus
              placeholder="Paste a Sui address (0x…)"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent font-mono text-base outline-none placeholder:text-zinc-600 sm:text-sm"
            />
            {addr && (
              <button onClick={() => setAddr("")} className="text-zinc-500 hover:text-white" aria-label="Clear">
                ✕
              </button>
            )}
          </div>
          {addr && !valid && <p className="mt-2 text-xs text-amber-300">A Sui address is 0x followed by 64 hex characters.</p>}
        </div>
      </div>

      {valid && loading && !check && (
        <div className="space-y-3 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <div className="h-5 w-40 animate-pulse rounded bg-white/10" />
          <div className="h-4 w-full animate-pulse rounded bg-white/5" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-white/5" />
          <p className="text-xs text-zinc-500">Scanning Walrus memory and Sui Mainnet via Tatum…</p>
        </div>
      )}
      {error && <p className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}

      {check && lv && (
        <div className="space-y-5 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-center gap-4">
            <AddressAvatar address={address} size={52} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-semibold">{name ?? short(address)}</span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${lv.cls}`}>{lv.label}</span>
              </div>
              <a href={suiscan(address)} target="_blank" className="block truncate font-mono text-xs text-zinc-500 hover:text-zinc-300">
                {address} ↗
              </a>
            </div>
          </div>

          <p className="text-zinc-300">{lv.advice}</p>
          <GuardPanel level={check.level} signals={check.signals} title="What we found" />

          {p && (
            <dl className="grid grid-cols-2 gap-3 rounded-2xl bg-black/30 p-4 text-sm sm:grid-cols-4">
              <Stat k="Sent txs" v={`${p.sentCount}${p.sentMore ? "+" : ""}`} />
              <Stat k="Received" v={`${p.receivedCount}${p.receivedMore ? "+" : ""}`} />
              <Stat k="First seen" v={fmtDate(p.firstSeenMs)} />
              <Stat k="SUI balance" v={p.suiBalance.toLocaleString(undefined, { maximumFractionDigits: 3 })} />
            </dl>
          )}
          {check.activity && check.activity.length > 0 && <Activity check={check} />}

          {check.memory.sends.length > 0 && (
            <p className="text-xs text-zinc-400">
              Last send from you: {check.memory.sends[0].amount} {check.memory.sends[0].symbol} on {check.memory.sends[0].at.slice(0, 10)}
            </p>
          )}

          <div className="border-t border-white/10 pt-4">
            <p className="mb-3 font-medium">What do you want to do next?</p>
            <div className="grid grid-cols-2 gap-2">
              <ActionBtn
                icon="↗"
                title="Send tokens"
                sub="to this address"
                tone={check.level === "critical" ? "danger" : "primary"}
                onClick={() => onAction?.("send", address)}
              />
              <ActionBtn icon="⇄" title="Swap & send" sub="deliver another token here" tone="neutral" onClick={() => onAction?.("swap", address)} />
              <ActionBtn
                icon="✓"
                title={check.memory.own?.verdict === "trust" ? "Update trust" : "Trust"}
                sub="remember as safe"
                tone="good"
                active={mode === "trust"}
                onClick={() => setMode(mode === "trust" ? null : "trust")}
              />
              <ActionBtn
                icon="⛔"
                title={check.memory.own?.verdict === "block" ? "Update block" : "Block"}
                sub="never send here"
                tone="bad"
                active={mode === "block"}
                onClick={() => setMode(mode === "block" ? null : "block")}
              />
            </div>

            {mode && (
              <div className="mt-3 space-y-2 rounded-2xl bg-black/30 p-3">
                <div className="grid gap-2 sm:grid-cols-[150px_1fr]">
                  <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Binance)" className="input" />
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={mode === "trust" ? "Why? (e.g. my exchange deposit)" : "Why? (e.g. scam DM on Telegram)"}
                    className="input"
                    onKeyDown={(e) => e.key === "Enter" && save()}
                  />
                </div>
                <button onClick={save} disabled={saving} className={`${mode === "block" ? "btn-danger" : "btn-primary"} w-full`}>
                  {saving ? "Writing to Walrus Mainnet…" : mode === "trust" ? "Save as trusted" : "Block this address"}
                </button>
                {saveErr && <p className="text-xs text-rose-300">{saveErr}</p>}
              </div>
            )}
            {saved && (
              <p className="mt-3 text-sm text-emerald-300">
                {saved.verdict === "trust" ? "Trusted" : "Blocked"}. Saved to Walrus Mainnet{" "}
                <a className="underline" href={walruscan(saved.blobId)} target="_blank">
                  ↗
                </a>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ago(ms: number | null) {
  if (!ms) return "";
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

const KIND = {
  sent: { icon: "↗", label: "Sent", cls: "bg-rose-500/15 text-rose-300" },
  received: { icon: "↙", label: "Received", cls: "bg-emerald-500/15 text-emerald-300" },
  swap: { icon: "⇄", label: "Swapped", cls: "bg-sky-500/15 text-sky-300" },
  call: { icon: "◆", label: "App interaction", cls: "bg-violet-500/15 text-violet-300" },
} as const;

function Activity({ check }: { check: AddressCheck }) {
  const meta = check.coinMeta ?? {};
  const fmt = (c: { coinType: string; amount: string }) => {
    const m = meta[c.coinType] ?? { symbol: c.coinType.split("::").pop()!, decimals: 9, iconUrl: null };
    const neg = c.amount.startsWith("-");
    return { m, neg, text: `${neg ? "−" : "+"}${fromRaw(c.amount.replace("-", ""), m.decimals, 4)} ${m.symbol}` };
  };
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider text-zinc-500">Recent wallet activity · via Tatum</p>
        <span className="text-[10px] text-zinc-600">last {check.activity!.length} txs</span>
      </div>
      <ul className="divide-y divide-white/5 overflow-hidden rounded-2xl bg-black/30">
        {check.activity!.map((a) => {
          const k = KIND[a.kind];
          const outs = a.changes.filter((c) => c.amount.startsWith("-")).map(fmt);
          const ins = a.changes.filter((c) => !c.amount.startsWith("-")).map(fmt);
          const title =
            a.kind === "swap"
              ? `${outs.map((o) => o.m.symbol).join(", ")} → ${ins.map((i) => i.m.symbol).join(", ")}`
              : a.kind === "sent" && a.counterparty
                ? `to ${short(a.counterparty)}`
                : a.kind === "received" && a.counterparty
                  ? `from ${short(a.counterparty)}`
                  : "Smart contract call";
          const lead = (ins[0] ?? outs[0])?.m;
          return (
            <li key={a.digest}>
              <a href={suiscanTx(a.digest)} target="_blank" className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-white/[0.04]">
                <span className="relative shrink-0">
                  {lead ? <TokenLogo symbol={lead.symbol} iconUrl={lead.iconUrl} type={undefined} size={30} /> : <span className="block h-[30px] w-[30px]" />}
                  <span className={`absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full text-[9px] ring-2 ring-[#0b0d12] ${k.cls}`}>{k.icon}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">
                    {k.label} <span className="text-zinc-400">{title}</span>
                    {!a.ok && <span className="ml-1 text-xs text-rose-400">failed</span>}
                  </span>
                  <span className="block text-xs text-zinc-500">{ago(a.timestampMs)}</span>
                </span>
                <span className="shrink-0 text-right font-mono text-xs">
                  {[...ins, ...outs].slice(0, 2).map((x, i) => (
                    <span key={i} className={`block ${x.neg ? "text-zinc-400" : "text-emerald-300"}`}>
                      {x.text}
                    </span>
                  ))}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ActionBtn({
  icon,
  title,
  sub,
  tone,
  active,
  onClick,
}: {
  icon: string;
  title: string;
  sub: string;
  tone: "primary" | "neutral" | "good" | "bad" | "danger";
  active?: boolean;
  onClick: () => void;
}) {
  const tones = {
    primary: "border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200",
    neutral: "border-white/10 bg-white/[0.04] hover:bg-white/10 text-zinc-200",
    good: "border-emerald-500/30 hover:bg-emerald-500/10 text-emerald-300",
    bad: "border-rose-500/30 hover:bg-rose-500/10 text-rose-300",
    danger: "border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 text-rose-200",
  };
  return (
    <button onClick={onClick} className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition ${tones[tone]} ${active ? "ring-2 ring-white/30" : ""}`}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-black/30 text-base">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block truncate text-xs opacity-70">{sub}</span>
      </span>
    </button>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{k}</dt>
      <dd className="font-mono">{v}</dd>
    </div>
  );
}
