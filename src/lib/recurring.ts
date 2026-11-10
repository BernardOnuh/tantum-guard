import type { ActivityItem } from "./tatum";

const DAY = 86_400_000;

export type RecurringPayment = {
  to: string;
  coinType: string;
  count: number;
  totalRaw: string;
  avgRaw: string;
  lastRaw: string;
  firstMs: number;
  lastMs: number;
  intervalDays: number | null; // median gap between payments
  regular: boolean; // gaps are consistent (looks like a subscription / salary / rent)
  nextExpectedMs: number | null;
  digests: string[];
};

/** Repeating outgoing payments: same recipient + same token, sent 2+ times. */
export function detectRecurring(activity: ActivityItem[]): RecurringPayment[] {
  const groups = new Map<string, { to: string; coinType: string; items: { ms: number; raw: bigint; digest: string }[] }>();
  for (const a of activity) {
    if (a.kind !== "sent" || !a.ok || !a.counterparty || !a.timestampMs) continue;
    for (const c of a.changes) {
      const raw = -BigInt(c.amount);
      if (raw <= BigInt(0)) continue;
      const k = `${a.counterparty}|${c.coinType}`;
      const g = groups.get(k) ?? { to: a.counterparty, coinType: c.coinType, items: [] };
      g.items.push({ ms: a.timestampMs, raw, digest: a.digest });
      groups.set(k, g);
    }
  }
  const out: RecurringPayment[] = [];
  for (const g of groups.values()) {
    if (g.items.length < 2) continue;
    const items = g.items.sort((x, y) => x.ms - y.ms);
    const gaps = items.slice(1).map((it, i) => it.ms - items[i].ms).sort((x, y) => x - y);
    const median = gaps[Math.floor(gaps.length / 2)];
    const spread = gaps.length > 1 ? (gaps[gaps.length - 1] - gaps[0]) / Math.max(median, 1) : 0;
    const total = items.reduce((s, it) => s + it.raw, BigInt(0));
    const last = items[items.length - 1];
    out.push({
      to: g.to,
      coinType: g.coinType,
      count: items.length,
      totalRaw: total.toString(),
      avgRaw: (total / BigInt(items.length)).toString(),
      lastRaw: last.raw.toString(),
      firstMs: items[0].ms,
      lastMs: last.ms,
      intervalDays: median ? +(median / DAY).toFixed(median < DAY ? 2 : 1) : null,
      regular: items.length >= 3 && spread < 0.5,
      nextExpectedMs: median ? last.ms + median : null,
      digests: items.map((i) => i.digest).reverse(),
    });
  }
  return out.sort((a, b) => b.count - a.count || b.lastMs - a.lastMs);
}
