export function getAiWorkerUrl() {
  const raw = process.env.AI_WORKER_URL ?? "http://localhost:8000";
  return raw.replace(/\/$/, "");
}

export function assertImageFile(file: File) {
  const maxMb = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? "20");
  const maxBytes = maxMb * 1024 * 1024;
  const allowed = new Set(["image/png", "image/jpeg", "image/webp"]);

  if (!allowed.has(file.type)) {
    throw new Error("Chỉ hỗ trợ PNG, JPG, JPEG hoặc WEBP.");
  }

  if (file.size > maxBytes) {
    throw new Error(`Ảnh vượt quá ${maxMb}MB.`);
  }
}
