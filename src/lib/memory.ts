import "server-only";
import { MemWal } from "@mysten-incubation/memwal";

// Walrus Memory (Mainnet). Every verdict the user makes is written here, so the
// guard remembers them across sessions, devices and any other app on this account.
let client: MemWal | null = null;

function memwal() {
  if (client) return client;
  const key = process.env.MEMWAL_KEY;
  const accountId = process.env.MEMWAL_ACCOUNT_ID;
  if (!key || !accountId) throw new Error("MEMWAL_KEY / MEMWAL_ACCOUNT_ID are not set");
  client = MemWal.create({
    key,
    accountId,
    serverUrl: process.env.MEMWAL_SERVER_URL ?? "https://relayer.memory.walrus.xyz",
    namespace: NAMESPACE,
  });
  return client;
}

export const NAMESPACE = process.env.MEMWAL_NAMESPACE ?? "tantum-guard";

export type Verdict = "trust" | "block";

export type VerdictMemory = {
  address: string;
  verdict: Verdict;
  reason: string;
  label?: string;
  at: string;
  blobId: string;
};

// Memories are stored as readable text (so semantic recall works and other agents
// can understand them) with a machine-parsable JSON tail.
const TAG = "TANTUM_GUARD_VERDICT";

export async function rememberVerdict(input: {
  address: string;
  verdict: Verdict;
  reason: string;
  label?: string;
  signals?: string[];
}) {
  const at = new Date().toISOString();
  const human =
    input.verdict === "block"
      ? `The user BLOCKED Sui address ${input.address}${input.label ? ` ("${input.label}")` : ""} and never wants to send funds to it.`
      : `The user TRUSTS Sui address ${input.address}${input.label ? ` ("${input.label}")` : ""} as a known, safe recipient.`;
  const text =
    `${human} Reason: ${input.reason || "none given"}.` +
    (input.signals?.length ? ` Risk signals at the time: ${input.signals.join("; ")}.` : "") +
    `\n${TAG} ${JSON.stringify({ address: input.address.toLowerCase(), verdict: input.verdict, reason: input.reason, label: input.label, at })}`;

  const res = await memwal().rememberAndWait(text, NAMESPACE);
  return { blobId: res.blob_id, id: res.id, at };
}

function parse(text: string, blobId: string): VerdictMemory | null {
  const i = text.indexOf(TAG);
  if (i === -1) return null;
  try {
    const j = JSON.parse(text.slice(i + TAG.length).trim());
    return { ...j, blobId };
  } catch {
    return null;
  }
}

/** All verdicts, newest first, de-duplicated so the latest verdict per address wins. */
export async function recallVerdicts(query = "Sui addresses the user trusted or blocked") {
  const res = await memwal().recall({ query, limit: 100, namespace: NAMESPACE });
  const all = res.results
    .map((r) => parse(r.text, r.blob_id))
    .filter((v): v is VerdictMemory => v !== null)
    .sort((a, b) => b.at.localeCompare(a.at));
  const latest = new Map<string, VerdictMemory>();
  for (const v of all) if (!latest.has(v.address)) latest.set(v.address, v);
  return { latest: [...latest.values()], history: all };
}

export async function memoryHealth() {
  return memwal().health();
}
