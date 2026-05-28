import { NextResponse } from "next/server";
import { assertImageFile, getAiWorkerUrl } from "@/lib/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const incoming = await request.formData();
    const primaryFile = incoming.get("image_front") ?? incoming.get("image");

    if (!(primaryFile instanceof File)) {
      return NextResponse.json({ error: "Thiếu file ảnh." }, { status: 400 });
    }

    assertImageFile(primaryFile);

    const form = new FormData();
    form.append("image", primaryFile, primaryFile.name);

    for (const key of ["image_front", "image_left", "image_right", "image_back", "image_top", "image_bottom"]) {
      const value = incoming.get(key);
      if (value instanceof File) {
        assertImageFile(value);
        form.append(key, value, value.name);
      }
    }

    for (const key of [
      "texture_resolution",
      "remesh_option",
      "target_vertex_count",
      "foreground_ratio",
      "drop_lower_ratio",
      "tripo_quality",
      "instantmesh_config",
      "view_mode",
      "provider_choice",
    ]) {
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
