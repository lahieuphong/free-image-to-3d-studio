"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModelViewer } from "@/components/model-viewer";
import type { GenerationJob, GenerationSettings } from "@/lib/job-types";

const DEFAULT_SETTINGS: GenerationSettings = {
  textureResolution: 1024,
  remeshOption: "none",
  targetVertexCount: -1,
  foregroundRatio: 0.85,
  dropLowerRatio: 0
};

const MAX_UPLOAD_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? "20");
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const QUALITY_PRESETS: Array<{ label: string; hint: string; settings: GenerationSettings }> = [
  {
    label: "Cân bằng",
    hint: "Ổn cho đa số ảnh",
    settings: { textureResolution: 1024, remeshOption: "none", targetVertexCount: -1, foregroundRatio: 0.85, dropLowerRatio: 0 }
  },
  {
    label: "Đẹp",
    hint: "Texture rõ hơn",
    settings: { textureResolution: 2048, remeshOption: "none", targetVertexCount: -1, foregroundRatio: 0.85, dropLowerRatio: 0 }
  },
  {
    label: "Nón sạch",
    hint: "Bỏ quai/mảng rời",
    settings: { textureResolution: 2048, remeshOption: "none", targetVertexCount: -1, foregroundRatio: 0.75, dropLowerRatio: 0.42 }
  },
  {
    label: "Web nhẹ",
    hint: "File gọn hơn",
    settings: { textureResolution: 1024, remeshOption: "triangle", targetVertexCount: 20000, foregroundRatio: 0.85, dropLowerRatio: 0 }
  }
];

type Stage = "idle" | "queued" | "running" | "succeeded" | "failed";
type ImageDimensions = { width: number; height: number };
type InputMode = "single" | "four";
type ViewKey = "front" | "left" | "right" | "back";

const VIEW_SLOTS: Array<{ key: ViewKey; label: string; shortLabel: string }> = [
  { key: "front", label: "Trước", shortLabel: "Trước" },
  { key: "left", label: "Bên trái", shortLabel: "Trái" },
  { key: "right", label: "Bên phải", shortLabel: "Phải" },
  { key: "back", label: "Mặt sau", shortLabel: "Sau" }
];

const EMPTY_VIEW_FILES: Record<ViewKey, File | null> = {
  front: null,
  left: null,
  right: null,
  back: null
};

const EMPTY_VIEW_URLS: Record<ViewKey, string | null> = {
  front: null,
  left: null,
  right: null,
  back: null
};

const EMPTY_VIEW_DIMENSIONS: Record<ViewKey, ImageDimensions | null> = {
  front: null,
  left: null,
  right: null,
  back: null
};

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

function loadImageDimensions(url: string) {
  return new Promise<ImageDimensions>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = reject;
    image.src = url;
  });
}

function setJobQuery(jobId: string | null) {
  const url = new URL(window.location.href);
  if (jobId) {
    url.searchParams.set("job", jobId);
  } else {
    url.searchParams.delete("job");
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function getImageFileError(nextFile: File) {
  if (!ALLOWED_TYPES.has(nextFile.type)) {
    return "Chỉ hỗ trợ PNG, JPG/JPEG hoặc WEBP.";
  }
  if (nextFile.size > MAX_UPLOAD_MB * 1024 * 1024) {
    return `File vượt quá ${MAX_UPLOAD_MB}MB.`;
  }
  return null;
}

export function GeneratorPanel() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [inputMode, setInputMode] = useState<InputMode>("single");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState<ImageDimensions | null>(null);
  const [viewFiles, setViewFiles] = useState<Record<ViewKey, File | null>>(EMPTY_VIEW_FILES);
  const [viewPreviewUrls, setViewPreviewUrls] = useState<Record<ViewKey, string | null>>(EMPTY_VIEW_URLS);
  const [viewDimensions, setViewDimensions] = useState<Record<ViewKey, ImageDimensions | null>>(EMPTY_VIEW_DIMENSIONS);
  const [draggingView, setDraggingView] = useState<ViewKey | null>(null);
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
    return () => {
      Object.values(viewPreviewUrls).forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, [viewPreviewUrls]);

  useEffect(() => {
    const jobId = new URLSearchParams(window.location.search).get("job");
    if (!jobId) return;
    const restoredJobId = jobId;

    let isCancelled = false;
    async function loadJobFromUrl() {
      const response = await fetch(`/api/jobs/${encodeURIComponent(restoredJobId)}`, { cache: "no-store" });
      if (isCancelled) return;
      if (!response.ok) {
        setError(await readError(response));
        setStage("failed");
        return;
      }

      const restoredJob = (await response.json()) as GenerationJob;
      setJob(restoredJob);
      setStage(restoredJob.status);
      if (restoredJob.status === "failed") setError(restoredJob.error ?? "AI worker xử lý thất bại.");
    }

    loadJobFromUrl().catch(() => {
      if (!isCancelled) {
        setError("Không tải được job từ URL.");
        setStage("failed");
      }
    });

    return () => {
      isCancelled = true;
    };
  }, []);

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
    async (nextFile: File) => {
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
      const nextPreviewUrl = URL.createObjectURL(nextFile);
      setFile(nextFile);
      setPreviewUrl(nextPreviewUrl);
      setImageDimensions(null);
      loadImageDimensions(nextPreviewUrl).then(setImageDimensions).catch(() => setImageDimensions(null));
      setJob(null);
      setStage("idle");
      setJobQuery(null);
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

  const setViewFile = useCallback(
    async (key: ViewKey, nextFile: File) => {
      setError(null);
      const fileError = getImageFileError(nextFile);
      if (fileError) {
        setError(fileError);
        return;
      }

      const nextPreviewUrl = URL.createObjectURL(nextFile);
      setViewFiles((current) => ({ ...current, [key]: nextFile }));
      setViewPreviewUrls((current) => {
        if (current[key]) URL.revokeObjectURL(current[key]);
        return { ...current, [key]: nextPreviewUrl };
      });
      setViewDimensions((current) => ({ ...current, [key]: null }));
      loadImageDimensions(nextPreviewUrl)
        .then((dimensions) => setViewDimensions((current) => ({ ...current, [key]: dimensions })))
        .catch(() => setViewDimensions((current) => ({ ...current, [key]: null })));
      setJob(null);
      setStage("idle");
      setJobQuery(null);
    },
    []
  );

  const handleViewInputChange = (key: ViewKey, event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0];
    if (nextFile) setViewFile(key, nextFile);
  };

  const handleViewDrop = (key: ViewKey, event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDraggingView(null);
    const nextFile = event.dataTransfer.files?.[0];
    if (nextFile) setViewFile(key, nextFile);
  };

  const clearFile = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setFile(null);
    setImageDimensions(null);
    setJob(null);
    setStage("idle");
    setError(null);
    setJobQuery(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const clearViewFiles = () => {
    Object.values(viewPreviewUrls).forEach((url) => {
      if (url) URL.revokeObjectURL(url);
    });
    setViewFiles({ ...EMPTY_VIEW_FILES });
    setViewPreviewUrls({ ...EMPTY_VIEW_URLS });
    setViewDimensions({ ...EMPTY_VIEW_DIMENSIONS });
    setJob(null);
    setStage("idle");
    setError(null);
    setJobQuery(null);
  };

  const submit = async () => {
    if (inputMode === "single" && !file) {
      setError("Bạn cần chọn một ảnh trước.");
      return;
    }

    const missingFourViewSlots = VIEW_SLOTS.filter((slot) => !viewFiles[slot.key]);
    if (inputMode === "four" && missingFourViewSlots.length > 0) {
      setError(`Bạn cần đủ 4 ảnh: còn thiếu ${missingFourViewSlots.map((slot) => slot.label).join(", ")}.`);
      return;
    }

    setError(null);
    setStage("queued");
    setJob(null);

    const form = new FormData();
    form.append("view_mode", inputMode);
    if (inputMode === "single" && file) {
      form.append("image", file, file.name);
    }
    if (inputMode === "four") {
      const frontFile = viewFiles.front;
      const leftFile = viewFiles.left;
      const rightFile = viewFiles.right;
      const backFile = viewFiles.back;
      if (frontFile && leftFile && rightFile && backFile) {
        form.append("image_front", frontFile, frontFile.name);
        form.append("image_left", leftFile, leftFile.name);
        form.append("image_right", rightFile, rightFile.name);
        form.append("image_back", backFile, backFile.name);
      }
    }
    form.append("texture_resolution", String(settings.textureResolution));
    form.append("remesh_option", settings.remeshOption);
    form.append("target_vertex_count", String(settings.targetVertexCount));
    form.append("foreground_ratio", String(settings.foregroundRatio));
    form.append("drop_lower_ratio", String(settings.dropLowerRatio));

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
    setJobQuery(created.id);
  };

  const isBusy = stage === "queued" || stage === "running";
  const progress = Math.max(0, Math.min(100, Math.round(job?.progress ?? (isBusy ? 6 : 0))));
  const hasAllViewFiles = VIEW_SLOTS.every((slot) => Boolean(viewFiles[slot.key]));
  const canSubmit = inputMode === "single" ? Boolean(file) : hasAllViewFiles;

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

          <div className="mode-tabs" role="tablist" aria-label="Input mode">
            <button
              className={inputMode === "single" ? "is-active" : ""}
              type="button"
              role="tab"
              aria-selected={inputMode === "single"}
              onClick={() => setInputMode("single")}
              disabled={isBusy}
            >
              1 ảnh
            </button>
            <button
              className={inputMode === "four" ? "is-active" : ""}
              type="button"
              role="tab"
              aria-selected={inputMode === "four"}
              onClick={() => setInputMode("four")}
              disabled={isBusy}
            >
              4 góc
            </button>
          </div>

          {inputMode === "single" ? (
            <>
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
                {imageDimensions ? ` · ${imageDimensions.width}x${imageDimensions.height}px` : ""}
              </span>
              <button className="secondary-button" type="button" onClick={clearFile} disabled={isBusy}>
                Xóa
              </button>
            </div>
          )}

          {imageDimensions && Math.max(imageDimensions.width, imageDimensions.height) < 1024 && (
            <div className="quality-warning">
              Ảnh hơi nhỏ ({imageDimensions.width}x{imageDimensions.height}px). Dùng ảnh gốc từ 1024px trở lên sẽ giúp texture và hình khối sắc hơn.
            </div>
          )}

            </>
          ) : (
            <div className="four-view-panel">
              <div className="four-view-grid">
                {VIEW_SLOTS.map((slot) => {
                  const fileForSlot = viewFiles[slot.key];
                  const previewForSlot = viewPreviewUrls[slot.key];
                  const dimensionsForSlot = viewDimensions[slot.key];

                  return (
                    <div
                      key={slot.key}
                      className={`view-slot ${slot.key === "front" ? "view-slot-front" : ""} ${
                        draggingView === slot.key ? "is-dragging" : ""
                      } ${previewForSlot ? "has-preview" : ""}`}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setDraggingView(slot.key);
                      }}
                      onDragLeave={() => setDraggingView(null)}
                      onDrop={(event) => handleViewDrop(slot.key, event)}
                    >
                      <input
                        key={`${slot.key}-${previewForSlot ? "filled" : "empty"}`}
                        className="file-input"
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(event) => handleViewInputChange(slot.key, event)}
                        aria-label={`Upload ${slot.label}`}
                        disabled={isBusy}
                      />
                      {previewForSlot ? (
                        <img className="view-slot-image" src={previewForSlot} alt={slot.label} />
                      ) : (
                        <div className="view-slot-empty">
                          <span>{slot.shortLabel}</span>
                          <small>PNG/JPG/WEBP</small>
                        </div>
                      )}
                      <div className="view-slot-label">
                        <strong>{slot.label}</strong>
                        {fileForSlot && dimensionsForSlot ? <span>{dimensionsForSlot.width}x{dimensionsForSlot.height}</span> : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="four-view-meta">
                <span>{VIEW_SLOTS.filter((slot) => viewFiles[slot.key]).length}/4 ảnh đã chọn</span>
                <button className="secondary-button compact-button" type="button" onClick={clearViewFiles} disabled={isBusy}>
                  Xóa
                </button>
              </div>

              <div className="quality-warning">
                Chế độ này đang lưu đủ 4 góc để thử nghiệm. Stable Fast 3D hiện vẫn dựng từ ảnh Trước, nên nếu muốn multi-view thật cần đổi provider ở bước sau.
              </div>
            </div>
          )}

          <div className="preset-grid" aria-label="Quality presets">
            {QUALITY_PRESETS.map((preset) => (
              <button
                key={preset.label}
                className="preset-button"
                type="button"
                onClick={() => setSettings(preset.settings)}
                disabled={isBusy}
              >
                <strong>{preset.label}</strong>
                <span>{preset.hint}</span>
              </button>
            ))}
          </div>

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

              <div className="field">
                <label htmlFor="drop-lower-ratio">Lower cleanup</label>
                <input
                  id="drop-lower-ratio"
                  type="number"
                  min={0}
                  max={0.8}
                  step={0.01}
                  value={settings.dropLowerRatio}
                  onChange={(event) => setSettings((current) => ({ ...current, dropLowerRatio: Number(event.target.value) }))}
                  disabled={isBusy}
                />
              </div>
            </div>
          </div>

          <div className="action-row">
            <button className="primary-button" type="button" onClick={submit} disabled={!canSubmit || isBusy}>
              {isBusy ? "Đang generate..." : "Generate GLB"}
            </button>
            <button className="secondary-button" type="button" onClick={() => inputRef.current?.click()} disabled={isBusy || inputMode === "four"}>
              {inputMode === "four" ? "Chọn từng góc" : "Chọn ảnh"}
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
