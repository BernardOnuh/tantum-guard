import { getActivity, getAddressProfile, getCoinMetas, isSuiAddress } from "@/lib/tatum";
import { recallAll } from "@/lib/memory";
import { assess, findLookalike } from "@/lib/risk";

export async function POST(req: Request) {
  const { address: raw } = (await req.json()) as { address?: string };
  const address = (raw ?? "").trim().toLowerCase();
  if (!isSuiAddress(address))
    return Response.json({ error: "Enter a full Sui address (0x + 64 hex characters)." }, { status: 400 });

  const [profileRes, memRes, actRes] = await Promise.allSettled([
    getAddressProfile(address),
    recallAll(`Has the user trusted, blocked or sent funds to Sui address ${address}?`),
    getActivity(address, 8),
  ]);

  const profile = profileRes.status === "fulfilled" ? profileRes.value : null;
  const activity = actRes.status === "fulfilled" ? actRes.value : [];
  const coinMeta = await getCoinMetas(activity.flatMap((a) => a.changes.map((c) => c.coinType))).catch(() => ({}));
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
    activity,
    coinMeta,
    memory: { own: own ?? null, lookalike: lookalike ?? null, sends: pastSends.slice(0, 5) },
    errors: {
      chain: profileRes.status === "rejected" ? String(profileRes.reason?.message ?? profileRes.reason) : null,
      memory: memRes.status === "rejected" ? String(memRes.reason?.message ?? memRes.reason) : null,
    },
  });
}
