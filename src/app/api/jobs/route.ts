import { NextResponse } from "next/server";
import { assertImageFile, getAiWorkerUrl } from "@/lib/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const incoming = await request.formData();
    const file = incoming.get("image");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Thiếu file ảnh." }, { status: 400 });
    }

    assertImageFile(file);

    const form = new FormData();
    form.append("image", file, file.name);

    for (const key of ["texture_resolution", "remesh_option", "target_vertex_count", "foreground_ratio"]) {
      const value = incoming.get(key);
      if (typeof value === "string") form.append(key, value);
    }

    const upstream = await fetch(`${getAiWorkerUrl()}/api/jobs`, {
      method: "POST",
      body: form,
      cache: "no-store"
    });

    const payload = await upstream.json().catch(() => ({}));
    return NextResponse.json(payload, { status: upstream.status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không tạo được job." },
      { status: 500 }
    );
  }
}
