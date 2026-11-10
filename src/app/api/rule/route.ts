import { rememberRule, type RuleAction } from "@/lib/memory";
import { isSuiAddress } from "@/lib/tatum";

export async function POST(req: Request) {
  const b = (await req.json()) as { to?: string; coinType?: string; symbol?: string; action?: RuleAction; cap?: string; capRaw?: string; label?: string };
  if (!b.to || !isSuiAddress(b.to.toLowerCase()) || !b.coinType || !b.action || !["keep", "cancel", "cap"].includes(b.action))
    return Response.json({ error: "Missing recipient, token or action." }, { status: 400 });
  if (b.action === "cap" && !(b.capRaw && /^\d+$/.test(b.capRaw))) return Response.json({ error: "Enter a cap amount." }, { status: 400 });
  try {
    const r = await rememberRule({ to: b.to, coinType: b.coinType, symbol: b.symbol ?? "token", action: b.action, cap: b.cap, capRaw: b.capRaw, label: b.label });
    return Response.json(r);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
