import { Aftermath } from "aftermath-ts-sdk";
import { normalizeStructTag } from "@mysten/sui/utils";

export const maxDuration = 60;

export type ListedToken = {
  type: string;
  symbol: string;
  name: string;
  decimals: number;
  iconUrl: string | null;
  price: number | null;
  verified: boolean;
};

// Popular tokens pinned to the top, in this order.
const PINNED = [
  "0x2::sui::SUI",
  "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
  "0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL",
  "0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP",
  "0x5145494a5f5100e645e4b0aa950fa6b68f614e8c59e17bc5ded3495123a79178::ns::NS",
  "0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS",
].map((t) => normalizeStructTag(t));

let af: Promise<Aftermath> | null = null;
const aftermath = () => (af ??= Aftermath.create({ network: "MAINNET" }).catch((e) => ((af = null), Promise.reject(e))));

// Some tokens inline multi-KB data: URIs as icons; keep the list light.
const cleanIcon = (u?: string | null) =>
  !u ? null : u.startsWith("data:") ? (u.length < 3000 ? u : null) : /^https?:\/\//.test(u) ? u : null;

let cache: { at: number; tokens: ListedToken[] } | null = null;
let inflight: Promise<ListedToken[]> | null = null;
const TTL = 10 * 60_000;

async function build(): Promise<ListedToken[]> {
  const a = await aftermath();
  const verified = [...new Set([...PINNED, ...(await a.Coin().getVerifiedCoins()).map((t) => normalizeStructTag(t))])];
  const chunks: string[][] = [];
  for (let i = 0; i < verified.length; i += 50) chunks.push(verified.slice(i, i + 50));
  const [metas, prices] = await Promise.all([
    Promise.all(chunks.map((c) => a.Coin().getCoinMetadatas({ coins: c }).catch(() => c.map(() => null)))),
    a.Prices().getCoinsToPrice({ coins: verified }).catch(() => ({}) as Record<string, number>),
  ]);
  const priceMap = new Map(Object.entries(prices).map(([k, v]) => [normalizeStructTag(k), v]));
  const flat = metas.flat();
  const out: ListedToken[] = [];
  verified.forEach((type, i) => {
    const m = flat[i];
    if (!m) return;
    const p = priceMap.get(type);
    out.push({
      type,
      symbol: m.symbol,
      name: m.name,
      decimals: m.decimals,
      iconUrl: cleanIcon(m.iconUrl),
      price: typeof p === "number" && p > 0 ? p : null,
      verified: true,
    });
  });
  const rank = (t: ListedToken) => {
    const i = PINNED.indexOf(t.type);
    return i === -1 ? 100 : i;
  };
  return out.sort((x, y) => rank(x) - rank(y) || (y.price ? 1 : 0) - (x.price ? 1 : 0) || x.symbol.localeCompare(y.symbol));
}

export async function GET() {
  if (!cache || Date.now() - cache.at > TTL) {
    inflight ??= build().finally(() => (inflight = null));
    try {
      cache = { at: Date.now(), tokens: await inflight };
    } catch (e) {
      if (!cache) return Response.json({ error: (e as Error).message, tokens: [] }, { status: 502 });
    }
  }
  return Response.json({ tokens: cache.tokens }, { headers: { "cache-control": "public, max-age=300" } });
}
