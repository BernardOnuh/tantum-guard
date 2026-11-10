import { getTokenProfile, isCoinType } from "@/lib/tatum";
import { recallAll } from "@/lib/memory";
import type { Level, Signal } from "@/lib/risk";
import { normalizeStructTag } from "@mysten/sui/utils";

const DAY = 86_400_000;
// Well-known Mainnet tokens; anything else gets extra scrutiny.
const KNOWN_RAW = [
  "0x2::sui::SUI",
  "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
  "0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL",
  "0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP",
  "0x5145494a5f5100e645e4b0aa950fa6b68f614e8c59e17bc5ded3495123a79178::ns::NS",
  "0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS",
];
const KNOWN = new Set(KNOWN_RAW.map((t) => normalizeStructTag(t)));

export async function POST(req: Request) {
  const { coinType: raw } = (await req.json()) as { coinType?: string };
  const input = (raw ?? "").trim();
  if (!isCoinType(input)) return Response.json({ error: "Enter a full coin type, like 0x…::module::SYMBOL" }, { status: 400 });
  const coinType = normalizeStructTag(input);

  const [tokenRes, memRes] = await Promise.allSettled([
    getTokenProfile(coinType),
    recallAll(`Has the user trusted or blocked the token ${coinType}?`),
  ]);
  const token = tokenRes.status === "fulfilled" ? tokenRes.value : null;
  const mem = memRes.status === "fulfilled" ? memRes.value : { latest: [] };
  const own = mem.latest.find((v) => v.kind === "token" && v.address === coinType);

  const signals: Signal[] = [];
  let level = "low" as Level;
  const bump = (l: Level) => {
    const r = { safe: 0, low: 1, medium: 2, high: 3, critical: 4 };
    if (r[l] > r[level]) level = l;
  };

  if (own?.verdict === "block") {
    signals.push({ level: "critical", source: "memory", text: `You blocked this token on ${own.at.slice(0, 10)}: "${own.reason}"` });
    bump("critical");
  }
  if (KNOWN.has(coinType)) signals.push({ level: "safe", source: "chain", text: "This is a well-known Sui Mainnet token." });
  if (token) {
    if (!token.found) {
      signals.push({ level: "high", source: "chain", text: "No coin metadata was found onchain. This may not be a real token." });
      bump("high");
    }
    if (token.publishedMs && Date.now() - token.publishedMs < 14 * DAY && !KNOWN.has(coinType)) {
      signals.push({ level: "medium", source: "chain", text: `Token package published ${Math.max(1, Math.round((Date.now() - token.publishedMs) / DAY))} day(s) ago.` });
      bump("medium");
    }
    // Symbol impersonation: unknown token reusing a famous ticker.
    const famous = ["SUI", "USDC", "WAL", "DEEP", "NS", "CETUS"];
    if (token.symbol && famous.includes(token.symbol.toUpperCase()) && !KNOWN.has(coinType)) {
      signals.push({ level: "critical", source: "chain", text: `Uses the ticker "${token.symbol}" but is NOT the official ${token.symbol} token. This is a likely impersonation.` });
      bump("critical");
    }
  }
  if (own?.verdict === "trust" && level !== "critical") {
    signals.unshift({ level: "safe", source: "memory", text: `You trusted this token on ${own.at.slice(0, 10)}.` });
    level = "safe";
  } else if (KNOWN.has(coinType) && level === "low") level = "safe";

  return Response.json({
    coinType,
    level,
    signals,
    token,
    memory: { own: own ?? null },
    errors: {
      chain: tokenRes.status === "rejected" ? String((tokenRes.reason as Error)?.message ?? tokenRes.reason) : null,
      memory: memRes.status === "rejected" ? String((memRes.reason as Error)?.message ?? memRes.reason) : null,
    },
  });
}
