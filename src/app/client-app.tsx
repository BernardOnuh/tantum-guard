"use client";

import dynamic from "next/dynamic";

// Wallet detection is browser-only, so the whole app renders client-side.
const App = dynamic(() => import("./app"), {
  ssr: false,
  loading: () => <div className="p-10 text-zinc-500">Loading…</div>,
});

export default function ClientApp() {
  return <App />;
}
