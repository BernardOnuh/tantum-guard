"use client";

import { useCallback, useEffect, useState } from "react";

type Level = "safe" | "low" | "medium" | "high" | "critical";
type Signal = { level: Level; text: string; source: "memory" | "chain" };
type VerdictMemory = { address: string; verdict: "trust" | "block"; reason: string; label?: string; at: string; blobId: string };
type CheckResult = {
  address: string;
  level: Level;
  signals: Signal[];
  profile: {
    sentCount: number;
    sentMore: boolean;
    receivedCount: number;
    receivedMore: boolean;
    firstSeenMs: number | null;
    lastActiveMs: number | null;
    suiBalance: number;
    coinTypes: number;
  } | null;
  memory: { own: VerdictMemory | null; lookalike: VerdictMemory | null };
  errors: { chain: string | null; memory: string | null };
};

const LEVEL: Record<Level, { label: string; cls: string; advice: string }> = {
  safe: { label: "Trusted", cls: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40", advice: "You've trusted this recipient before." },
  low: { label: "Low risk", cls: "bg-sky-500/15 text-sky-300 ring-sky-500/40", advice: "Nothing alarming found. Double-check the full address." },
  medium: { label: "Caution", cls: "bg-amber-500/15 text-amber-300 ring-amber-500/40", advice: "Send a small test amount first." },
  high: { label: "High risk", cls: "bg-orange-500/15 text-orange-300 ring-orange-500/40", advice: "Don't send unless you're certain." },
  critical: { label: "Stop", cls: "bg-rose-500/15 text-rose-300 ring-rose-500/50", advice: "Your own memory says no. Do not send." },
};

const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;
const fmtDate = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString() : "—");
const walruscan = (id: string) => `https://walruscan.com/mainnet/blob/${id}`;
const suiscan = (a: string) => `https://suiscan.xyz/mainnet/account/${a}`;

export default function Guard() {
  const [address, setAddress] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState<null | "trust" | "block">(null);
  const [saved, setSaved] = useState<{ blobId: string; verdict: string } | null>(null);
  const [memory, setMemory] = useState<VerdictMemory[] | null>(null);
  const [memError, setMemError] = useState<string | null>(null);

  const loadMemory = useCallback(async () => {
    const r = await fetch("/api/memory").then((r) => r.json()).catch((e) => ({ error: String(e), latest: [] }));
    setMemory(r.latest ?? []);
    setMemError(r.error ?? null);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial recall from Walrus
    loadMemory();
  }, [loadMemory]);

  async function check(addr = address) {
    setChecking(true);
    setError(null);
    setSaved(null);
    setResult(null);
    try {
      const r = await fetch("/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: addr }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setResult(j);
      setLabel(j.memory.own?.label ?? "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }

  async function decide(verdict: "trust" | "block") {
    if (!result) return;
    setSaving(verdict);
    setError(null);
    try {
      const r = await fetch("/api/verdict", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: result.address,
          verdict,
          reason,
          label,
          signals: result.signals.filter((s) => s.source === "chain").map((s) => s.text),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setSaved({ blobId: j.blobId, verdict });
      setReason("");
      await loadMemory();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(null);
    }
  }

  const lv = result ? LEVEL[result.level] : null;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:py-14">
      <header className="mb-10">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-emerald-400">Tatum × Walrus Memory · Sui Mainnet</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">Tantum Guard</h1>
        <p className="mt-3 max-w-2xl text-zinc-400">
          A check you run before every send. It reads the recipient’s onchain history through Tatum and checks it against
          everything you’ve ever trusted or blocked, which it keeps in Walrus Memory. Memory catches the lookalike
          address that a block explorer won’t.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <section className="space-y-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              check();
            }}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
          >
            <label className="text-sm text-zinc-400" htmlFor="addr">
              Recipient address
            </label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                id="addr"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="0x… (Sui address you're about to send to)"
                spellCheck={false}
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 font-mono text-sm outline-none focus:border-emerald-500/60"
              />
              <button
                disabled={checking || !address.trim()}
                className="rounded-xl bg-emerald-500 px-5 py-2.5 font-medium text-black transition hover:bg-emerald-400 disabled:opacity-40"
              >
                {checking ? "Checking…" : "Check before sending"}
              </button>
            </div>
          </form>

          {error && <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}

          {result && lv && (
            <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className={`rounded-full px-3 py-1 text-sm font-semibold ring-1 ${lv.cls}`}>{lv.label}</span>
                <a href={suiscan(result.address)} target="_blank" className="font-mono text-sm text-zinc-400 hover:text-zinc-200">
                  {short(result.address)} ↗
                </a>
              </div>
              <p className="text-lg">{lv.advice}</p>

              <ul className="space-y-2">
                {result.signals.map((s, i) => (
                  <li key={i} className="flex gap-3 text-sm">
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
                {result.signals.length === 0 && <li className="text-sm text-zinc-500">No signals.</li>}
              </ul>

              {result.profile && (
                <dl className="grid grid-cols-2 gap-3 border-t border-white/10 pt-4 text-sm sm:grid-cols-4">
                  <Stat k="Sent txs" v={`${result.profile.sentCount}${result.profile.sentMore ? "+" : ""}`} />
                  <Stat k="Received txs" v={`${result.profile.receivedCount}${result.profile.receivedMore ? "+" : ""}`} />
                  <Stat k="First seen" v={fmtDate(result.profile.firstSeenMs)} />
                  <Stat k="SUI balance" v={result.profile.suiBalance.toLocaleString(undefined, { maximumFractionDigits: 3 })} />
                </dl>
              )}
              {(result.errors.chain || result.errors.memory) && (
                <p className="text-xs text-amber-300/80">
                  {result.errors.chain && `Tatum: ${result.errors.chain}. `}
                  {result.errors.memory && `Walrus Memory: ${result.errors.memory}`}
                </p>
              )}

              <div className="space-y-3 border-t border-white/10 pt-4">
                <p className="text-sm text-zinc-400">Teach the guard. Your verdict is written to Walrus Memory on Mainnet:</p>
                <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Label (e.g. Binance)"
                    className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-500/60"
                  />
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why? (e.g. my exchange deposit / scam DM on Telegram)"
                    className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-emerald-500/60"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => decide("trust")}
                    disabled={!!saving}
                    className="rounded-xl border border-emerald-500/40 px-4 py-2 text-sm text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40"
                  >
                    {saving === "trust" ? "Writing to Walrus…" : "✓ Trust this recipient"}
                  </button>
                  <button
                    onClick={() => decide("block")}
                    disabled={!!saving}
                    className="rounded-xl border border-rose-500/40 px-4 py-2 text-sm text-rose-300 hover:bg-rose-500/10 disabled:opacity-40"
                  >
                    {saving === "block" ? "Writing to Walrus…" : "⛔ Block forever"}
                  </button>
                </div>
                {saved && (
                  <p className="text-sm text-emerald-300">
                    Saved to Walrus Mainnet as blob{" "}
                    <a className="font-mono underline" href={walruscan(saved.blobId)} target="_blank">
                      {saved.blobId.slice(0, 14)}…
                    </a>
                  </p>
                )}
              </div>
            </div>
          )}
        </section>

        <aside className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 lg:self-start">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-medium">Your memory</h2>
            <button onClick={loadMemory} className="text-xs text-zinc-400 hover:text-zinc-200">
              Refresh
            </button>
          </div>
          <p className="mb-3 text-xs text-zinc-500">Recalled live from Walrus Memory. Clear your browser and it’s still here.</p>
          {memError && <p className="text-xs text-amber-300/80">{memError}</p>}
          {memory === null && <p className="text-sm text-zinc-500">Recalling…</p>}
          {memory?.length === 0 && !memError && <p className="text-sm text-zinc-500">No verdicts yet. Check an address and teach it.</p>}
          <ul className="space-y-2">
            {memory?.map((m) => (
              <li key={m.address}>
                <button
                  onClick={() => {
                    setAddress(m.address);
                    check(m.address);
                  }}
                  className="w-full rounded-xl border border-white/5 bg-black/30 p-3 text-left hover:border-white/20"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm">{m.label || short(m.address)}</span>
                    <span className={`text-xs ${m.verdict === "trust" ? "text-emerald-400" : "text-rose-400"}`}>
                      {m.verdict === "trust" ? "trusted" : "blocked"}
                    </span>
                  </div>
                  {m.reason && <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{m.reason}</p>}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
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
