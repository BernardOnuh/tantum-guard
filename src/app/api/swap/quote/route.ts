import { Aftermath } from "aftermath-ts-sdk";
import { isCoinType, isSuiAddress } from "@/lib/tatum";

export const maxDuration = 60;

let af: Promise<Aftermath> | null = null;
const aftermath = () => (af ??= Aftermath.create({ network: "MAINNET" }).catch((e) => ((af = null), Promise.reject(e))));

const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));

export async function POST(req: Request) {
  const b = (await req.json()) as { coinIn?: string; coinOut?: string; amountIn?: string; slippage?: number; wallet?: string };
  if (!b.coinIn || !b.coinOut || !isCoinType(b.coinIn) || !isCoinType(b.coinOut))
    return Response.json({ error: "Pick two valid tokens" }, { status: 400 });
  if (b.coinIn === b.coinOut) return Response.json({ error: "Pick two different tokens" }, { status: 400 });
  if (!b.amountIn || !/^\d+$/.test(b.amountIn) || BigInt(b.amountIn) <= BigInt(0))
    return Response.json({ error: "Enter an amount" }, { status: 400 });
  if (!b.wallet || !isSuiAddress(b.wallet)) return Response.json({ error: "Connect a wallet first" }, { status: 400 });
  const slippage = Math.min(Math.max(Number(b.slippage ?? 0.01), 0.0005), 0.2);

  try {
    const router = (await aftermath()).Router();
    const route = await router.getCompleteTradeRouteGivenAmountIn({
      coinInType: b.coinIn,
      coinOutType: b.coinOut,
      coinInAmount: BigInt(b.amountIn),
    });
    const tx = await router.getTransactionForCompleteTradeRoute({
      walletAddress: b.wallet,
      completeRoute: route,
      slippage,
    });
    const protocols = [
      ...new Set(route.routes.flatMap((r) => r.paths.map((p) => p.protocolName as string))),
    ];
    return Response.json({
      amountOut: route.coinOut.amount.toString(),
      spotPrice: route.spotPrice,
      feePct: route.netTradeFeePercentage,
      protocols,
      slippage,
      tx: await tx.toJSON(),
      route: json({ coinIn: route.coinIn, coinOut: route.coinOut }),
    });
  } catch (e) {
    return Response.json({ error: `No swap route: ${(e as Error).message}` }, { status: 502 });
  }
}
