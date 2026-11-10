// Proxies the browser wallet client's Sui GraphQL traffic to Tatum's Mainnet gateway,
// keeping the API key server-side. Coin selection, gas, simulation and balances in the
// browser all flow through Tatum.
const TATUM_SUI_GRAPHQL =
  process.env.TATUM_SUI_GRAPHQL_URL ?? "https://sui-mainnet.gateway.tatum.io/graphql";

export const maxDuration = 60;

export async function POST(req: Request) {
  const key = process.env.TATUM_API_KEY;
  if (!key) return Response.json({ errors: [{ message: "TATUM_API_KEY is not set" }] }, { status: 500 });
  const body = await req.text();

  // Free Tatum plans allow ~3 req/s; transaction building fans out, so back off on 429.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(TATUM_SUI_GRAPHQL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body,
      cache: "no-store",
    });
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1) + Math.random() * 300));
      continue;
    }
    return new Response(await res.text(), {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  }
}
