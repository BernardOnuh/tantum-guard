import { isCoinType, isSuiAddress } from "@/lib/tatum";
import { rememberVerdict, type SubjectKind, type Verdict } from "@/lib/memory";

export const maxDuration = 120;

export async function POST(req: Request) {
  const body = (await req.json()) as {
    kind?: SubjectKind;
    address?: string;
    verdict?: Verdict;
    reason?: string;
    label?: string;
    signals?: string[];
  };
  const kind: SubjectKind = body.kind === "token" ? "token" : "address";
  const address = kind === "address" ? (body.address ?? "").trim().toLowerCase() : (body.address ?? "").trim();
  if (kind === "address" ? !isSuiAddress(address) : !isCoinType(address))
    return Response.json({ error: kind === "address" ? "Invalid Sui address" : "Invalid coin type" }, { status: 400 });
  if (body.verdict !== "trust" && body.verdict !== "block")
    return Response.json({ error: "verdict must be trust or block" }, { status: 400 });

  try {
    const saved = await rememberVerdict({
      kind,
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
