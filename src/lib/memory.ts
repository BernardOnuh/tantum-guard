import "server-only";
import { MemWal } from "@mysten-incubation/memwal";
import { normalizeStructTag } from "@mysten/sui/utils";

// Walrus Memory (Mainnet). Every verdict and every completed send is written here, so the
// guard remembers them across sessions, devices and any other app on this account.
let client: MemWal | null = null;

export const NAMESPACE = process.env.MEMWAL_NAMESPACE ?? "tantum-guard";

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

export type Verdict = "trust" | "block";
export type SubjectKind = "address" | "token";

export type VerdictMemory = {
  kind: SubjectKind;
  address: string; // the subject: a Sui address, or a coin type for tokens
  verdict: Verdict;
  reason: string;
  label?: string;
  at: string;
  blobId: string;
};

export type SendMemory = {
  to: string;
  amount: string;
  symbol: string;
  digest: string;
  at: string;
  blobId: string;
};

// Memories are readable text (so semantic recall works and other agents can use them)
// with a machine-parsable JSON tail.
const TAG = "TANTUM_GUARD_VERDICT";
const SEND_TAG = "TANTUM_GUARD_SEND";

export const normSubject = (kind: SubjectKind, s: string) =>
  kind === "address" ? s.toLowerCase() : normalizeStructTag(s.trim());

export async function rememberVerdict(input: {
  kind?: SubjectKind;
  address: string;
  verdict: Verdict;
  reason: string;
  label?: string;
  signals?: string[];
}) {
  const kind = input.kind ?? "address";
  const subject = normSubject(kind, input.address);
  const at = new Date().toISOString();
  const what = kind === "address" ? `Sui address ${subject}` : `the token ${subject}`;
  const name = input.label ? ` ("${input.label}")` : "";
  const human =
    input.verdict === "block"
      ? `The user BLOCKED ${what}${name} and never wants to ${kind === "address" ? "send funds to it" : "buy or hold it"}.`
      : `The user TRUSTS ${what}${name} as ${kind === "address" ? "a known, safe recipient" : "a legitimate token"}.`;
  const text =
    `${human} Reason: ${input.reason || "none given"}.` +
    (input.signals?.length ? ` Risk signals at the time: ${input.signals.join("; ")}.` : "") +
    `\n${TAG} ${JSON.stringify({ kind, address: subject, verdict: input.verdict, reason: input.reason, label: input.label, at })}`;

  const res = await memwal().rememberAndWait(text, NAMESPACE);
  return { blobId: res.blob_id, id: res.id, at };
}

export async function rememberSend(input: { to: string; amount: string; symbol: string; digest: string }) {
  const at = new Date().toISOString();
  const to = input.to.toLowerCase();
  const text =
    `The user sent ${input.amount} ${input.symbol} to Sui address ${to} (transaction ${input.digest}). The send succeeded.` +
    `\n${SEND_TAG} ${JSON.stringify({ ...input, to, at })}`;
  const res = await memwal().rememberAndWait(text, NAMESPACE);
  return { blobId: res.blob_id, at };
}

function parseTail<T>(text: string, tag: string, blobId: string): (T & { blobId: string }) | null {
  const i = text.indexOf(tag + " ");
  if (i === -1) return null;
  try {
    return { ...JSON.parse(text.slice(i + tag.length).trim()), blobId };
  } catch {
    return null;
  }
}

/** Everything the guard remembers. Verdicts de-duplicated so the latest per subject wins. */
export async function recallAll(query = "Sui addresses and tokens the user trusted or blocked, and past sends") {
  const res = await memwal().recall({ query, limit: 100, namespace: NAMESPACE });
  const verdicts = res.results
    .map((r) => parseTail<Omit<VerdictMemory, "blobId">>(r.text, TAG, r.blob_id))
    .filter((v): v is VerdictMemory => v !== null)
    .map((v) => ({ ...v, kind: v.kind ?? "address" }))
    .sort((a, b) => b.at.localeCompare(a.at));
  const sends = res.results
    .map((r) => parseTail<Omit<SendMemory, "blobId">>(r.text, SEND_TAG, r.blob_id))
    .filter((v): v is SendMemory => v !== null)
    .sort((a, b) => b.at.localeCompare(a.at));

  const latest = new Map<string, VerdictMemory>();
  for (const v of verdicts) {
    const k = `${v.kind}:${v.address}`;
    if (!latest.has(k)) latest.set(k, v);
  }
  return { latest: [...latest.values()], history: verdicts, sends };
}

// Back-compat for earlier callers.
export const recallVerdicts = recallAll;
