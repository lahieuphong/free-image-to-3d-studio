import { getAiWorkerUrl } from "@/lib/server";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const upstream = await fetch(`${getAiWorkerUrl()}/api/jobs/${encodeURIComponent(id)}/model.glb`, {
    cache: "no-store"
  });

  if (!upstream.ok || !upstream.body) {
    return new Response("Model chưa sẵn sàng hoặc không tồn tại.", { status: upstream.status });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "model/gltf-binary",
      "Content-Disposition": `attachment; filename="${id}.glb"`,
      "Cache-Control": "no-store"
    }
  });
}
