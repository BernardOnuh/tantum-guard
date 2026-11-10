import { getAddressProfile, isSuiAddress } from "@/lib/tatum";
import { recallVerdicts } from "@/lib/memory";
import { assess, findLookalike } from "@/lib/risk";

export async function POST(req: Request) {
  const { address: raw } = (await req.json()) as { address?: string };
  const address = (raw ?? "").trim().toLowerCase();
  if (!isSuiAddress(address))
    return Response.json({ error: "Enter a full Sui address (0x + 64 hex characters)." }, { status: 400 });

  const [profileRes, memRes] = await Promise.allSettled([
    getAddressProfile(address),
    recallVerdicts(`Has the user trusted or blocked Sui address ${address}?`),
  ]);

  const profile = profileRes.status === "fulfilled" ? profileRes.value : null;
  const mem = memRes.status === "fulfilled" ? memRes.value : { latest: [], history: [] };
  const own = mem.latest.find((v) => v.address === address);
  const lookalike = findLookalike(address, mem.latest.filter((v) => v.verdict === "trust"));
  const { level, signals } = assess(address, profile, { own, lookalike });

  return Response.json({
    address,
    level,
    signals,
    profile,
    memory: { own: own ?? null, lookalike: lookalike ?? null },
    errors: {
      chain: profileRes.status === "rejected" ? String(profileRes.reason?.message ?? profileRes.reason) : null,
      memory: memRes.status === "rejected" ? String(memRes.reason?.message ?? memRes.reason) : null,
    },
  });
}
