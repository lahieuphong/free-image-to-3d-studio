"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModelViewer } from "@/components/model-viewer";
import type { GenerationJob, GenerationSettings } from "@/lib/job-types";

const DEFAULT_SETTINGS: GenerationSettings = {
  textureResolution: 1024,
  remeshOption: "none",
  targetVertexCount: -1,
  foregroundRatio: 0.85
};

const MAX_UPLOAD_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? "20");
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type Stage = "idle" | "queued" | "running" | "succeeded" | "failed";

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

async function readError(response: Response) {
  const payload = await response.json().catch(() => null);
  if (payload?.error) return payload.error as string;
  if (payload?.detail) return typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail);
  return "Có lỗi khi gọi AI worker.";
}

export function GeneratorPanel() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [settings, setSettings] = useState<GenerationSettings>(DEFAULT_SETTINGS);
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const modelUrl = useMemo(() => {
    if (!job || job.status !== "succeeded") return null;
    return `/api/jobs/${job.id}/model?v=${encodeURIComponent(job.updated_at ?? job.id)}`;
  }, [job]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (!job || job.status === "succeeded" || job.status === "failed") return;

    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/jobs/${job.id}`, { cache: "no-store" });
      if (!response.ok) {
        setError(await readError(response));
        setStage("failed");
        return;
      }

      const nextJob = (await response.json()) as GenerationJob;
      setJob(nextJob);
      setStage(nextJob.status);
      if (nextJob.status === "failed") setError(nextJob.error ?? "AI worker xử lý thất bại.");
    }, 1800);

    return () => window.clearInterval(timer);
  }, [job]);

  const validateAndSetFile = useCallback(
    (nextFile: File) => {
      setError(null);
      if (!ALLOWED_TYPES.has(nextFile.type)) {
        setError("Chỉ hỗ trợ PNG, JPG/JPEG hoặc WEBP.");
        return;
      }
      if (nextFile.size > MAX_UPLOAD_MB * 1024 * 1024) {
        setError(`File vượt quá ${MAX_UPLOAD_MB}MB.`);
        return;
      }

      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setFile(nextFile);
      setPreviewUrl(URL.createObjectURL(nextFile));
      setJob(null);
      setStage("idle");
    },
    [previewUrl]
  );

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0];
    if (nextFile) validateAndSetFile(nextFile);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const nextFile = event.dataTransfer.files?.[0];
    if (nextFile) validateAndSetFile(nextFile);
  };

  const clearFile = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setFile(null);
    setJob(null);
    setStage("idle");
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const submit = async () => {
    if (!file) {
      setError("Bạn cần chọn một ảnh trước.");
      return;
    }

    setError(null);
    setStage("queued");
    setJob(null);

    const form = new FormData();
    form.append("image", file, file.name);
    form.append("texture_resolution", String(settings.textureResolution));
    form.append("remesh_option", settings.remeshOption);
    form.append("target_vertex_count", String(settings.targetVertexCount));
    form.append("foreground_ratio", String(settings.foregroundRatio));

    const response = await fetch("/api/jobs", {
      method: "POST",
      body: form
    });

    if (!response.ok) {
      setStage("failed");
      setError(await readError(response));
      return;
    }

    const created = (await response.json()) as GenerationJob;
    setJob(created);
    setStage(created.status);
  };

  const isBusy = stage === "queued" || stage === "running";
  const progress = Math.max(0, Math.min(100, Math.round(job?.progress ?? (isBusy ? 6 : 0))));

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="logo">3D</div>
          <div>
            <h1>Free Image to 3D Studio</h1>
            <p>Upload ảnh → chạy AI open-source → xuất file GLB giống flow Meshy.</p>
          </div>
        </div>
        <div className="status-card" title="AI worker mặc định chạy mock mode để test UI; đổi AI_PROVIDER=sf3d để chạy Stable Fast 3D thật.">
          <span className="status-dot" />
          Next.js + FastAPI + Stable Fast 3D
        </div>
      </header>

      <section className="hero">
        <aside className="panel left-panel">
          <div className="section-title">
            <div>
              <h2>Ảnh đầu vào</h2>
              <p>Ảnh vật thể rõ nền sẽ cho kết quả tốt hơn. Worker sẽ remove background trước khi dựng mesh.</p>
            </div>
            <span className="badge">Free self-host</span>
          </div>

          <div
            className={`upload-zone ${isDragging ? "is-dragging" : ""} ${previewUrl ? "has-preview" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <input
              ref={inputRef}
              className="file-input"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleInputChange}
              aria-label="Upload image"
            />

            {previewUrl ? (
              <img className="preview-image" src={previewUrl} alt="Preview input" />
            ) : (
              <div className="upload-content">
                <div className="upload-icon">↥</div>
                <strong>Kéo-thả hoặc bấm để chọn ảnh</strong>
                <span>PNG, JPG/JPEG, WEBP · tối đa {MAX_UPLOAD_MB}MB</span>
              </div>
            )}
          </div>

          {file && (
            <div className="file-meta">
              <span>
                <strong>{file.name}</strong>
                <br />
                {formatBytes(file.size)} · {file.type}
              </span>
              <button className="secondary-button" type="button" onClick={clearFile} disabled={isBusy}>
                Xóa
              </button>
            </div>
          )}

          <div className="settings-grid">
            <div className="form-row">
              <div className="field">
                <label htmlFor="texture-resolution">Texture</label>
                <select
                  id="texture-resolution"
                  value={settings.textureResolution}
                  onChange={(event) => setSettings((current) => ({ ...current, textureResolution: Number(event.target.value) }))}
                  disabled={isBusy}
                >
                  <option value={512}>512 px - nhanh</option>
                  <option value={1024}>1024 px - cân bằng</option>
                  <option value={2048}>2048 px - đẹp hơn</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor="remesh-option">Remesh</label>
                <select
                  id="remesh-option"
                  value={settings.remeshOption}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, remeshOption: event.target.value as GenerationSettings["remeshOption"] }))
                  }
                  disabled={isBusy}
                >
                  <option value="none">None</option>
                  <option value="triangle">Triangle</option>
                  <option value="quad">Quad</option>
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="field">
                <label htmlFor="target-vertex-count">Target vertices</label>
                <input
                  id="target-vertex-count"
                  type="number"
                  min={-1}
                  step={500}
                  value={settings.targetVertexCount}
                  onChange={(event) => setSettings((current) => ({ ...current, targetVertexCount: Number(event.target.value) }))}
                  disabled={isBusy}
                />
              </div>

              <div className="field">
                <label htmlFor="foreground-ratio">Foreground ratio</label>
                <input
                  id="foreground-ratio"
                  type="number"
                  min={0.55}
                  max={1.4}
                  step={0.05}
                  value={settings.foregroundRatio}
                  onChange={(event) => setSettings((current) => ({ ...current, foregroundRatio: Number(event.target.value) }))}
                  disabled={isBusy}
                />
              </div>
            </div>
          </div>

          <div className="action-row">
            <button className="primary-button" type="button" onClick={submit} disabled={!file || isBusy}>
              {isBusy ? "Đang generate..." : "Generate GLB"}
            </button>
            <button className="secondary-button" type="button" onClick={() => inputRef.current?.click()} disabled={isBusy}>
              Chọn ảnh
            </button>
          </div>

          {isBusy && (
            <div className="progress-wrap">
              <div className="progress-header">
                <span>{job?.status === "running" ? "AI đang dựng mesh" : "Đã đưa vào hàng đợi"}</span>
                <b>{progress}%</b>
              </div>
              <div className="progress-track">
                <div className="progress-bar" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {error && <div className="alert">{error}</div>}

          <div className="info-list">
            <div className="info-item">
              <span>◎</span>
              <span>
                <b>Mock mode</b> giúp bạn test UI ngay cả khi chưa có GPU. Chuyển <code>AI_PROVIDER=sf3d</code> để chạy AI thật.
              </span>
            </div>
            <div className="info-item">
              <span>◇</span>
              <span>
                <b>GLB viewer</b> dùng <code>&lt;model-viewer&gt;</code>, hỗ trợ xoay, zoom, AR và download file kết quả.
              </span>
            </div>
          </div>
        </aside>

        <section className="panel right-panel">
          <div className="section-title">
            <div>
              <h3>Preview 3D</h3>
              <p>Khi job xong, GLB sẽ tự hiện ở đây. Bạn có thể xoay/zoom rồi tải file.</p>
            </div>
            {job && <span className="badge">{job.status}</span>}
          </div>

          <div className="model-stage">
            {modelUrl ? (
              <ModelViewer src={modelUrl} />
            ) : isBusy ? (
              <div className="processing-stage">
                <div className="processing-card">
                  <div className="spinner" />
                  <h2>Đang tạo mô hình 3D</h2>
                  <p>
                    Worker đang nhận ảnh, tách nền, dựng mesh, bake texture và export GLB. Với AI thật, thời gian phụ thuộc GPU và texture.
                  </p>
                </div>
              </div>
            ) : (
              <div className="empty-stage">
                <div className="empty-stage-inner">
                  <div className="orb">◌</div>
                  <h2>Chưa có model</h2>
                  <p>Chọn một ảnh rõ chủ thể rồi bấm Generate GLB. Source này mô phỏng flow sản phẩm kiểu Meshy nhưng dùng AI open-source.</p>
                </div>
              </div>
            )}
          </div>

          <div className="viewer-toolbar">
            <span className="status-card">
              <span className="status-dot" />
              {job ? `Job ${job.id.slice(0, 8)} · ${progress}%` : "Sẵn sàng"}
            </span>
            {modelUrl && (
              <a className="download-button" href={modelUrl} download={`${job?.id ?? "model"}.glb`}>
                Tải GLB
              </a>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
