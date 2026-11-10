import { recallVerdicts, NAMESPACE } from "@/lib/memory";

export async function GET() {
  try {
    const { latest, history } = await recallVerdicts();
    return Response.json({ namespace: NAMESPACE, latest, historyCount: history.length });
  } catch (e) {
    return Response.json({ error: (e as Error).message, latest: [] }, { status: 502 });
  }
}
