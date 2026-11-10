"use client";
/* eslint-disable react-hooks/set-state-in-effect -- effects here reset derived UI state on input changes */

import { useEffect, useState } from "react";
import { useCurrentAccount, useCurrentClient, useDAppKit } from "@mysten/dapp-kit-react";
import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import {
  GuardPanel, LEVEL, SUI_TYPE, SimulationPanel, fromRaw, short, suiscanTx, toRaw, useTokens, walruscan,
  type BalanceChange, type Level, type Signal,
} from "./shared";
import { TokenPicker, TokenPill, useTokenList, usd, type PickedToken } from "./tokens";

type Check = {
  address: string;
  level: Level;
  signals: Signal[];
  profile: { suinsName: string | null; sentCount: number; sentMore: boolean } | null;
  memory: { own: { verdict: string; label?: string } | null; lookalike: { label?: string; address: string } | null; sends: unknown[] };
};

type Review = {
  to: string;
  amountRaw: bigint;
  token: PickedToken;
  check: Check;
  changes: BalanceChange[];
  simError: string | null;
  gasMocked: boolean;
  tx: Transaction;
};

/** Deterministic gradient avatar so lookalike addresses look visibly different. */
export function AddressAvatar({ address, size = 36 }: { address: string; size?: number }) {
  const h = address.replace(/^0x/, "");
  const c1 = `#${h.slice(0, 6)}`;
  const c2 = `#${h.slice(-6)}`;
  const c3 = `#${h.slice(28, 34)}`;
  return (
    <span
      className="shrink-0 rounded-full ring-1 ring-white/15"
      style={{ width: size, height: size, background: `conic-gradient(from 45deg, ${c1}, ${c3}, ${c2}, ${c1})` }}
    />
  );
}

export default function Send() {
  const account = useCurrentAccount();
  const client = useCurrentClient();
  const dAppKit = useDAppKit();
  const { tokens, reload } = useTokens();
  const { list, byType } = useTokenList();

  const [to, setTo] = useState("");
  const [token, setToken] = useState<PickedToken | null>(null);
  const [amount, setAmount] = useState("");
  const [picker, setPicker] = useState(false);
  const [live, setLive] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState<null | "review" | "send" | "trust">(null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [override, setOverride] = useState(false);
  const [done, setDone] = useState<{ digest: string; text: string; to: string; memoryBlob?: string; trusted?: string } | null>(null);

  // Default token: SUI from the wallet.
  useEffect(() => {
    if (token || !tokens?.length) return;
    const t = tokens.find((x) => x.type === SUI_TYPE) ?? tokens[0];
    const l = byType.get(t.type);
    setToken({ type: t.type, symbol: t.symbol, decimals: t.decimals, iconUrl: l?.iconUrl ?? null, price: l?.price ?? null });
  }, [tokens, byType, token]);

  const dest = to.trim().toLowerCase();
  const validAddr = /^0x[0-9a-f]{64}$/.test(dest);

  // Live recipient check as soon as a full address is entered.
  useEffect(() => {
    setReview(null);
    if (!validAddr) {
      setLive(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch("/api/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: dest }) }).then((r) => r.json());
        if (!cancelled && !r.error) setLive(r);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [dest, validAddr]);

  const wTok = tokens?.find((t) => t.type === token?.type);
  const raw = token ? toRaw(amount, token.decimals) : null;
  const insufficient = raw != null && wTok != null && raw > wTok.balance;
  const amtUsd = raw && token?.price ? (Number(raw) / 10 ** token.decimals) * token.price : null;

  async function doReview() {
    if (!account || !token || !raw || !validAddr) return;
    setError(null);
    setDone(null);
    setOverride(false);
    if (dest === account.address.toLowerCase()) return setError("That's your own address.");
    setBusy("review");
    try {
      const tx = new Transaction();
      tx.setSender(account.address);
      tx.transferObjects([coinWithBalance({ type: token.type, balance: raw })], dest);

      const [check, sim] = await Promise.all([
        live?.address === dest
          ? Promise.resolve(live)
          : fetch("/api/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: dest }) }).then((r) => r.json()),
        (async () => {
          const bytes = await tx.build({ client });
          return client.simulateTransaction({ transaction: bytes, include: { balanceChanges: true } });
        })().catch((e: Error) => ({ error: e.message })),
      ]);
      if (check.error) throw new Error(check.error);

      let changes: BalanceChange[] = [];
      let simError: string | null = null;
      let gasMocked = false;
      if ("error" in sim) simError = sim.error;
      else {
        const t = sim.Transaction ?? sim.FailedTransaction;
        changes = (t?.balanceChanges ?? []) as BalanceChange[];
        if (t && !t.status.success) simError = String(t.status.error?.message ?? "Simulation failed");
        gasMocked = Boolean(sim.gasPaymentMocked);
      }
      setReview({ to: dest, amountRaw: raw, token, check, changes, simError, gasMocked, tx });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function doSend() {
    if (!review) return;
    setBusy("send");
    setError(null);
    try {
      const res = await dAppKit.signAndExecuteTransaction({ transaction: review.tx });
      if (res.FailedTransaction) throw new Error(`Transaction failed: ${res.FailedTransaction.status.error?.message ?? "unknown"}`);
      const digest = res.Transaction.digest;
      const amt = fromRaw(review.amountRaw, review.token.decimals, 9);
      setDone({ digest, text: `${amt} ${review.token.symbol} → ${short(review.to)}`, to: review.to });
      setReview(null);
      setAmount("");
      reload();
      fetch("/api/sent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: review.to, amount: amt, symbol: review.token.symbol, digest }),
      })
        .then((r) => r.json())
        .then((j) => {
          if (j.blobId) setDone((d) => (d ? { ...d, memoryBlob: j.blobId } : d));
          window.dispatchEvent(new Event("memory-updated"));
        })
        .catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function trustRecipient() {
    if (!done) return;
    setBusy("trust");
    try {
      const r = await fetch("/api/verdict", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: done.to, verdict: "trust", reason: "Sent funds here successfully" }),
      }).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      setDone((d) => (d ? { ...d, trusted: r.blobId } : d));
      window.dispatchEvent(new Event("memory-updated"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const blocked = review?.check.level === "critical" && !override;
  const name = live?.memory.own?.label ?? live?.profile?.suinsName ?? null;

  return (
    <div className="mx-auto w-full max-w-[480px] space-y-3">
      <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-2 shadow-[0_0_60px_-20px_rgba(16,185,129,0.35)]">
        <div className="px-3 pb-2 pt-1 font-medium">Send</div>

        {/* Amount */}
        <div className="rounded-2xl border border-white/5 bg-black/30 p-4">
          <div className="mb-1 flex justify-between text-xs text-zinc-400">
            <span>Amount</span>
            {wTok && token && (
              <span>
                Balance {fromRaw(wTok.balance, wTok.decimals)}
                <button
                  onClick={() => {
                    const keep = token.type === SUI_TYPE ? BigInt(20_000_000) : BigInt(0);
                    const v = wTok.balance > keep ? wTok.balance - keep : BigInt(0);
                    setAmount(fromRaw(v, wTok.decimals, wTok.decimals).replace(/,/g, ""));
                  }}
                  className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 font-semibold text-emerald-300 hover:bg-emerald-500/25"
                >
                  MAX
                </button>
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <input
              value={amount}
              onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && (setAmount(e.target.value), setReview(null))}
              inputMode="decimal"
              placeholder="0"
              className="min-w-0 flex-1 bg-transparent font-mono text-3xl outline-none placeholder:text-zinc-600"
            />
            <TokenPill token={token} onClick={() => setPicker(true)} />
          </div>
          <div className="mt-1 h-4 text-xs text-zinc-500">{usd(amtUsd)}</div>
        </div>

        {/* Recipient */}
        <div className="mt-2 rounded-2xl border border-white/5 bg-black/30 p-4">
          <div className="mb-2 text-xs text-zinc-400">To</div>
          <div className="flex items-center gap-3">
            {validAddr ? <AddressAvatar address={dest} /> : <span className="h-9 w-9 shrink-0 rounded-full border border-dashed border-white/15" />}
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="Paste a Sui address (0x…)"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-zinc-600"
            />
            {to && (
              <button onClick={() => setTo("")} className="text-zinc-500 hover:text-white" aria-label="Clear">
                ✕
              </button>
            )}
          </div>
          {to && !validAddr && <p className="mt-2 text-xs text-amber-300">A Sui address is 0x followed by 64 hex characters.</p>}
          {validAddr && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/5 pt-3 text-xs">
              {checking && !live ? (
                <span className="animate-pulse text-zinc-500">Checking memory + chain…</span>
              ) : live ? (
                <>
                  <span className={`rounded-full px-2 py-0.5 font-semibold ring-1 ${LEVEL[live.level].cls}`}>{LEVEL[live.level].label}</span>
                  {name && <span className="text-zinc-200">{name}</span>}
                  <span className="text-zinc-500">{live.signals[0]?.text}</span>
                </>
              ) : null}
            </div>
          )}
        </div>

        <div className="p-1 pt-3">
          {!account ? (
            <div className="flex justify-center [&_button]:w-full">
              <ConnectButton />
            </div>
          ) : (
            <button onClick={doReview} disabled={!!busy || !raw || !validAddr || insufficient} className="btn-primary w-full py-3.5 text-base">
              {busy === "review"
                ? "Checking recipient · simulating…"
                : !raw
                  ? "Enter an amount"
                  : insufficient
                    ? `Not enough ${token?.symbol}`
                    : !validAddr
                      ? "Enter a recipient"
                      : "Review send"}
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
          <div className="flex items-center gap-3 rounded-2xl bg-black/30 p-3">
            <AddressAvatar address={review.to} size={40} />
            <div className="min-w-0">
              <div className="font-mono text-sm">
                {fromRaw(review.amountRaw, review.token.decimals, 9)} {review.token.symbol}
              </div>
              <div className="truncate font-mono text-xs text-zinc-500">to {review.to}</div>
            </div>
          </div>
          <GuardPanel level={review.check.level} signals={review.check.signals} title="Recipient check" />
          <div className="border-t border-white/10 pt-4">
            <SimulationPanel changes={review.changes} me={account.address} tokens={tokens} gasMocked={review.gasMocked} />
            {review.simError && <p className="mt-2 text-sm text-rose-300">Simulation: {review.simError}</p>}
          </div>
          {review.check.level === "critical" && (
            <label className="flex items-start gap-2 text-sm text-rose-200">
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="mt-1" />
              I understand the risk and want to send anyway.
            </label>
          )}
          <button
            onClick={doSend}
            disabled={!!busy || blocked || !!review.simError}
            className={`${review.check.level === "critical" ? "btn-danger" : "btn-primary"} w-full py-3.5 text-base`}
          >
            {busy === "send" ? "Confirm in your wallet…" : `Send ${fromRaw(review.amountRaw, review.token.decimals, 9)} ${review.token.symbol}`}
          </button>
        </div>
      )}

      {done && (
        <div className="space-y-2 rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
          <p className="font-medium text-emerald-300">Sent ✓ {done.text}</p>
          <a className="text-xs text-emerald-200/80 underline" href={suiscanTx(done.digest)} target="_blank">
            View on Suiscan ↗
          </a>
          <p className="text-xs text-zinc-400">
            {done.memoryBlob ? (
              <>
                Remembered in Walrus{" "}
                <a className="underline" href={walruscan(done.memoryBlob)} target="_blank">
                  ↗
                </a>
              </>
            ) : (
              "Saving this send to Walrus Memory…"
            )}
          </p>
          {!done.trusted ? (
            <button onClick={trustRecipient} disabled={!!busy} className="rounded-full border border-emerald-500/40 px-3 py-1.5 text-emerald-300 hover:bg-emerald-500/10">
              {busy === "trust" ? "Saving…" : "✓ Trust this recipient for next time"}
            </button>
          ) : (
            <p className="text-emerald-300">Recipient trusted. Lookalikes of this address will now be flagged.</p>
          )}
        </div>
      )}

      <TokenPicker
        open={picker}
        onClose={() => setPicker(false)}
        wallet={tokens}
        list={list}
        walletOnly
        title="Send which token?"
        onPick={(t) => (setToken(t), setReview(null))}
      />
    </div>
  );
}
