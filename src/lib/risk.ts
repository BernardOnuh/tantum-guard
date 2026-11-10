import type { AddressProfile } from "./tatum";
import type { VerdictMemory } from "./memory";

export type Level = "safe" | "low" | "medium" | "high" | "critical";
export type Signal = { level: Level; text: string; source: "memory" | "chain" };

const DAY = 86_400_000;
const rank: Record<Level, number> = { safe: 0, low: 1, medium: 2, high: 3, critical: 4 };

/** Address poisoning: same visible prefix/suffix as a trusted address, different middle. */
export function findLookalike(address: string, trusted: VerdictMemory[]) {
  const a = address.toLowerCase();
  return trusted.find(
    (t) => t.address !== a && t.address.slice(0, 6) === a.slice(0, 6) && t.address.slice(-4) === a.slice(-4),
  );
}

export function assess(
  address: string,
  profile: AddressProfile | null,
  memory: { own?: VerdictMemory; lookalike?: VerdictMemory },
): { level: Level; signals: Signal[] } {
  const signals: Signal[] = [];

  if (memory.own?.verdict === "block")
    signals.push({ level: "critical", source: "memory", text: `You blocked this address on ${memory.own.at.slice(0, 10)}: "${memory.own.reason}"` });
  if (memory.lookalike)
    signals.push({
      level: "critical",
      source: "memory",
      text: `Looks like your trusted address${memory.lookalike.label ? ` "${memory.lookalike.label}"` : ""} (${short(memory.lookalike.address)}) but is NOT the same. This is an address-poisoning pattern.`,
    });

  if (profile) {
    if (profile.isPackageOrObject)
      signals.push({ level: "high", source: "chain", text: "This is an onchain object or package ID, not a wallet. Funds sent here are likely lost." });
    if (profile.sentCount === 0 && profile.receivedCount === 0)
      signals.push({ level: "medium", source: "chain", text: "There is no transaction history on Sui Mainnet." });
    else if (profile.sentCount === 0)
      signals.push({ level: "medium", source: "chain", text: "This address has received funds but never sent a transaction." });
    if (profile.firstSeenMs && Date.now() - profile.firstSeenMs < 7 * DAY)
      signals.push({ level: "medium", source: "chain", text: `First seen ${Math.max(1, Math.round((Date.now() - profile.firstSeenMs) / DAY))} day(s) ago.` });
    if (profile.suinsName)
      signals.push({ level: "low", source: "chain", text: `Has a SuiNS name: ${profile.suinsName}` });
    if (profile.sentMore || profile.receivedMore)
      signals.push({ level: "low", source: "chain", text: "This is an established address with 50+ transactions." });
  }

  if (memory.own?.verdict === "trust" && !memory.lookalike)
    signals.unshift({ level: "safe", source: "memory", text: `You trusted this address on ${memory.own.at.slice(0, 10)}${memory.own.label ? ` as "${memory.own.label}"` : ""}.` });

  let level: Level = signals.reduce<Level>((m, s) => (rank[s.level] > rank[m] ? s.level : m), "low");
  if (memory.own?.verdict === "trust" && level !== "critical") level = "safe";
  return { level, signals };
}

export function short(a: string) {
  return `${a.slice(0, 8)}…${a.slice(-6)}`;
}
