import { NextResponse } from "next/server";
import { getAiWorkerUrl } from "@/lib/server";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const upstream = await fetch(`${getAiWorkerUrl()}/api/jobs/${encodeURIComponent(id)}`, {
    cache: "no-store"
  });

  const payload = await upstream.json().catch(() => ({}));
  return NextResponse.json(payload, { status: upstream.status });
}
