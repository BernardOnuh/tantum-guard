import { isSuiAddress } from "@/lib/tatum";
import { rememberSend } from "@/lib/memory";

export const maxDuration = 120;

export async function POST(req: Request) {
  const b = (await req.json()) as { to?: string; amount?: string; symbol?: string; digest?: string };
  if (!b.to || !isSuiAddress(b.to) || !b.digest) return Response.json({ error: "bad request" }, { status: 400 });
  try {
    const saved = await rememberSend({
      to: b.to,
      amount: String(b.amount ?? "").slice(0, 40),
      symbol: String(b.symbol ?? "").slice(0, 20),
      digest: b.digest.slice(0, 100),
    });
    return Response.json({ ok: true, ...saved });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
