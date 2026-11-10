import "server-only";

// Tatum RPC gateway for Sui Mainnet. All chain reads go through Tatum.
const TATUM_SUI_URL =
  process.env.TATUM_SUI_RPC_URL ?? "https://sui-mainnet.gateway.tatum.io";

let rpcId = 0;

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const key = process.env.TATUM_API_KEY;
  if (!key) throw new Error("TATUM_API_KEY is not set");
  const res = await fetch(TATUM_SUI_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Tatum ${method} failed: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`Tatum ${method}: ${json.error.message}`);
  return json.result as T;
}

type TxPage = {
  data: { digest: string; timestampMs?: string }[];
  hasNextPage: boolean;
  nextCursor: string | null;
};

type Balance = { coinType: string; totalBalance: string };

export type AddressProfile = {
  address: string;
  sentCount: number; // capped at PAGE
  sentMore: boolean;
  receivedCount: number;
  receivedMore: boolean;
  firstSeenMs: number | null;
  lastActiveMs: number | null;
  suiBalance: number; // in SUI
  coinTypes: number;
  isPackageOrObject: boolean;
};

const PAGE = 50;

function txQuery(filter: Record<string, string>, descending: boolean, limit = PAGE) {
  return rpc<TxPage>("suix_queryTransactionBlocks", [
    { filter, options: {} },
    null,
    limit,
    descending,
  ]);
}

export function isSuiAddress(a: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(a);
}

export async function getAddressProfile(address: string): Promise<AddressProfile> {
  const [sent, received, firstSent, firstRecv, balances, obj] = await Promise.all([
    txQuery({ FromAddress: address }, true),
    txQuery({ ToAddress: address }, true),
    txQuery({ FromAddress: address }, false, 1),
    txQuery({ ToAddress: address }, false, 1),
    rpc<Balance[]>("suix_getAllBalances", [address]),
    rpc<{ data?: unknown }>("sui_getObject", [address, { showType: true }]).catch(
      () => ({}) as { data?: unknown },
    ),
  ]);

  const ts = (p: TxPage) =>
    p.data.map((t) => Number(t.timestampMs)).filter((n) => Number.isFinite(n) && n > 0);
  const firstCandidates = [...ts(firstSent), ...ts(firstRecv)];
  const lastCandidates = [...ts(sent).slice(0, 1), ...ts(received).slice(0, 1)];
  const sui = balances.find((b) => b.coinType === "0x2::sui::SUI");

  return {
    address,
    sentCount: sent.data.length,
    sentMore: sent.hasNextPage,
    receivedCount: received.data.length,
    receivedMore: received.hasNextPage,
    firstSeenMs: firstCandidates.length ? Math.min(...firstCandidates) : null,
    lastActiveMs: lastCandidates.length ? Math.max(...lastCandidates) : null,
    suiBalance: sui ? Number(sui.totalBalance) / 1e9 : 0,
    coinTypes: balances.length,
    isPackageOrObject: Boolean(obj && "data" in obj && obj.data),
  };
}
