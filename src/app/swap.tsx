"use client";
/* eslint-disable react-hooks/set-state-in-effect -- effects here reset derived UI state on input changes */

import { useEffect, useRef, useState } from "react";
import { useCurrentAccount, useCurrentClient, useDAppKit } from "@mysten/dapp-kit-react";
import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { Transaction } from "@mysten/sui/transactions";
import {
  GuardPanel, SUI_TYPE, short, SimulationPanel, fromRaw, suiscanTx, toRaw, useTokens, walruscan,
  type BalanceChange, type Level, type Signal,
} from "./shared";
import { TokenPicker, TokenPill, useTokenList, usd, type PickedToken } from "./tokens";
import { RecipientField, useAddressCheck, type AddressCheck } from "./recipient";

type Quote = { amountOut: string; feePct: number; protocols: string[]; slippage: number; tx: string | null; spotPrice: number };

type Review = {
  coinIn: PickedToken;
  coinOut: PickedToken;
  amountRaw: bigint;
  quote: Quote;
  level: Level;
  signals: Signal[];
  changes: BalanceChange[];
  simError: string | null;
  tx: Transaction;
  recipient: string | null;
  recipientCheck: AddressCheck | null;
};

const RANK: Record<Level, number> = { safe: 0, low: 1, medium: 2, high: 3, critical: 4 };

const USDC = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";

export default function Swap({ initialTo = "" }: { initialTo?: string }) {
  const account = useCurrentAccount();
  const client = useCurrentClient();
  const dAppKit = useDAppKit();
  const { tokens, reload } = useTokens();
  const { list, byType } = useTokenList();

  const [coinIn, setCoinIn] = useState<PickedToken | null>(null);
  const [coinOut, setCoinOut] = useState<PickedToken | null>(null);
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(0.01);
  const [sendTo, setSendTo] = useState(!!initialTo);
  const [to, setTo] = useState(initialTo);
  const recip = useAddressCheck(sendTo ? to : "");
  const recipient = sendTo && recip.valid ? recip.address : null;
  const [picker, setPicker] = useState<null | "in" | "out">(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "review" | "swap" | "trust" | "block">(null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [override, setOverride] = useState(false);
  const [done, setDone] = useState<{ digest: string; text: string } | null>(null);
  const [saved, setSaved] = useState<{ verdict: string; blobId: string } | null>(null);

  // Defaults: SUI → USDC once the token list arrives.
  useEffect(() => {
    if (!list) return;
    const pick = (t: string) => {
      const x = byType.get(t);
      return x ? { type: x.type, symbol: x.symbol, decimals: x.decimals, iconUrl: x.iconUrl, price: x.price } : null;
    };
    setCoinIn((c) => c ?? pick(SUI_TYPE));
    setCoinOut((c) => c ?? pick(USDC));
  }, [list, byType]);

  const walletIn = tokens?.find((t) => t.type === coinIn?.type);
  const balanceIn = walletIn?.balance ?? BigInt(0);
  const decIn = walletIn?.decimals ?? coinIn?.decimals ?? 9;
  const raw = coinIn ? toRaw(amount, decIn) : null;
  const insufficient = !!account && raw != null && raw > balanceIn;

  // Live quote (debounced). Price-only when no wallet is connected.
  const seq = useRef(0);
  useEffect(() => {
    setReview(null);
    if (!coinIn || !coinOut || !raw || raw <= BigInt(0) || coinIn.type === coinOut.type) {
      setQuote(null);
      setQuoteErr(null);
      return;
    }
    const id = ++seq.current;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const q = await fetch("/api/swap/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ coinIn: coinIn.type, coinOut: coinOut.type, amountIn: raw.toString(), slippage, wallet: account?.address, recipient }),
        }).then((r) => r.json());
        if (id !== seq.current) return;
        if (q.error) throw new Error(q.error);
        setQuote(q);
        setQuoteErr(null);
      } catch (e) {
        if (id === seq.current) {
          setQuote(null);
          setQuoteErr((e as Error).message.replace(/^No swap route: /, ""));
        }
      } finally {
        if (id === seq.current) setQuoting(false);
      }
    }, 550);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- raw is derived from amount/coinIn
  }, [amount, coinIn?.type, coinOut?.type, slippage, account?.address, recipient]);

  const outAmount = quote && coinOut ? Number(quote.amountOut) / 10 ** coinOut.decimals : null;
  const inUsd = raw && coinIn?.price ? (Number(raw) / 10 ** decIn) * coinIn.price : null;
  const outUsd = outAmount != null && coinOut?.price ? outAmount * coinOut.price : null;
  const impact = inUsd && outUsd ? (outUsd - inUsd) / inUsd : null;
  const rate = quote && raw && coinIn && coinOut && outAmount ? outAmount / (Number(raw) / 10 ** decIn) : null;
  const minOut = quote ? (BigInt(quote.amountOut) * BigInt(Math.round((1 - quote.slippage) * 10000))) / BigInt(10000) : null;

  function flip() {
    setCoinIn(coinOut);
    setCoinOut(coinIn);
    setAmount(outAmount ? String(+outAmount.toPrecision(6)) : "");
  }

  async function doReview() {
    if (!account || !coinIn || !coinOut || !raw) return;
    if (sendTo && !recipient) return setError("Enter the recipient's address, or turn off “Send to another wallet”.");
    if (recipient && recipient === account.address.toLowerCase()) return setError("That's your own address. Turn off “Send to another wallet”.");
    setError(null);
    setDone(null);
    setSaved(null);
    setOverride(false);
    setBusy("review");
    try {
      const [check, q, rCheck] = await Promise.all([
        fetch("/api/token-check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coinType: coinOut.type }) }).then((r) => r.json()),
        fetch("/api/swap/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ coinIn: coinIn.type, coinOut: coinOut.type, amountIn: raw.toString(), slippage, wallet: account.address, recipient }),
        }).then((r) => r.json()),
        !recipient
          ? Promise.resolve(null)
          : recip.check
            ? Promise.resolve(recip.check)
            : fetch("/api/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: recipient }) }).then((r) => r.json()),
      ]);
      if (rCheck?.error) throw new Error(rCheck.error);
      if (check.error) throw new Error(check.error);
      if (q.error) throw new Error(q.error);

      const tx = Transaction.from(q.tx);
      let changes: BalanceChange[] = [];
      let simError: string | null = null;
      try {
        // Auto-estimated budgets for routed swaps are razor thin; use a 0.05 SUI ceiling when affordable.
        const GAS_CEILING = BigInt(50_000_000);
        const suiBal = tokens?.find((t) => t.type === SUI_TYPE)?.balance ?? BigInt(0);
        const suiSpent = coinIn.type === SUI_TYPE ? raw : BigInt(0);
        if (suiBal - suiSpent >= GAS_CEILING) tx.setGasBudget(GAS_CEILING);
        const bytes = await tx.build({ client });
        const sim = await client.simulateTransaction({ transaction: bytes, include: { balanceChanges: true } });
        const t = sim.Transaction ?? sim.FailedTransaction;
        changes = (t?.balanceChanges ?? []) as BalanceChange[];
        if (t && !t.status.success) simError = String(t.status.error?.message ?? "Simulation failed");
      } catch (e) {
        simError = (e as Error).message;
      }

      const outMeta = { ...coinOut, symbol: check.token?.symbol ?? coinOut.symbol, decimals: check.token?.decimals ?? coinOut.decimals };
      setReview({
        coinIn: { ...coinIn, decimals: decIn },
        coinOut: outMeta,
        amountRaw: raw,
        quote: q,
        level: check.level,
        signals: check.signals,
        changes,
        simError,
        tx,
        recipient,
        recipientCheck: rCheck,
      });
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
      const outTxt = fromRaw(review.quote.amountOut, review.coinOut.decimals, 6);
      setDone({
        digest: res.Transaction.digest,
        text: `${fromRaw(review.amountRaw, review.coinIn.decimals, 6)} ${review.coinIn.symbol} → ${outTxt} ${review.coinOut.symbol}${review.recipient ? ` sent to ${short(review.recipient)}` : ""}`,
      });
      if (review.recipient)
        fetch("/api/sent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ to: review.recipient, amount: outTxt.replace(/,/g, ""), symbol: review.coinOut.symbol, digest: res.Transaction.digest }),
        })
          .then(() => window.dispatchEvent(new Event("memory-updated")))
          .catch(() => {});
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
      if (v === "block") setReview((rv) => (rv ? { ...rv, level: "critical", signals: [{ level: "critical", source: "memory", text: "You just blocked this token." }, ...rv.signals] } : rv));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const overall: Level | null = review
    ? RANK[review.recipientCheck?.level ?? "safe"] > RANK[review.level]
      ? review.recipientCheck!.level
      : review.level
    : null;
  const blocked = overall === "critical" && !override;
  const canReview = !!account && !!quote && !insufficient && !quoting && !busy && (!sendTo || !!recipient);

  return (
    <div className="mx-auto w-full max-w-[480px] space-y-3">
      <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-2 shadow-[0_0_60px_-20px_rgba(16,185,129,0.35)]">
        <div className="flex items-center justify-between px-3 pb-2 pt-1">
          <span className="font-medium">Swap</span>
          <div className="flex items-center gap-1 text-xs text-zinc-400">
            <span className="mr-1">Slippage</span>
            {[0.005, 0.01, 0.03].map((s) => (
              <button
                key={s}
                onClick={() => setSlippage(s)}
                className={`rounded-full px-2.5 py-1 transition ${slippage === s ? "bg-emerald-500/20 text-emerald-300" : "bg-white/5 hover:bg-white/10"}`}
              >
                {s * 100}%
              </button>
            ))}
          </div>
        </div>

        {/* You pay */}
        <div className="rounded-2xl border border-white/5 bg-black/30 p-4">
          <div className="mb-1 flex justify-between text-xs text-zinc-400">
            <span>You pay</span>
            {account && coinIn && (
              <span>
                Balance {fromRaw(balanceIn, decIn)}
                {balanceIn > BigInt(0) && (
                  <button
                    onClick={() => {
                      const keep = coinIn.type === SUI_TYPE ? BigInt(60_000_000) : BigInt(0);
                      const v = balanceIn > keep ? balanceIn - keep : BigInt(0);
                      setAmount(fromRaw(v, decIn, decIn).replace(/,/g, ""));
                    }}
                    className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 font-semibold text-emerald-300 hover:bg-emerald-500/25"
                  >
                    MAX
                  </button>
                )}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <input
              value={amount}
              onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0"
              className="min-w-0 flex-1 bg-transparent font-mono text-3xl outline-none placeholder:text-zinc-600"
            />
            <TokenPill token={coinIn} onClick={() => setPicker("in")} />
          </div>
          <div className="mt-1 h-4 text-xs text-zinc-500">{usd(inUsd)}</div>
        </div>

        {/* Flip */}
        <div className="relative z-10 -my-3 flex justify-center">
          <button
            onClick={flip}
            aria-label="Flip tokens"
            className="grid h-10 w-10 place-items-center rounded-xl border-4 border-[#0b0d12] bg-zinc-800 text-zinc-300 transition hover:rotate-180 hover:bg-zinc-700"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 2v12m0 0-4-4m4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* You receive */}
        <div className="rounded-2xl border border-white/5 bg-black/30 p-4">
          <div className="mb-1 text-xs text-zinc-400">You receive</div>
          <div className="flex items-center gap-3">
            <div className={`min-w-0 flex-1 truncate font-mono text-3xl ${quoting ? "animate-pulse text-zinc-500" : outAmount ? "" : "text-zinc-600"}`}>
              {outAmount != null ? (+outAmount.toPrecision(8)).toLocaleString(undefined, { maximumFractionDigits: 8 }) : "0"}
            </div>
            <TokenPill token={coinOut} onClick={() => setPicker("out")} />
          </div>
          <div className="mt-1 h-4 text-xs text-zinc-500">
            {usd(outUsd)}
            {impact != null && Math.abs(impact) > 0.005 && (
              <span className={impact < -0.03 ? "ml-1 text-rose-400" : "ml-1"}>({(impact * 100).toFixed(2)}%)</span>
            )}
          </div>
        </div>

        {/* Deliver to another wallet */}
        <div className="mt-2 rounded-2xl border border-white/5 bg-black/20 px-4 py-3">
          <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
            <span>
              Send to another wallet
              <span className="block text-xs text-zinc-500">Swap from your wallet and deliver the output to someone else.</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={sendTo}
              onClick={() => setSendTo((v) => !v)}
              className={`relative h-6 w-11 shrink-0 rounded-full transition ${sendTo ? "bg-emerald-500" : "bg-white/15"}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${sendTo ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </label>
        </div>
        {sendTo && (
          <div className="mt-2">
            <RecipientField value={to} onChange={setTo} label="Recipient" state={recip} />
          </div>
        )}

        {/* Details */}
        {quote && coinIn && coinOut && (
          <div className="space-y-1 px-3 pb-1 pt-3 text-xs text-zinc-400">
            {rate != null && (
              <Detail k="Rate" v={`1 ${coinIn.symbol} ≈ ${(+rate.toPrecision(6)).toLocaleString()} ${coinOut.symbol}`} />
            )}
            {minOut != null && <Detail k={`Minimum received (${quote.slippage * 100}%)`} v={`${fromRaw(minOut, coinOut.decimals, 6)} ${coinOut.symbol}`} />}
            <Detail k="Route" v={`${quote.protocols.join(" → ") || "Best route"} · via Aftermath`} />
          </div>
        )}
        {quoteErr && <p className="px-3 pt-3 text-xs text-amber-300">{quoteErr}</p>}

        <div className="p-1 pt-3">
          {!account ? (
            <div className="flex justify-center [&_button]:w-full">
              <ConnectButton />
            </div>
          ) : (
            <button onClick={doReview} disabled={!canReview} className="btn-primary w-full py-3.5 text-base">
              {busy === "review"
                ? "Checking token · simulating…"
                : insufficient
                  ? `Not enough ${coinIn?.symbol}`
                  : !amount
                    ? "Enter an amount"
                    : quoting
                      ? "Finding best price…"
                      : sendTo && !recipient
                        ? "Enter a recipient"
                        : quote
                        ? recipient
                          ? "Review swap & send"
                          : "Review swap"
                        : "No route"}
            </button>
          )}
        </div>
      </div>

      {error && <p className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}

      {review && account && (
        <div className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Review</h3>
            <button onClick={() => setReview(null)} className="text-xs text-zinc-400 hover:text-white">
              Cancel
            </button>
          </div>
          {review.recipient && review.recipientCheck && (
            <div className="border-b border-white/10 pb-4">
              <GuardPanel level={review.recipientCheck.level} signals={review.recipientCheck.signals} title={`Recipient ${short(review.recipient)}`} />
            </div>
          )}
          <GuardPanel level={review.level} signals={review.signals} title={`Token you're buying: ${review.coinOut.symbol}`} />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button onClick={() => verdict("trust")} disabled={!!busy} className="rounded-full border border-emerald-500/40 px-3 py-1 text-emerald-300 hover:bg-emerald-500/10">
              {busy === "trust" ? "Saving…" : "✓ Trust token"}
            </button>
            <button onClick={() => verdict("block")} disabled={!!busy} className="rounded-full border border-rose-500/40 px-3 py-1 text-rose-300 hover:bg-rose-500/10">
              {busy === "block" ? "Saving…" : "⛔ Block token"}
            </button>
            {saved && (
              <a className="text-zinc-400 underline" href={walruscan(saved.blobId)} target="_blank">
                {saved.verdict === "trust" ? "Trusted" : "Blocked"}. Saved to Walrus ↗
              </a>
            )}
          </div>
          <div className="border-t border-white/10 pt-4">
            <SimulationPanel changes={review.changes} me={account.address} tokens={tokens} recipient={review.recipient} />
            {review.simError && <p className="mt-2 text-sm text-rose-300">Simulation: {review.simError}</p>}
          </div>
          {overall === "critical" && (
            <label className="flex items-start gap-2 text-sm text-rose-200">
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="mt-1" />
              I understand the risk and want to swap anyway.
            </label>
          )}
          <button onClick={doSwap} disabled={!!busy || blocked || !!review.simError} className={`${overall === "critical" ? "btn-danger" : "btn-primary"} w-full py-3.5 text-base`}>
            {busy === "swap"
              ? "Confirm in your wallet…"
              : `Swap ${review.coinIn.symbol} → ${review.coinOut.symbol}${review.recipient ? ` & send to ${short(review.recipient)}` : ""}`}
          </button>
        </div>
      )}

      {done && (
        <div className="rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
          <p className="font-medium text-emerald-300">Swapped ✓ {done.text}</p>
          <a className="font-mono text-xs text-emerald-200/80 underline" href={suiscanTx(done.digest)} target="_blank">
            View on Suiscan ↗
          </a>
        </div>
      )}

      <TokenPicker
        open={picker !== null}
        onClose={() => setPicker(null)}
        wallet={tokens}
        list={list}
        exclude={picker === "in" ? coinOut?.type : coinIn?.type}
        title={picker === "in" ? "You pay with" : "You receive"}
        onPick={(t) => {
          const withBal = tokens?.find((x) => x.type === t.type);
          const pickedT = { ...t, decimals: withBal?.decimals ?? t.decimals };
          if (picker === "in") setCoinIn(pickedT);
          else setCoinOut(pickedT);
        }}
      />
    </div>
  );
}

function Detail({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span>{k}</span>
      <span className="truncate text-right text-zinc-300">{v}</span>
    </div>
  );
}
