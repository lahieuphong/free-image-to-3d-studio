"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModelViewer } from "@/components/model-viewer";
import type { GenerationJob, GenerationSettings, ProviderKey } from "@/lib/job-types";

// ── Provider metadata ────────────────────────────────────────────────────────

const PROVIDERS: Array<{ key: ProviderKey; label: string; tag: string; note: string }> = [
  { key: "sf3d",        label: "SF3D",        tag: "Local · Free",  note: "Stable Fast 3D, chạy trên GPU của bạn. Nhanh, miễn phí." },
  { key: "tripo3d",     label: "Tripo3D",     tag: "Cloud · Paid",  note: "Tripo3D REST API — chất lượng cao nhất. Cần API key + trả phí." },
  { key: "instantmesh", label: "InstantMesh", tag: "Local · Free",  note: "Multi-view synthesis nội bộ (Zero123++) + reconstruct. Tốt hơn SF3D, cần GPU." },
];

// ── Default settings per provider ───────────────────────────────────────────

const BASE_SETTINGS: Omit<GenerationSettings, "provider"> = {
  textureResolution: 2048,
  remeshOption: "none",
  targetVertexCount: -1,
  foregroundRatio: 0.85,
  dropLowerRatio: 0,
  tripoQuality: "standard",
  instantmeshConfig: "instant-mesh-large",
};

const PROVIDER_DEFAULTS: Record<ProviderKey, GenerationSettings> = {
  sf3d:         { provider: "sf3d",        ...BASE_SETTINGS },
  tripo3d:      { provider: "tripo3d",     ...BASE_SETTINGS, tripoQuality: "standard" },
  instantmesh:  { provider: "instantmesh", ...BASE_SETTINGS, instantmeshConfig: "instant-mesh-large" },
};

// ── Quality presets ──────────────────────────────────────────────────────────

type Preset = { label: string; hint: string; settings: Partial<GenerationSettings> };

const SF3D_PRESETS: Preset[] = [
  { label: "Cân bằng",  hint: "Texture 2048, cân bằng",        settings: { textureResolution: 2048, remeshOption: "none",     targetVertexCount: -1,    foregroundRatio: 0.92, dropLowerRatio: 0 } },
  { label: "Đẹp",       hint: "Texture 2048, chi tiết cao",    settings: { textureResolution: 2048, remeshOption: "none",     targetVertexCount: -1,    foregroundRatio: 0.92, dropLowerRatio: 0 } },
  { label: "Nón sạch",  hint: "Bỏ mảng rời, phù hợp nón/mũ",  settings: { textureResolution: 2048, remeshOption: "none",     targetVertexCount: -1,    foregroundRatio: 0.75, dropLowerRatio: 0.42 } },
  { label: "Web nhẹ",   hint: "20k polygon, file nhỏ",         settings: { textureResolution: 1024, remeshOption: "triangle", targetVertexCount: 20000, foregroundRatio: 0.92, dropLowerRatio: 0 } },
];

const TRIPO_PRESETS: Preset[] = [
  { label: "Standard",   hint: "Chất lượng tốt, ~1–2 phút",  settings: { tripoQuality: "standard" } },
  { label: "Detailed",   hint: "Mesh đẹp hơn, ~3–4 phút",    settings: { tripoQuality: "detailed" } },
];

const INSTANTMESH_PRESETS: Preset[] = [
  { label: "Large",  hint: "Chất lượng cao nhất",  settings: { instantmeshConfig: "instant-mesh-large" } },
  { label: "Base",   hint: "Nhanh hơn ~30%",       settings: { instantmeshConfig: "instant-mesh-base" } },
];

const PROVIDER_PRESETS: Record<ProviderKey, Preset[]> = {
  sf3d: SF3D_PRESETS,
  tripo3d: TRIPO_PRESETS,
  instantmesh: INSTANTMESH_PRESETS,
};

// ── Types ────────────────────────────────────────────────────────────────────

const MAX_UPLOAD_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? "20");
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type Stage = "idle" | "queued" | "running" | "succeeded" | "failed";
type ImageDimensions = { width: number; height: number };
type InputMode = "single" | "four" | "six";
type ViewKey = "front" | "left" | "right" | "back" | "top" | "bottom";

const VIEW_SLOTS: Array<{ key: ViewKey; label: string; shortLabel: string }> = [
  { key: "front",  label: "Trước",      shortLabel: "Trước" },
  { key: "left",   label: "Bên trái",   shortLabel: "Trái" },
  { key: "right",  label: "Bên phải",   shortLabel: "Phải" },
  { key: "back",   label: "Mặt sau",    shortLabel: "Sau" },
  { key: "top",    label: "Trên",       shortLabel: "Trên" },
  { key: "bottom", label: "Dưới",       shortLabel: "Dưới" },
];

const EMPTY_VIEW_FILES: Record<ViewKey, File | null> = { front: null, left: null, right: null, back: null, top: null, bottom: null };
const EMPTY_VIEW_URLS: Record<ViewKey, string | null> = { front: null, left: null, right: null, back: null, top: null, bottom: null };
const EMPTY_VIEW_DIMS: Record<ViewKey, ImageDimensions | null> = { front: null, left: null, right: null, back: null, top: null, bottom: null };

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
  if (jobId) url.searchParams.set("job", jobId);
  else url.searchParams.delete("job");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function getImageFileError(nextFile: File) {
  if (!ALLOWED_TYPES.has(nextFile.type)) return "Chỉ hỗ trợ PNG, JPG/JPEG hoặc WEBP.";
  if (nextFile.size > MAX_UPLOAD_MB * 1024 * 1024) return `File vượt quá ${MAX_UPLOAD_MB}MB.`;
  return null;
}

// ── Component ────────────────────────────────────────────────────────────────

export function GeneratorPanel() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [inputMode, setInputMode] = useState<InputMode>("single");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState<ImageDimensions | null>(null);
  const [viewFiles, setViewFiles] = useState<Record<ViewKey, File | null>>(EMPTY_VIEW_FILES);
  const [viewPreviewUrls, setViewPreviewUrls] = useState<Record<ViewKey, string | null>>(EMPTY_VIEW_URLS);
  const [viewDimensions, setViewDimensions] = useState<Record<ViewKey, ImageDimensions | null>>(EMPTY_VIEW_DIMS);
  const [draggingView, setDraggingView] = useState<ViewKey | null>(null);
  const [settings, setSettings] = useState<GenerationSettings>(PROVIDER_DEFAULTS.sf3d);
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const provider = settings.provider;

  const modelUrl = useMemo(() => {
    if (!job || job.status !== "succeeded") return null;
    return `/api/jobs/${job.id}/model?v=${encodeURIComponent(job.updated_at ?? job.id)}`;
  }, [job]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => () => { Object.values(viewPreviewUrls).forEach((u) => { if (u) URL.revokeObjectURL(u); }); }, [viewPreviewUrls]);

  // Restore job from URL
  useEffect(() => {
    const jobId = new URLSearchParams(window.location.search).get("job");
    if (!jobId) return;
    let cancelled = false;
    async function load() {
      const resp = await fetch(`/api/jobs/${encodeURIComponent(jobId!)}`, { cache: "no-store" });
      if (cancelled) return;
      if (!resp.ok) { setError(await readError(resp)); setStage("failed"); return; }
      const restored = (await resp.json()) as GenerationJob;
      setJob(restored); setStage(restored.status);
      if (restored.status === "failed") setError(restored.error ?? "AI worker xử lý thất bại.");
    }
    load().catch(() => { if (!cancelled) { setError("Không tải được job từ URL."); setStage("failed"); } });
    return () => { cancelled = true; };
  }, []);

  // Poll running job
  useEffect(() => {
    if (!job || job.status === "succeeded" || job.status === "failed") return;
    const timer = window.setInterval(async () => {
      const resp = await fetch(`/api/jobs/${job.id}`, { cache: "no-store" });
      if (!resp.ok) { setError(await readError(resp)); setStage("failed"); return; }
      const next = (await resp.json()) as GenerationJob;
      setJob(next); setStage(next.status);
      if (next.status === "failed") setError(next.error ?? "AI worker xử lý thất bại.");
    }, 1800);
    return () => window.clearInterval(timer);
  }, [job]);

  const validateAndSetFile = useCallback(async (nextFile: File) => {
    setError(null);
    const err = getImageFileError(nextFile);
    if (err) { setError(err); return; }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const nextUrl = URL.createObjectURL(nextFile);
    setFile(nextFile); setPreviewUrl(nextUrl); setImageDimensions(null);
    loadImageDimensions(nextUrl).then(setImageDimensions).catch(() => setImageDimensions(null));
    setJob(null); setStage("idle"); setJobQuery(null);
  }, [previewUrl]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) validateAndSetFile(f); };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files?.[0]; if (f) validateAndSetFile(f); };

  const setViewFile = useCallback(async (key: ViewKey, nextFile: File) => {
    setError(null);
    const err = getImageFileError(nextFile);
    if (err) { setError(err); return; }
    const nextUrl = URL.createObjectURL(nextFile);
    setViewFiles((c) => ({ ...c, [key]: nextFile }));
    setViewPreviewUrls((c) => { if (c[key]) URL.revokeObjectURL(c[key]); return { ...c, [key]: nextUrl }; });
    setViewDimensions((c) => ({ ...c, [key]: null }));
    loadImageDimensions(nextUrl).then((d) => setViewDimensions((c) => ({ ...c, [key]: d }))).catch(() => {});
    setJob(null); setStage("idle"); setJobQuery(null);
  }, []);

  const handleViewInputChange = (key: ViewKey, e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) setViewFile(key, f); };
  const handleViewDrop = (key: ViewKey, e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); setDraggingView(null); const f = e.dataTransfer.files?.[0]; if (f) setViewFile(key, f); };

  const clearFile = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null); setFile(null); setImageDimensions(null);
    setJob(null); setStage("idle"); setError(null); setJobQuery(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const clearViewFiles = () => {
    Object.values(viewPreviewUrls).forEach((u) => { if (u) URL.revokeObjectURL(u); });
    setViewFiles({ ...EMPTY_VIEW_FILES }); setViewPreviewUrls({ ...EMPTY_VIEW_URLS }); setViewDimensions({ ...EMPTY_VIEW_DIMS });
    setJob(null); setStage("idle"); setError(null); setJobQuery(null);
  };

  const handleProviderChange = (key: ProviderKey) => {
    setSettings(PROVIDER_DEFAULTS[key]);
  };

  const applyPreset = (preset: Preset) => {
    setSettings((cur) => ({ ...cur, ...preset.settings }));
  };

  const submit = async () => {
    if (inputMode === "single" && !file) { setError("Bạn cần chọn một ảnh trước."); return; }
    const missingSlots = activeViewSlots.filter((s) => !viewFiles[s.key]);
    if (inputMode !== "single" && missingSlots.length > 0) {
      setError(`Cần đủ ${activeViewSlots.length} ảnh: còn thiếu ${missingSlots.map((s) => s.label).join(", ")}.`);
      return;
    }
    setError(null); setStage("queued"); setJob(null);

    const form = new FormData();
    form.append("view_mode", inputMode);
    form.append("provider_choice", provider);
    form.append("tripo_quality", settings.tripoQuality);
    form.append("instantmesh_config", settings.instantmeshConfig);
    form.append("texture_resolution", String(settings.textureResolution));
    form.append("remesh_option", settings.remeshOption);
    form.append("target_vertex_count", String(settings.targetVertexCount));
    form.append("foreground_ratio", String(settings.foregroundRatio));
    form.append("drop_lower_ratio", String(settings.dropLowerRatio));

    if (inputMode === "single" && file) {
      form.append("image", file, file.name);
    } else {
      if (viewFiles.front) form.append("image_front", viewFiles.front, viewFiles.front.name);
      if (viewFiles.left)  form.append("image_left",  viewFiles.left,  viewFiles.left.name);
      if (viewFiles.right) form.append("image_right", viewFiles.right, viewFiles.right.name);
      if (viewFiles.back)  form.append("image_back",  viewFiles.back,  viewFiles.back.name);
      if (inputMode === "six") {
        if (viewFiles.top)    form.append("image_top",    viewFiles.top,    viewFiles.top.name);
        if (viewFiles.bottom) form.append("image_bottom", viewFiles.bottom, viewFiles.bottom.name);
      }
    }

    const response = await fetch("/api/jobs", { method: "POST", body: form });
    if (!response.ok) { setStage("failed"); setError(await readError(response)); return; }
    const created = (await response.json()) as GenerationJob;
    setJob(created); setStage(created.status); setJobQuery(created.id);
  };

  const isBusy = stage === "queued" || stage === "running";
  const progress = Math.max(0, Math.min(100, Math.round(job?.progress ?? (isBusy ? 6 : 0))));
  const activeViewSlots = inputMode === "six" ? VIEW_SLOTS : VIEW_SLOTS.slice(0, 4);
  const hasAllViewFiles = activeViewSlots.every((s) => Boolean(viewFiles[s.key]));
  const canSubmit = inputMode === "single" ? Boolean(file) : hasAllViewFiles;
  const currentPresets = PROVIDER_PRESETS[provider];

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
        <div className="status-card" title="Chọn provider bên dưới. Mỗi provider có ưu nhược khác nhau.">
          <span className="status-dot" />
          Next.js + FastAPI · Multi-provider
        </div>
      </header>

      <section className="hero">
        <aside className="panel left-panel">
          {/* ── Provider selector ──────────────────────── */}
          <div className="section-label">Provider</div>
          <div className="provider-tabs" role="tablist" aria-label="Provider">
            {PROVIDERS.map((p) => (
              <button
                key={p.key}
                className={`provider-tab ${provider === p.key ? "is-active" : ""}`}
                role="tab"
                aria-selected={provider === p.key}
                type="button"
                onClick={() => handleProviderChange(p.key)}
                disabled={isBusy}
                title={p.note}
              >
                <strong>{p.label}</strong>
                <span>{p.tag}</span>
              </button>
            ))}
          </div>
          {provider === "tripo3d" && (
            <div className="provider-info-box provider-info-paid">
              Tripo3D dùng REST API. Cần <code>TRIPO3D_API_KEY</code> trong <code>.env</code> của AI worker.
              {inputMode !== "single" && (
                <> Với 4-view, Tripo3D sẽ dùng <strong>tất cả 4 ảnh</strong> để reconstruct — chất lượng tốt hơn single.</>
              )}
            </div>
          )}
          {provider === "instantmesh" && (
            <div className="provider-info-box provider-info-local">
              InstantMesh cần clone repo và cài GPU deps. Kết quả tốt hơn SF3D vì dùng Zero123++ tạo multi-view nội bộ.
            </div>
          )}

          {/* ── Section title ──────────────────────────── */}
          <div className="section-title" style={{ marginTop: 18 }}>
            <div>
              <h2>Ảnh đầu vào</h2>
              <p>Ảnh vật thể rõ nền sẽ cho kết quả tốt hơn. Worker sẽ remove background trước khi dựng mesh.</p>
            </div>
            <span className="badge">Free self-host</span>
          </div>

          {/* ── Input mode tabs ────────────────────────── */}
          <div className="mode-tabs" role="tablist" aria-label="Input mode">
            <button className={inputMode === "single" ? "is-active" : ""} type="button" role="tab" aria-selected={inputMode === "single"} onClick={() => setInputMode("single")} disabled={isBusy}>1 ảnh</button>
            <button className={inputMode === "four"   ? "is-active" : ""} type="button" role="tab" aria-selected={inputMode === "four"}   onClick={() => setInputMode("four")}   disabled={isBusy}>4 góc</button>
            <button className={inputMode === "six"    ? "is-active" : ""} type="button" role="tab" aria-selected={inputMode === "six"}    onClick={() => setInputMode("six")}    disabled={isBusy}>6 ảnh</button>
          </div>

          {inputMode === "single" ? (
            <>
              <div
                className={`upload-zone ${isDragging ? "is-dragging" : ""} ${previewUrl ? "has-preview" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                <input ref={inputRef} className="file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleInputChange} aria-label="Upload image" />
                {previewUrl
                  ? <img className="preview-image" src={previewUrl} alt="Preview input" />
                  : <div className="upload-content">
                      <div className="upload-icon">↥</div>
                      <strong>Kéo-thả hoặc bấm để chọn ảnh</strong>
                      <span>PNG, JPG/JPEG, WEBP · tối đa {MAX_UPLOAD_MB}MB</span>
                    </div>
                }
              </div>
              {file && (
                <div className="file-meta">
                  <span>
                    <strong>{file.name}</strong><br />
                    {formatBytes(file.size)} · {file.type}{imageDimensions ? ` · ${imageDimensions.width}x${imageDimensions.height}px` : ""}
                  </span>
                  <button className="secondary-button" type="button" onClick={clearFile} disabled={isBusy}>Xóa</button>
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
                {activeViewSlots.map((slot) => {
                  const slotFile = viewFiles[slot.key];
                  const slotUrl = viewPreviewUrls[slot.key];
                  const slotDim = viewDimensions[slot.key];
                  return (
                    <div
                      key={slot.key}
                      className={`view-slot ${slot.key === "front" ? "view-slot-front" : ""} ${draggingView === slot.key ? "is-dragging" : ""} ${slotUrl ? "has-preview" : ""}`}
                      onDragOver={(e) => { e.preventDefault(); setDraggingView(slot.key); }}
                      onDragLeave={() => setDraggingView(null)}
                      onDrop={(e) => handleViewDrop(slot.key, e)}
                    >
                      <input key={`${slot.key}-${slotUrl ? "filled" : "empty"}`} className="file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => handleViewInputChange(slot.key, e)} aria-label={`Upload ${slot.label}`} disabled={isBusy} />
                      {slotUrl
                        ? <img className="view-slot-image" src={slotUrl} alt={slot.label} />
                        : <div className="view-slot-empty"><span>{slot.shortLabel}</span><small>PNG/JPG/WEBP</small></div>
                      }
                      <div className="view-slot-label">
                        <strong>{slot.label}</strong>
                        {slotFile && slotDim ? <span>{slotDim.width}x{slotDim.height}</span> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="four-view-meta">
                <span>{activeViewSlots.filter((s) => viewFiles[s.key]).length}/{activeViewSlots.length} ảnh đã chọn</span>
                <button className="secondary-button compact-button" type="button" onClick={clearViewFiles} disabled={isBusy}>Xóa</button>
              </div>
              {provider === "tripo3d"
                ? <div className="quality-warning" style={{ borderColor: "rgba(104,245,200,0.34)", background: "rgba(104,245,200,0.07)", color: "#b8f5e0" }}>
                    Tripo3D hỗ trợ multi-view thật sự — 4 góc sẽ cho kết quả reconstruct chính xác hơn nhiều so với single.
                  </div>
                : <div className="quality-warning">
                    {provider === "sf3d"
                      ? "SF3D chỉ dùng ảnh Trước. Các góc còn lại được lưu làm tham chiếu."
                      : "InstantMesh tự sinh multi-view nội bộ — chỉ cần ảnh Trước."
                    }
                  </div>
              }
            </div>
          )}

          {/* ── Presets ────────────────────────────────── */}
          <div className="preset-grid" aria-label="Quality presets">
            {currentPresets.map((preset) => (
              <button key={preset.label} className="preset-button" type="button" onClick={() => applyPreset(preset)} disabled={isBusy}>
                <strong>{preset.label}</strong>
                <span>{preset.hint}</span>
              </button>
            ))}
          </div>

          {/* ── Settings per provider ──────────────────── */}
          {provider === "sf3d" && (
            <div className="settings-grid">
              <div className="form-row">
                <div className="field">
                  <label htmlFor="texture-resolution">Texture</label>
                  <select id="texture-resolution" value={settings.textureResolution} onChange={(e) => setSettings((c) => ({ ...c, textureResolution: Number(e.target.value) }))} disabled={isBusy}>
                    <option value={512}>512 px - nhanh</option>
                    <option value={1024}>1024 px - cân bằng</option>
                    <option value={2048}>2048 px - đẹp hơn</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="remesh-option">Remesh</label>
                  <select id="remesh-option" value={settings.remeshOption} onChange={(e) => setSettings((c) => ({ ...c, remeshOption: e.target.value as GenerationSettings["remeshOption"] }))} disabled={isBusy}>
                    <option value="none">None</option>
                    <option value="triangle">Triangle</option>
                    <option value="quad">Quad</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="field">
                  <label htmlFor="target-vertex-count">Target vertices</label>
                  <input id="target-vertex-count" type="number" min={-1} step={500} value={settings.targetVertexCount} onChange={(e) => setSettings((c) => ({ ...c, targetVertexCount: Number(e.target.value) }))} disabled={isBusy} />
                </div>
                <div className="field">
                  <label htmlFor="foreground-ratio">Foreground ratio</label>
                  <input id="foreground-ratio" type="number" min={0.55} max={1.4} step={0.05} value={settings.foregroundRatio} onChange={(e) => setSettings((c) => ({ ...c, foregroundRatio: Number(e.target.value) }))} disabled={isBusy} />
                </div>
                <div className="field">
                  <label htmlFor="drop-lower-ratio">Lower cleanup</label>
                  <input id="drop-lower-ratio" type="number" min={0} max={0.8} step={0.01} value={settings.dropLowerRatio} onChange={(e) => setSettings((c) => ({ ...c, dropLowerRatio: Number(e.target.value) }))} disabled={isBusy} />
                </div>
              </div>
            </div>
          )}

          {provider === "tripo3d" && (
            <div className="settings-grid">
              <div className="field">
                <label htmlFor="tripo-quality">Quality</label>
                <select id="tripo-quality" value={settings.tripoQuality} onChange={(e) => setSettings((c) => ({ ...c, tripoQuality: e.target.value as GenerationSettings["tripoQuality"] }))} disabled={isBusy}>
                  <option value="standard">Standard — cân bằng chất lượng / thời gian</option>
                  <option value="detailed">Detailed — mesh đẹp nhất, chậm hơn</option>
                </select>
              </div>
            </div>
          )}

          {provider === "instantmesh" && (
            <div className="settings-grid">
              <div className="field">
                <label htmlFor="im-config">Config</label>
                <select id="im-config" value={settings.instantmeshConfig} onChange={(e) => setSettings((c) => ({ ...c, instantmeshConfig: e.target.value as GenerationSettings["instantmeshConfig"] }))} disabled={isBusy}>
                  <option value="instant-mesh-large">instant-mesh-large — chất lượng cao nhất</option>
                  <option value="instant-mesh-base">instant-mesh-base — nhanh hơn ~30%</option>
                </select>
              </div>
            </div>
          )}

          {/* ── Action row ─────────────────────────────── */}
          <div className="action-row">
            <button className="primary-button" type="button" onClick={submit} disabled={!canSubmit || isBusy}>
              {isBusy ? "Đang generate..." : `Generate với ${PROVIDERS.find((p) => p.key === provider)?.label ?? provider}`}
            </button>
            {inputMode === "single" && (
              <button className="secondary-button" type="button" onClick={() => inputRef.current?.click()} disabled={isBusy}>
                Chọn ảnh
              </button>
            )}
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
              <span><b>SF3D</b>: miễn phí, local, nhanh. Dùng <code>birefnet-general</code> để tách nền tốt hơn. Phù hợp vật thể đơn giản.</span>
            </div>
            <div className="info-item">
              <span>◇</span>
              <span><b>Tripo3D</b>: chất lượng cao nhất, hỗ trợ 4-view thật sự. Cần API key tại <b>platform.tripo3d.ai</b>.</span>
            </div>
            <div className="info-item">
              <span>△</span>
              <span><b>InstantMesh</b>: open-source, local. Tạo multi-view nội bộ qua Zero123++ trước khi reconstruct — tốt hơn SF3D cho vật thể phức tạp.</span>
            </div>
          </div>
        </aside>

        {/* ── Right panel: 3D Preview ─────────────────── */}
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
                  <p>Worker đang nhận ảnh, tách nền, dựng mesh, bake texture và export GLB. Thời gian phụ thuộc vào provider và GPU.</p>
                </div>
              </div>
            ) : (
              <div className="empty-stage">
                <div className="empty-stage-inner">
                  <div className="orb">◌</div>
                  <h2>Chưa có model</h2>
                  <p>Chọn một ảnh rõ chủ thể, chọn provider phù hợp rồi bấm Generate. Tripo3D cho kết quả gần nhất với Meshy.</p>
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
