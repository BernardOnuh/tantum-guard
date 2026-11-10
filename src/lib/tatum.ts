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
