import "server-only";

// Tatum's Sui Mainnet gateway exposes Sui GraphQL. All chain reads go through Tatum.
const TATUM_SUI_GRAPHQL =
  process.env.TATUM_SUI_GRAPHQL_URL ?? "https://sui-mainnet.gateway.tatum.io/graphql";

// The gateway prunes old history; queries reaching below the lowest retained checkpoint fail.
// We start from a known-safe floor and learn the real one from the error if it moves.
let historyFloor = Number(process.env.TATUM_SUI_HISTORY_FLOOR ?? 237_700_000);

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const key = process.env.TATUM_API_KEY;
  if (!key) throw new Error("TATUM_API_KEY is not set");
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(TATUM_SUI_GRAPHQL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });
    if (res.status !== 429 || attempt >= 4) break;
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1) + Math.random() * 300));
  }
  if (!res.ok) throw new Error(`Tatum GraphQL failed: HTTP ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string; extensions?: { chain?: string[] } }[] };
  if (json.errors?.length) {
    const detail = json.errors.map((e) => [e.message, ...(e.extensions?.chain ?? [])].join(": ")).join(" | ");
    throw Object.assign(new Error(`Tatum GraphQL: ${detail}`), { detail });
  }
  return json.data as T;
}

const PROFILE_QUERY = `
query Profile($a: SuiAddress!, $floor: UInt53!) {
  address(address: $a) {
    sui: balance(coinType: "0x2::sui::SUI") { totalBalance }
    balances(first: 50) { nodes { coinType { repr } } }
    sent: transactions(last: 50, relation: SENT, filter: { afterCheckpoint: $floor }) {
      pageInfo { hasPreviousPage }
      nodes { effects { timestamp } }
    }
    affected: transactions(last: 50, relation: AFFECTED, filter: { afterCheckpoint: $floor }) {
      pageInfo { hasPreviousPage }
      nodes { sender { address } effects { timestamp } }
    }
    oldest: transactions(first: 1, relation: AFFECTED, filter: { afterCheckpoint: $floor }) {
      nodes { effects { timestamp } }
    }
    asObject { address }
    defaultNameRecord { domain }
  }
}`;

type TxConn = {
  pageInfo?: { hasPreviousPage: boolean };
  nodes: { sender?: { address: string } | null; effects?: { timestamp?: string | null } | null }[];
};

type ProfileData = {
  address: {
    sui: { totalBalance: string } | null;
    balances: { nodes: unknown[] };
    sent: TxConn;
    affected: TxConn;
    oldest: TxConn;
    asObject: { address: string } | null;
    defaultNameRecord: { domain: string } | null;
  } | null;
};

export type AddressProfile = {
  address: string;
  sentCount: number; // capped at 50
  sentMore: boolean;
  receivedCount: number; // txs that touched this address but were sent by someone else
  receivedMore: boolean;
  firstSeenMs: number | null; // oldest activity within the gateway's retained history
  lastActiveMs: number | null;
  suiBalance: number; // in SUI
  coinTypes: number;
  isPackageOrObject: boolean;
  suinsName: string | null;
};

export function isSuiAddress(a: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(a);
}

async function fetchProfile(address: string) {
  try {
    return await gql<ProfileData>(PROFILE_QUERY, { a: address, floor: historyFloor });
  } catch (e) {
    const m = /lowest available checkpoint is (\d+)/.exec((e as { detail?: string }).detail ?? "");
    if (!m) throw e;
    historyFloor = Number(m[1]) + 1000; // pruning moved; adopt new floor and retry once
    return gql<ProfileData>(PROFILE_QUERY, { a: address, floor: historyFloor });
  }
}

export async function getAddressProfile(address: string): Promise<AddressProfile> {
  const { address: d } = await fetchProfile(address);
  const ts = (c: TxConn) =>
    c.nodes.map((n) => Date.parse(n.effects?.timestamp ?? "")).filter((n) => Number.isFinite(n));

  if (!d) {
    return {
      address, sentCount: 0, sentMore: false, receivedCount: 0, receivedMore: false,
      firstSeenMs: null, lastActiveMs: null, suiBalance: 0, coinTypes: 0, isPackageOrObject: false, suinsName: null,
    };
  }

  const received = d.affected.nodes.filter((n) => n.sender?.address?.toLowerCase() !== address);
  const all = [...ts(d.sent), ...ts(d.affected)];
  const oldest = ts(d.oldest);

  return {
    address,
    sentCount: d.sent.nodes.length,
    sentMore: Boolean(d.sent.pageInfo?.hasPreviousPage),
    receivedCount: received.length,
    receivedMore: Boolean(d.affected.pageInfo?.hasPreviousPage),
    firstSeenMs: oldest.length ? oldest[0] : all.length ? Math.min(...all) : null,
    lastActiveMs: all.length ? Math.max(...all) : null,
    suiBalance: d.sui ? Number(d.sui.totalBalance) / 1e9 : 0,
    coinTypes: d.balances.nodes.length,
    isPackageOrObject: Boolean(d.asObject),
    suinsName: d.defaultNameRecord?.domain ?? null,
  };
}

// ---------- Tokens ----------

const TOKEN_QUERY = `
query Token($t: String!) {
  coinMetadata(coinType: $t) {
    name symbol decimals iconUrl description supply
  }
}`;

const PKG_QUERY = `
query Pkg($p: SuiAddress!) {
  package(address: $p) { previousTransaction { effects { timestamp } } }
}`;

export type TokenProfile = {
  coinType: string;
  found: boolean;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  iconUrl: string | null;
  supply: string | null;
  publishedMs: number | null;
};

export function isCoinType(t: string) {
  return /^0x[0-9a-fA-F]{1,64}::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*$/.test(t.trim());
}

export async function getTokenProfile(coinType: string): Promise<TokenProfile> {
  const t = coinType.trim();
  const [meta, pkg] = await Promise.all([
    gql<{ coinMetadata: null | { name: string; symbol: string; decimals: number; iconUrl: string | null; supply: string | null } }>(
      TOKEN_QUERY,
      { t },
    ),
    gql<{ package: null | { previousTransaction: null | { effects: null | { timestamp: string | null } } } }>(PKG_QUERY, {
      p: t.split("::")[0],
    }).catch(() => ({ package: null })),
  ]);
  const m = meta.coinMetadata;
  const ts = Date.parse(pkg.package?.previousTransaction?.effects?.timestamp ?? "");
  return {
    coinType: t,
    found: Boolean(m),
    name: m?.name ?? null,
    symbol: m?.symbol ?? null,
    decimals: m?.decimals ?? null,
    iconUrl: m?.iconUrl ?? null,
    supply: m?.supply ?? null,
    publishedMs: Number.isFinite(ts) ? ts : null,
  };
}

// ---------- Wallet activity (EOA history) ----------

const ACTIVITY_QUERY_FOR = (rel: "AFFECTED" | "SENT") => `
query Activity($a: SuiAddress!, $floor: UInt53!, $n: Int!) {
  address(address: $a) {
    transactions(last: $n, relation: ${rel}, filter: { afterCheckpoint: $floor }) {
      nodes {
        digest
        sender { address }
        effects {
          timestamp
          status
          balanceChanges(first: 20) { nodes { owner { address } coinType { repr } amount } }
        }
      }
    }
  }
}`;

export type ActivityItem = {
  digest: string;
  timestampMs: number | null;
  ok: boolean;
  kind: "sent" | "received" | "swap" | "call";
  counterparty: string | null;
  changes: { coinType: string; amount: string }[]; // this address only, gas folded out where obvious
};

const SUI_FULL = "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI";
const GAS_DUST = BigInt(50_000_000); // ≤0.05 SUI outflow alongside other changes is treated as gas

type ActivityData = {
  address: null | {
    transactions: {
      nodes: {
        digest: string;
        sender: { address: string } | null;
        effects: null | {
          timestamp: string | null;
          status: string;
          balanceChanges: { nodes: { owner: { address: string } | null; coinType: { repr: string }; amount: string }[] };
        };
      }[];
    };
  };
};

export async function getActivity(address: string, n = 8, rel: "AFFECTED" | "SENT" = "AFFECTED"): Promise<ActivityItem[]> {
  const ACTIVITY_QUERY = ACTIVITY_QUERY_FOR(rel);
  let data: ActivityData;
  try {
    data = await gql<ActivityData>(ACTIVITY_QUERY, { a: address, floor: historyFloor, n });
  } catch (e) {
    const m = /lowest available checkpoint is (\d+)/.exec((e as { detail?: string }).detail ?? "");
    if (!m) throw e;
    historyFloor = Number(m[1]) + 1000;
    data = await gql<ActivityData>(ACTIVITY_QUERY, { a: address, floor: historyFloor, n });
  }
  const nodes = data.address?.transactions.nodes ?? [];
  return nodes
    .map((t): ActivityItem => {
      const all = t.effects?.balanceChanges.nodes ?? [];
      let mine = all
        .filter((b) => b.owner?.address === address)
        .map((b) => ({ coinType: b.coinType.repr, amount: b.amount }));
      const isSender = t.sender?.address === address;
      // Fold gas: a tiny SUI outflow next to other movements is just the fee.
      // Only fold when another outflow remains (e.g. sending a token); a SUI outflow next to only inflows is a buy.
      const isDust = (c: { coinType: string; amount: string }) =>
        c.coinType === SUI_FULL && BigInt(c.amount) < BigInt(0) && -BigInt(c.amount) <= GAS_DUST;
      if (isSender && mine.some((c) => !isDust(c) && BigInt(c.amount) < BigInt(0))) mine = mine.filter((c) => !isDust(c));
      const pos = mine.filter((c) => BigInt(c.amount) > BigInt(0));
      const neg = mine.filter((c) => BigInt(c.amount) < BigInt(0));
      let kind: ActivityItem["kind"] = "call";
      let counterparty: string | null = null;
      if (pos.length && neg.length) kind = "swap";
      else if (neg.length && isSender) {
        const recv = all.find((b) => b.owner?.address && b.owner.address !== address && BigInt(b.amount) > BigInt(0));
        // Only call it a send if a wallet-like owner received funds; otherwise it's a contract interaction.
        kind = recv ? "sent" : "call";
        counterparty = recv?.owner?.address ?? null;
      } else if (pos.length && !isSender) {
        kind = "received";
        counterparty = t.sender?.address ?? null;
      } else if (pos.length) kind = "call";
      const ts = Date.parse(t.effects?.timestamp ?? "");
      return {
        digest: t.digest,
        timestampMs: Number.isFinite(ts) ? ts : null,
        ok: t.effects?.status === "SUCCESS",
        kind,
        counterparty,
        changes: mine,
      };
    })
    .sort((a, b) => (b.timestampMs ?? 0) - (a.timestampMs ?? 0));
}

/** Symbol/decimals/icon for up to ~10 coin types in one Tatum request. */
export async function getCoinMetas(types: string[]) {
  const uniq = [...new Set(types)].slice(0, 10);
  if (!uniq.length) return {} as Record<string, { symbol: string; decimals: number; iconUrl: string | null }>;
  const q = `query(${uniq.map((_, i) => `$t${i}: String!`).join(", ")}) {${uniq
    .map((_, i) => ` m${i}: coinMetadata(coinType: $t${i}) { symbol decimals iconUrl }`)
    .join("")} }`;
  const vars = Object.fromEntries(uniq.map((t, i) => [`t${i}`, t]));
  const d = await gql<Record<string, { symbol: string; decimals: number; iconUrl: string | null } | null>>(q, vars);
  const out: Record<string, { symbol: string; decimals: number; iconUrl: string | null }> = {};
  uniq.forEach((t, i) => {
    const m = d[`m${i}`];
    if (m) out[t] = { symbol: m.symbol, decimals: m.decimals, iconUrl: m.iconUrl && m.iconUrl.length < 3000 ? m.iconUrl : null };
  });
  return out;
}
