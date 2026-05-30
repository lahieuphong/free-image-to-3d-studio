"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProviderTabs } from "@/components/ui/provider-tabs";
import { ModeTabs } from "@/components/ui/mode-tabs";
import { SingleUpload } from "@/components/ui/single-upload";
import { MultiViewUpload } from "@/components/ui/multi-view-upload";
import { SettingsSection } from "@/components/ui/settings-section";
import { ActionSection } from "@/components/ui/action-section";
import { PreviewPanel } from "@/components/preview-panel";
import type { GenerationJob, GenerationSettings, ProviderKey } from "@/lib/job-types";
import type { InputMode, ViewKey, Stage, ImageDimensions } from "@/lib/ui-types";

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
  { label: "Standard", hint: "Chất lượng tốt, ~1–2 phút",  settings: { tripoQuality: "standard" } },
  { label: "Detailed", hint: "Mesh đẹp hơn, ~3–4 phút",    settings: { tripoQuality: "detailed" } },
];

const INSTANTMESH_PRESETS: Preset[] = [
  { label: "Large", hint: "Chất lượng cao nhất",  settings: { instantmeshConfig: "instant-mesh-large" } },
  { label: "Base",  hint: "Nhanh hơn ~30%",       settings: { instantmeshConfig: "instant-mesh-base" } },
];

const PROVIDER_PRESETS: Record<ProviderKey, Preset[]> = {
  sf3d: SF3D_PRESETS,
  tripo3d: TRIPO_PRESETS,
  instantmesh: INSTANTMESH_PRESETS,
};

// ── View slots ───────────────────────────────────────────────────────────────

const VIEW_SLOTS: Array<{ key: ViewKey; label: string; shortLabel: string }> = [
  { key: "front",  label: "Trước",    shortLabel: "Trước" },
  { key: "left",   label: "Bên trái", shortLabel: "Trái" },
  { key: "right",  label: "Bên phải", shortLabel: "Phải" },
  { key: "back",   label: "Mặt sau",  shortLabel: "Sau" },
  { key: "top",    label: "Trên",     shortLabel: "Trên" },
  { key: "bottom", label: "Dưới",     shortLabel: "Dưới" },
];

const EMPTY_VIEW_FILES: Record<ViewKey, File | null> = { front: null, left: null, right: null, back: null, top: null, bottom: null };
const EMPTY_VIEW_URLS:  Record<ViewKey, string | null> = { front: null, left: null, right: null, back: null, top: null, bottom: null };
const EMPTY_VIEW_DIMS:  Record<ViewKey, ImageDimensions | null> = { front: null, left: null, right: null, back: null, top: null, bottom: null };

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_UPLOAD_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? "20");
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function readError(response: Response) {
  const payload = await response.json().catch(() => null);
  if (payload?.error) return payload.error as string;
  if (payload?.detail) return typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail);
  return "Có lỗi khi gọi AI worker.";
}

function loadImageDimensions(url: string) {
  return new Promise<ImageDimensions>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = url;
  });
}

function setJobQuery(jobId: string | null) {
  const url = new URL(window.location.href);
  if (jobId) url.searchParams.set("job", jobId);
  else url.searchParams.delete("job");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function getImageFileError(file: File) {
  if (!ALLOWED_TYPES.has(file.type)) return "Chỉ hỗ trợ PNG, JPG/JPEG hoặc WEBP.";
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return `File vượt quá ${MAX_UPLOAD_MB}MB.`;
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
    setViewPreviewUrls((c) => { if (c[key]) URL.revokeObjectURL(c[key]!); return { ...c, [key]: nextUrl }; });
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

  const handleProviderChange = (key: ProviderKey) => { setSettings(PROVIDER_DEFAULTS[key]); };

  const applyPreset = (preset: Preset) => { setSettings((cur) => ({ ...cur, ...preset.settings })); };

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

  // ── Derived state ────────────────────────────────────────────────────────

  const isBusy = stage === "queued" || stage === "running";
  const progress = Math.max(0, Math.min(100, Math.round(job?.progress ?? (isBusy ? 6 : 0))));
  const activeViewSlots = inputMode === "six" ? VIEW_SLOTS : VIEW_SLOTS.slice(0, 4);
  const hasAllViewFiles = activeViewSlots.every((s) => Boolean(viewFiles[s.key]));
  const canSubmit = inputMode === "single" ? Boolean(file) : hasAllViewFiles;
  const currentPresets = PROVIDER_PRESETS[provider];
  const providerLabel = PROVIDERS.find((p) => p.key === provider)?.label ?? provider;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="studio">
      {/* ── App header ───────────────────────────────────────── */}
      <header className="studio-header">
        <div className="brand">
          <div className="logo">3D</div>
          <div>
            <div className="brand-text">Free Image to 3D Studio</div>
            <div className="brand-sub">Upload ảnh → AI → GLB</div>
          </div>
        </div>
        <div className="header-badge">
          <span className="status-dot" />
          Next.js + FastAPI · Multi-provider
        </div>
      </header>

      {/* ── Main workspace ───────────────────────────────────── */}
      <div className="studio-body">

        {/* ── Left panel ───────────────────────────────────── */}
        <aside className="studio-left">
          {/* Input mode tabs */}
          <ModeTabs active={inputMode} disabled={isBusy} onChange={setInputMode} />

          {/* Scrollable content */}
          <div className="left-scroll">

            {/* Provider selector */}
            <ProviderTabs
              providers={PROVIDERS}
              active={provider}
              disabled={isBusy}
              inputMode={inputMode}
              onChange={handleProviderChange}
            />

            {/* Upload section */}
            {inputMode === "single" ? (
              <SingleUpload
                file={file}
                previewUrl={previewUrl}
                imageDimensions={imageDimensions}
                isDragging={isDragging}
                disabled={isBusy}
                maxUploadMb={MAX_UPLOAD_MB}
                inputRef={inputRef}
                onFileChange={handleInputChange}
                onDrop={handleDrop}
                onDragOver={() => setIsDragging(true)}
                onDragLeave={() => setIsDragging(false)}
                onClear={clearFile}
              />
            ) : (
              <MultiViewUpload
                viewFiles={viewFiles}
                viewPreviewUrls={viewPreviewUrls}
                viewDimensions={viewDimensions}
                draggingView={draggingView}
                activeViewSlots={activeViewSlots}
                provider={provider}
                disabled={isBusy}
                onViewFileChange={handleViewInputChange}
                onViewDrop={handleViewDrop}
                onViewDragOver={(key) => setDraggingView(key)}
                onViewDragLeave={() => setDraggingView(null)}
                onClear={clearViewFiles}
              />
            )}

            {/* Quality & settings */}
            <SettingsSection
              provider={provider}
              settings={settings}
              presets={currentPresets}
              disabled={isBusy}
              onChange={setSettings}
              onApplyPreset={applyPreset}
            />

            {/* Provider info cards */}
            <div>
              <div className="section-label">Về các provider</div>
              <div className="info-cards">
                <div className="info-card">
                  <span className="info-card-icon">◎</span>
                  <span><b>SF3D</b>: miễn phí, local, nhanh. Dùng <code>birefnet-general</code> để tách nền tốt hơn.</span>
                </div>
                <div className="info-card">
                  <span className="info-card-icon">◇</span>
                  <span><b>Tripo3D</b>: chất lượng cao nhất, hỗ trợ 4-view thật sự. Cần API key tại <b>platform.tripo3d.ai</b>.</span>
                </div>
                <div className="info-card">
                  <span className="info-card-icon">△</span>
                  <span><b>InstantMesh</b>: open-source, local. Tạo multi-view nội bộ qua Zero123++.</span>
                </div>
              </div>
            </div>

          </div>

          {/* Fixed footer: generate button + progress + error */}
          <div className="left-footer">
            <ActionSection
              canSubmit={canSubmit}
              isBusy={isBusy}
              progress={progress}
              job={job}
              error={error}
              providerLabel={providerLabel}
              onSubmit={submit}
            />
          </div>
        </aside>

        {/* ── Right panel: 3-D preview ──────────────────────── */}
        <PreviewPanel
          modelUrl={modelUrl}
          isBusy={isBusy}
          stage={stage}
          job={job}
          progress={progress}
        />

      </div>
    </div>
  );
}
