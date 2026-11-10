import { getActivity, getCoinMetas, isSuiAddress } from "@/lib/tatum";
import { recallAll } from "@/lib/memory";
import { detectRecurring } from "@/lib/recurring";

export async function POST(req: Request) {
  const { address: raw } = (await req.json()) as { address?: string };
  const address = (raw ?? "").trim().toLowerCase();
  if (!isSuiAddress(address)) return Response.json({ error: "Enter a full Sui address (0x + 64 hex characters)." }, { status: 400 });

  const [actRes, memRes] = await Promise.allSettled([
    getActivity(address, 50, "SENT"),
    recallAll("Recurring payments the user kept, cancelled or capped, and addresses the user trusted or blocked"),
  ]);
  if (actRes.status === "rejected") return Response.json({ error: `Couldn't read wallet history via Tatum: ${actRes.reason?.message ?? actRes.reason}` }, { status: 502 });
  const activity = actRes.value;
  const recurring = detectRecurring(activity);
  const coinMeta = await getCoinMetas(recurring.map((r) => r.coinType)).catch(() => ({}));
  const mem = memRes.status === "fulfilled" ? memRes.value : { rules: [], latest: [] };
  const labels = Object.fromEntries(mem.latest.filter((v) => v.kind === "address").map((v) => [v.address, { label: v.label ?? null, verdict: v.verdict }]));
  return Response.json({
    address,
    scanned: activity.length,
    sentCount: activity.filter((a) => a.kind === "sent").length,
    recurring,
    coinMeta,
    rules: mem.rules,
    labels,
    memoryError: memRes.status === "rejected" ? String(memRes.reason?.message ?? memRes.reason) : null,
  });
}
