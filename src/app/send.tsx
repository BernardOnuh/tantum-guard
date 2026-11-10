"use client";

import { useState } from "react";
import { useCurrentAccount, useCurrentClient, useDAppKit } from "@mysten/dapp-kit-react";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import {
  GuardPanel, SimulationPanel, SUI_TYPE, fromRaw, short, suiscanTx, toRaw, useTokens, walruscan,
  type BalanceChange, type Level, type Signal,
} from "./shared";

type Review = {
  to: string;
  amountRaw: bigint;
  token: { type: string; symbol: string; decimals: number };
  level: Level;
  signals: Signal[];
  changes: BalanceChange[];
  simError: string | null;
  gasMocked: boolean;
  tx: Transaction;
};

export default function Send() {
  const account = useCurrentAccount();
  const client = useCurrentClient();
  const dAppKit = useDAppKit();
  const { tokens, reload } = useTokens();

  const [to, setTo] = useState("");
  const [coin, setCoin] = useState(SUI_TYPE);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<null | "review" | "send" | "trust">(null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [override, setOverride] = useState(false);
  const [done, setDone] = useState<{ digest: string; memoryBlob?: string; trusted?: string } | null>(null);

  const token = tokens?.find((t) => t.type === coin);

  async function doReview() {
    if (!account || !token) return;
    setError(null);
    setReview(null);
    setDone(null);
    setOverride(false);
    const raw = toRaw(amount, token.decimals);
    if (!raw || raw <= BigInt(0)) return setError("Enter an amount.");
    if (raw > token.balance) return setError(`You only have ${fromRaw(token.balance, token.decimals)} ${token.symbol}.`);
    const dest = to.trim().toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(dest)) return setError("Enter a full Sui address (0x + 64 hex characters).");
    if (dest === account.address.toLowerCase()) return setError("That's your own address.");

    setBusy("review");
    try {
      const tx = new Transaction();
      tx.setSender(account.address);
      tx.transferObjects([coinWithBalance({ type: token.type, balance: raw })], dest);

      const [check, sim] = await Promise.all([
        fetch("/api/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: dest }) }).then((r) => r.json()),
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

      setReview({ to: dest, amountRaw: raw, token, level: check.level, signals: check.signals, changes, simError, gasMocked, tx });
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
      setDone({ digest });
      setReview(null);
      setAmount("");
      reload();
      // Remember the successful send in Walrus Memory (runs in the background).
      fetch("/api/sent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: review.to, amount: fromRaw(review.amountRaw, review.token.decimals, 9), symbol: review.token.symbol, digest }),
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
    const dest = to.trim().toLowerCase();
    setBusy("trust");
    try {
      const r = await fetch("/api/verdict", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: dest, verdict: "trust", reason: "Sent funds here successfully" }),
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

  if (!account) return <ConnectHint what="send" />;

  const blocked = review?.level === "critical" && !override;

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <Field label="To">
          <input
            value={to}
            onChange={(e) => (setTo(e.target.value), setReview(null))}
            placeholder="0x… recipient address"
            spellCheck={false}
            className="input font-mono"
          />
        </Field>
        <div className="grid grid-cols-[1fr_140px] gap-2">
          <Field label="Amount">
            <input value={amount} onChange={(e) => (setAmount(e.target.value), setReview(null))} inputMode="decimal" placeholder="0.0" className="input font-mono" />
          </Field>
          <Field label="Token">
            <select value={coin} onChange={(e) => (setCoin(e.target.value), setReview(null))} className="input">
              {(tokens ?? []).map((t) => (
                <option key={t.type} value={t.type}>
                  {t.symbol}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {token && (
          <button onClick={() => setAmount(fromRaw(token.balance, token.decimals, token.decimals).replace(/,/g, ""))} className="text-xs text-zinc-400 hover:text-zinc-200">
            Balance: {fromRaw(token.balance, token.decimals)} {token.symbol} (max)
          </button>
        )}
        {tokens?.length === 0 && <p className="text-sm text-zinc-500">This wallet has no tokens yet.</p>}
        <button onClick={doReview} disabled={!!busy || !token} className="btn-primary w-full">
          {busy === "review" ? "Checking recipient + simulating…" : "Review send"}
        </button>
      </div>

      {error && <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}

      {review && (
        <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <GuardPanel level={review.level} signals={review.signals} title={`Recipient ${short(review.to)}`} />
          <div className="border-t border-white/10 pt-4">
            <SimulationPanel changes={review.changes} me={account.address} tokens={tokens} gasMocked={review.gasMocked} />
            {review.simError && <p className="mt-2 text-sm text-rose-300">Simulation: {review.simError}</p>}
          </div>
          {review.level === "critical" && (
            <label className="flex items-start gap-2 text-sm text-rose-200">
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="mt-1" />
              I understand the risk and want to send anyway.
            </label>
          )}
          <button onClick={doSend} disabled={!!busy || blocked || !!review.simError} className={review.level === "critical" ? "btn-danger w-full" : "btn-primary w-full"}>
            {busy === "send"
              ? "Confirm in your wallet…"
              : `Send ${fromRaw(review.amountRaw, review.token.decimals, 9)} ${review.token.symbol}`}
          </button>
        </div>
      )}

      {done && (
        <div className="space-y-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
          <p className="text-emerald-300">
            Sent ✓{" "}
            <a className="font-mono underline" href={suiscanTx(done.digest)} target="_blank">
              {done.digest.slice(0, 12)}…
            </a>
          </p>
          <p className="text-zinc-400">
            {done.memoryBlob ? (
              <>
                Remembered in Walrus:{" "}
                <a className="font-mono underline" href={walruscan(done.memoryBlob)} target="_blank">
                  {done.memoryBlob.slice(0, 12)}…
                </a>
              </>
            ) : (
              "Writing this send to Walrus Memory…"
            )}
          </p>
          {!done.trusted ? (
            <button onClick={trustRecipient} disabled={!!busy} className="rounded-lg border border-emerald-500/40 px-3 py-1.5 text-emerald-300 hover:bg-emerald-500/10">
              {busy === "trust" ? "Saving…" : "✓ Trust this recipient for next time"}
            </button>
          ) : (
            <p className="text-emerald-300">Recipient trusted. Lookalikes of this address will now be flagged.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

export function ConnectHint({ what }: { what: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-zinc-400">
      Connect a Sui wallet (top right) to {what}. Every {what} is checked against your Walrus memory and simulated through Tatum before you sign.
    </div>
  );
}
