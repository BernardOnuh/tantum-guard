import { isSuiAddress } from "@/lib/tatum";
import { rememberVerdict, type Verdict } from "@/lib/memory";

export const maxDuration = 120;

export async function POST(req: Request) {
  const body = (await req.json()) as {
    address?: string;
    verdict?: Verdict;
    reason?: string;
    label?: string;
    signals?: string[];
  };
  const address = (body.address ?? "").trim().toLowerCase();
  if (!isSuiAddress(address)) return Response.json({ error: "Invalid Sui address" }, { status: 400 });
  if (body.verdict !== "trust" && body.verdict !== "block")
    return Response.json({ error: "verdict must be trust or block" }, { status: 400 });

  try {
    const saved = await rememberVerdict({
      address,
      verdict: body.verdict,
      reason: (body.reason ?? "").slice(0, 280),
      label: body.label?.slice(0, 40) || undefined,
      signals: body.signals?.slice(0, 6),
    });
    return Response.json({ ok: true, ...saved });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
