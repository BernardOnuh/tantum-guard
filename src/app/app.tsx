"use client";

import { useEffect, useRef, useState } from "react";
import { DAppKitProvider } from "@mysten/dapp-kit-react";
import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { dAppKit } from "./dapp-kit";
import Guard from "./guard";
import Send from "./send";
import Swap from "./swap";
import Recurring from "./recurring";

const TABS = [
  { id: "send", label: "Send", short: "Send", icon: "M5 19 19 5M9 5h10v10" },
  { id: "swap", label: "Swap", short: "Swap", icon: "M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" },
  { id: "check", label: "Check address", short: "Check", icon: "M12 3 4 6v6c0 4.4 3.4 8.2 8 9 4.6-.8 8-4.6 8-9V6l-8-3Zm-3 9 2 2 4-4" },
  { id: "recurring", label: "Recurring", short: "Recurring", icon: "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5M12 7v5l3 2" },
] as const;

function TabIcon({ d }: { d: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function Trailer() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem("tg-trailer-hidden") === "1";
    } catch {
      return false;
    }
  });
  const toggle = (v: boolean) => {
    setHidden(v);
    try {
      localStorage.setItem("tg-trailer-hidden", v ? "1" : "0");
    } catch {}
  };
  if (hidden)
    return (
      <button onClick={() => toggle(false)} className="mb-6 flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-zinc-300 hover:bg-white/10">
        ▶ Watch the 48-second film
      </button>
    );
  return (
    <section className="mb-6 grid items-center gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-3 sm:mb-8 sm:gap-6 sm:p-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <video
        src="/film.mp4"
        poster="/film-poster.jpg"
        controls
        playsInline
        preload="metadata"
        className="aspect-video w-full rounded-2xl bg-black ring-1 ring-white/10"
      />
      <div className="flex items-center justify-between gap-3 px-1 sm:hidden">
        <p className="text-xs text-zinc-400">Billions are lost to scams and wrong sends. Tantum Guard stops them before you sign.</p>
        <button onClick={() => toggle(true)} className="shrink-0 text-xs text-zinc-500">
          Hide
        </button>
      </div>
      <div className="hidden space-y-4 sm:block">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-semibold">No reason to shed tears</h2>
          <button onClick={() => toggle(true)} className="shrink-0 text-xs text-zinc-500 hover:text-zinc-300">
            Hide
          </button>
        </div>
        <ol className="space-y-3 text-sm">
          {[
            ["!", "The problem", "Crypto scams took at least $14B in 2025 (Chainalysis). Researchers found 270M address-poisoning attacks (USENIX Security 2025)."],
            ["1", "Paste or pick a recipient", "It's scanned instantly. Tatum reads its real wallet activity on Sui Mainnet."],
            ["2", "Your memory weighs in", "Addresses and tokens you trusted or blocked live in Walrus Memory, so lookalikes get stopped."],
            ["3", "Simulate, then sign", "Every send and swap is simulated through Tatum so you see exactly what moves before your wallet signs."],
          ].map(([n, t, d]) => (
            <li key={n} className="flex gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-500/15 font-mono text-xs text-emerald-300">{n}</span>
              <span>
                <span className="block font-medium">{t}</span>
                <span className="block text-zinc-400">{d}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

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
  const appRef = useRef<HTMLDivElement>(null);

  // Follow #send / #swap / #check links (also when only the hash changes).
  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.slice(1);
      const t = TABS.find((x) => x.id === h);
      if (t) setTabState(t.id);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return (
    <DAppKitProvider dAppKit={dAppKit}>
      <div className="mx-auto w-full max-w-5xl px-4 pb-28 pt-5 sm:py-12">
        <header className="mb-5 sm:mb-8">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="hidden font-mono text-xs uppercase tracking-[0.2em] text-emerald-400 sm:block">Tatum × Walrus Memory · Sui Mainnet</p>
              <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight sm:mt-2 sm:gap-3 sm:text-5xl">
                {/* eslint-disable-next-line @next/next/no-img-element -- static svg logo */}
                <img src="/logo.svg" alt="" className="h-8 w-8 sm:h-12 sm:w-12" />
                <span className="truncate">Tantum Guard</span>
              </h1>
            </div>
            <div className="shrink-0">
              <ConnectButton />
            </div>
          </div>
          <p className="mt-2 text-sm text-zinc-400 sm:hidden">
            A Sui wallet that remembers who you trust. Powered by <span className="text-zinc-200">Tatum</span> ×{" "}
            <span className="text-violet-300">Walrus Memory</span>.
          </p>
          <p className="mt-3 hidden max-w-2xl text-zinc-400 sm:block">
              A Sui wallet companion that remembers. Every send and swap is checked against what you&apos;ve trusted and
              blocked before (kept in <span className="text-violet-300">Walrus Memory</span>) and simulated on Mainnet
              through <span className="text-zinc-200">Tatum</span> before you sign.
          </p>
        </header>

        <Trailer />

        <div ref={appRef} className="scroll-mt-4" />
        <nav className="mb-6 hidden rounded-xl border border-white/10 bg-white/[0.03] p-1 sm:inline-flex">
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

        {/* Mobile: thumb-reach bottom tab bar */}
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0a0c10]/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg sm:hidden">
          <div className="mx-auto grid max-w-md grid-cols-4">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setTab(t.id);
                  appRef.current?.scrollIntoView({ behavior: "smooth" });
                }}
                className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${tab === t.id ? "text-emerald-400" : "text-zinc-400"}`}
              >
                <TabIcon d={t.icon} />
                {t.short}
              </button>
            ))}
          </div>
        </nav>

        <Guard
          panel={
            tab === "send" ? (
              <Send key={`send-${prefill.n}`} initialTo={prefill.to} />
            ) : tab === "swap" ? (
              <Swap key={`swap-${prefill.n}`} initialTo={prefill.to} />
            ) : tab === "recurring" ? (
              <Recurring />
            ) : undefined
          }
          onAction={(action, address) => {
            setPrefill((p) => ({ to: address, n: p.n + 1 }));
            setTab(action);
            requestAnimationFrame(() => appRef.current?.scrollIntoView({ behavior: "smooth" }));
          }}
        />
      </div>
    </DAppKitProvider>
  );
}
