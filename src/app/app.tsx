"use client";

import { useState } from "react";
import { DAppKitProvider } from "@mysten/dapp-kit-react";
import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { dAppKit } from "./dapp-kit";
import Guard from "./guard";
import Send from "./send";
import Swap from "./swap";

const TABS = [
  { id: "send", label: "Send" },
  { id: "swap", label: "Swap" },
  { id: "check", label: "Check address" },
] as const;

export default function App() {
  type TabId = (typeof TABS)[number]["id"];
  const [tab, setTabState] = useState<TabId>(() => {
    const h = window.location.hash.slice(1);
    return (TABS.find((t) => t.id === h)?.id ?? "send") as TabId;
  });
  const [prefill, setPrefill] = useState({ to: "", n: 0 });
  const setTab = (t: TabId) => {
    setTabState(t);
    history.replaceState(null, "", `#${t}`);
  };
  return (
    <DAppKitProvider dAppKit={dAppKit}>
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-12">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-emerald-400">Tatum × Walrus Memory · Sui Mainnet</p>
            <h1 className="mt-2 flex items-center gap-3 text-4xl font-semibold tracking-tight sm:text-5xl">
              {/* eslint-disable-next-line @next/next/no-img-element -- static svg logo */}
              <img src="/logo.svg" alt="" className="h-11 w-11 sm:h-12 sm:w-12" />
              Tantum Guard
            </h1>
            <p className="mt-3 max-w-2xl text-zinc-400">
              A Sui wallet companion that remembers. Every send and swap is checked against what you&apos;ve trusted and
              blocked before (kept in <span className="text-violet-300">Walrus Memory</span>) and simulated on Mainnet
              through <span className="text-zinc-200">Tatum</span> before you sign.
            </p>
          </div>
          <ConnectButton />
        </header>

        <nav className="mb-6 inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-lg px-4 py-2 text-sm transition ${tab === t.id ? "bg-emerald-500 text-black" : "text-zinc-300 hover:text-white"}`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <Guard
          panel={
            tab === "send" ? (
              <Send key={`send-${prefill.n}`} initialTo={prefill.to} />
            ) : tab === "swap" ? (
              <Swap key={`swap-${prefill.n}`} initialTo={prefill.to} />
            ) : undefined
          }
          onAction={(action, address) => {
            setPrefill((p) => ({ to: address, n: p.n + 1 }));
            setTab(action);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      </div>
    </DAppKitProvider>
  );
}
