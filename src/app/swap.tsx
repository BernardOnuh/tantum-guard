"use client";

import { useState } from "react";
import { useCurrentAccount, useCurrentClient, useDAppKit } from "@mysten/dapp-kit-react";
import { Transaction } from "@mysten/sui/transactions";
import { normalizeStructTag } from "@mysten/sui/utils";
import { ConnectHint, Field } from "./send";
import {
  GuardPanel, POPULAR, SUI_TYPE, SimulationPanel, fromRaw, suiscanTx, toRaw, useTokens, walruscan,
  type BalanceChange, type Level, type Signal,
} from "./shared";

type Quote = {
  amountOut: string;
  feePct: number;
  protocols: string[];
  slippage: number;
};

type Review = {
  coinIn: { type: string; symbol: string; decimals: number };
  coinOut: { type: string; symbol: string; decimals: number };
  amountRaw: bigint;
  quote: Quote;
  level: Level;
  signals: Signal[];
  changes: BalanceChange[];
  simError: string | null;
  tx: Transaction;
};

export default function Swap() {
  const account = useCurrentAccount();
  const client = useCurrentClient();
  const dAppKit = useDAppKit();
  const { tokens, reload } = useTokens();

  const [coinIn, setCoinIn] = useState(SUI_TYPE);
  const [coinOut, setCoinOut] = useState(POPULAR[1].type);
  const [custom, setCustom] = useState("");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(0.01);
  const [busy, setBusy] = useState<null | "review" | "swap" | "trust" | "block">(null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [override, setOverride] = useState(false);
  const [done, setDone] = useState<{ digest: string } | null>(null);
  const [saved, setSaved] = useState<{ verdict: string; blobId: string } | null>(null);

  const inTok = tokens?.find((t) => t.type === coinIn);
  const outType = coinOut === "custom" ? custom.trim() : coinOut;

  async function doReview() {
    if (!account || !inTok) return;
    setError(null);
    setReview(null);
    setDone(null);
    setSaved(null);
    setOverride(false);
    const raw = toRaw(amount, inTok.decimals);
    if (!raw || raw <= BigInt(0)) return setError("Enter an amount.");
    if (raw > inTok.balance) return setError(`You only have ${fromRaw(inTok.balance, inTok.decimals)} ${inTok.symbol}.`);
    let out: string;
    try {
      out = normalizeStructTag(outType);
    } catch {
      return setError("Enter a valid coin type, like 0x…::module::SYMBOL");
    }
    if (out === inTok.type) return setError("Pick two different tokens.");

    setBusy("review");
    try {
      const [check, quote] = await Promise.all([
        fetch("/api/token-check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coinType: out }) }).then((r) => r.json()),
        fetch("/api/swap/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ coinIn: inTok.type, coinOut: out, amountIn: raw.toString(), slippage, wallet: account.address }),
        }).then((r) => r.json()),
      ]);
      if (check.error) throw new Error(check.error);
      if (quote.error) throw new Error(quote.error);

      const tx = Transaction.from(quote.tx);
      let changes: BalanceChange[] = [];
      let simError: string | null = null;
      try {
        // Auto-estimated budgets for routed swaps are razor thin (storage rebates offset cost), so
        // they can fail with "Insufficient Gas". Use a 0.05 SUI ceiling when affordable; only actual gas is charged.
        const GAS_CEILING = BigInt(50_000_000);
        const suiBal = tokens?.find((t) => t.type === SUI_TYPE)?.balance ?? BigInt(0);
        const suiSpent = inTok.type === SUI_TYPE ? raw : BigInt(0);
        if (suiBal - suiSpent >= GAS_CEILING) tx.setGasBudget(GAS_CEILING);
        const bytes = await tx.build({ client });
        const sim = await client.simulateTransaction({ transaction: bytes, include: { balanceChanges: true } });
        const t = sim.Transaction ?? sim.FailedTransaction;
        changes = (t?.balanceChanges ?? []) as BalanceChange[];
        if (t && !t.status.success) simError = String(t.status.error?.message ?? "Simulation failed");
      } catch (e) {
        simError = (e as Error).message;
      }

      const outMeta = {
        type: out,
        symbol: check.token?.symbol ?? out.split("::").pop()!,
        decimals: check.token?.decimals ?? 9,
      };
      setReview({ coinIn: inTok, coinOut: outMeta, amountRaw: raw, quote, level: check.level, signals: check.signals, changes, simError, tx });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function doSwap() {
    if (!review) return;
    setBusy("swap");
    setError(null);
    try {
      const res = await dAppKit.signAndExecuteTransaction({ transaction: review.tx });
      if (res.FailedTransaction) throw new Error(`Swap failed: ${res.FailedTransaction.status.error?.message ?? "unknown"}`);
      setDone({ digest: res.Transaction.digest });
      setReview(null);
      setAmount("");
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function verdict(v: "trust" | "block") {
    if (!review) return;
    setBusy(v);
    try {
      const r = await fetch("/api/verdict", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "token", address: review.coinOut.type, verdict: v, label: review.coinOut.symbol, reason: v === "block" ? "Blocked from the swap screen" : "Trusted from the swap screen" }),
      }).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      setSaved({ verdict: v, blobId: r.blobId });
      window.dispatchEvent(new Event("memory-updated"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!account) return <ConnectHint what="swap" />;

  const minOut = review ? (BigInt(review.quote.amountOut) * BigInt(Math.round((1 - review.quote.slippage) * 10000))) / BigInt(10000) : BigInt(0);
  const blocked = review?.level === "critical" && !override;

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="grid grid-cols-[1fr_140px] gap-2">
          <Field label="You pay">
            <input value={amount} onChange={(e) => (setAmount(e.target.value), setReview(null))} inputMode="decimal" placeholder="0.0" className="input font-mono" />
          </Field>
          <Field label="Token">
            <select value={coinIn} onChange={(e) => (setCoinIn(e.target.value), setReview(null))} className="input">
              {(tokens ?? []).map((t) => (
                <option key={t.type} value={t.type}>
                  {t.symbol}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {inTok && (
          <p className="text-xs text-zinc-400">
            Balance: {fromRaw(inTok.balance, inTok.decimals)} {inTok.symbol}
          </p>
        )}
        <Field label="You receive">
          <select value={coinOut} onChange={(e) => (setCoinOut(e.target.value), setReview(null))} className="input">
            {POPULAR.filter((p) => p.type !== coinIn).map((p) => (
              <option key={p.type} value={p.type}>
                {p.symbol}
              </option>
            ))}
            <option value="custom">Other token (paste coin type)…</option>
          </select>
        </Field>
        {coinOut === "custom" && (
          <input value={custom} onChange={(e) => (setCustom(e.target.value), setReview(null))} placeholder="0x…::module::SYMBOL" spellCheck={false} className="input font-mono text-xs" />
        )}
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          Max slippage
          {[0.005, 0.01, 0.03].map((s) => (
            <button
              key={s}
              onClick={() => (setSlippage(s), setReview(null))}
              className={`rounded-lg px-2 py-1 ${slippage === s ? "bg-emerald-500/20 text-emerald-300" : "bg-white/5 hover:bg-white/10"}`}
            >
              {s * 100}%
            </button>
          ))}
        </div>
        <button onClick={doReview} disabled={!!busy || !inTok} className="btn-primary w-full">
          {busy === "review" ? "Checking token, routing + simulating…" : "Review swap"}
        </button>
      </div>

      {error && <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}

      {review && (
        <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="rounded-xl bg-black/30 p-3 font-mono text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-400">You pay</span>
              <span>
                {fromRaw(review.amountRaw, review.coinIn.decimals, 6)} {review.coinIn.symbol}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">You get (quote)</span>
              <span>
                {fromRaw(review.quote.amountOut, review.coinOut.decimals, 6)} {review.coinOut.symbol}
              </span>
            </div>
            <div className="flex justify-between text-xs text-zinc-500">
              <span>Minimum after {review.quote.slippage * 100}% slippage</span>
              <span>{fromRaw(minOut, review.coinOut.decimals, 6)}</span>
            </div>
            <div className="flex justify-between text-xs text-zinc-500">
              <span>Route</span>
              <span>{review.quote.protocols.join(" → ") || "Aftermath"} via Aftermath</span>
            </div>
          </div>

          <GuardPanel level={review.level} signals={review.signals} title={`Token ${review.coinOut.symbol}`} />
          <div className="flex flex-wrap gap-2 text-xs">
            <button onClick={() => verdict("trust")} disabled={!!busy} className="rounded-lg border border-emerald-500/40 px-2.5 py-1 text-emerald-300 hover:bg-emerald-500/10">
              {busy === "trust" ? "Saving…" : "✓ Trust token"}
            </button>
            <button onClick={() => verdict("block")} disabled={!!busy} className="rounded-lg border border-rose-500/40 px-2.5 py-1 text-rose-300 hover:bg-rose-500/10">
              {busy === "block" ? "Saving…" : "⛔ Block token"}
            </button>
            {saved && (
              <a className="self-center text-zinc-400 underline" href={walruscan(saved.blobId)} target="_blank">
                {saved.verdict === "trust" ? "Trusted" : "Blocked"}. Saved to Walrus
              </a>
            )}
          </div>

          <div className="border-t border-white/10 pt-4">
            <SimulationPanel changes={review.changes} me={account.address} tokens={tokens} />
            {review.simError && <p className="mt-2 text-sm text-rose-300">Simulation: {review.simError}</p>}
          </div>

          {review.level === "critical" && (
            <label className="flex items-start gap-2 text-sm text-rose-200">
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="mt-1" />
              I understand the risk and want to swap anyway.
            </label>
          )}
          <button onClick={doSwap} disabled={!!busy || blocked || !!review.simError} className={review.level === "critical" ? "btn-danger w-full" : "btn-primary w-full"}>
            {busy === "swap" ? "Confirm in your wallet…" : `Swap ${review.coinIn.symbol} → ${review.coinOut.symbol}`}
          </button>
        </div>
      )}

      {done && (
        <p className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">
          Swapped ✓{" "}
          <a className="font-mono underline" href={suiscanTx(done.digest)} target="_blank">
            {done.digest.slice(0, 12)}…
          </a>
        </p>
      )}
    </div>
  );
}
