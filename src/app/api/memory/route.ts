import { recallAll, NAMESPACE } from "@/lib/memory";

export async function GET() {
  try {
    const { latest, history, sends } = await recallAll();
    return Response.json({ namespace: NAMESPACE, latest, sends: sends.slice(0, 10), historyCount: history.length });
  } catch (e) {
    return Response.json({ error: (e as Error).message, latest: [] }, { status: 502 });
  }
}
