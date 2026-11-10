import { getAddressProfile, isSuiAddress } from "@/lib/tatum";
import { recallAll } from "@/lib/memory";
import { assess, findLookalike } from "@/lib/risk";

export async function POST(req: Request) {
  const { address: raw } = (await req.json()) as { address?: string };
  const address = (raw ?? "").trim().toLowerCase();
  if (!isSuiAddress(address))
    return Response.json({ error: "Enter a full Sui address (0x + 64 hex characters)." }, { status: 400 });

  const [profileRes, memRes] = await Promise.allSettled([
    getAddressProfile(address),
    recallAll(`Has the user trusted, blocked or sent funds to Sui address ${address}?`),
  ]);

  const profile = profileRes.status === "fulfilled" ? profileRes.value : null;
  const mem = memRes.status === "fulfilled" ? memRes.value : { latest: [], history: [], sends: [] };
  const addrVerdicts = mem.latest.filter((v) => v.kind === "address");
  const pastSends = mem.sends.filter((s) => s.to === address);
  const own = addrVerdicts.find((v) => v.address === address);
  const lookalike = findLookalike(address, addrVerdicts.filter((v) => v.verdict === "trust"));
  const { level, signals } = assess(address, profile, { own, lookalike, sendCount: pastSends.length });

  return Response.json({
    address,
    level,
    signals,
    profile,
    memory: { own: own ?? null, lookalike: lookalike ?? null, sends: pastSends.slice(0, 5) },
    errors: {
      chain: profileRes.status === "rejected" ? String(profileRes.reason?.message ?? profileRes.reason) : null,
      memory: memRes.status === "rejected" ? String(memRes.reason?.message ?? memRes.reason) : null,
    },
  });
}
