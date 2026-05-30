"use client";

import type { ImageDimensions } from "@/lib/ui-types";

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

interface Props {
  file: File | null;
  previewUrl: string | null;
  imageDimensions: ImageDimensions | null;
  isDragging: boolean;
  disabled: boolean;
  maxUploadMb: number;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: () => void;
  onDragLeave: () => void;
  onClear: () => void;
}

export function SingleUpload({
  file, previewUrl, imageDimensions, isDragging, disabled, maxUploadMb,
  inputRef, onFileChange, onDrop, onDragOver, onDragLeave, onClear,
}: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="section-label">Ảnh đầu vào</div>

      <div
        className={`upload-zone ${isDragging ? "is-dragging" : ""} ${previewUrl ? "has-preview" : ""}`}
        onDragOver={(e) => { e.preventDefault(); onDragOver(); }}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          className="file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={onFileChange}
          disabled={disabled}
          aria-label="Upload image"
        />
        {previewUrl ? (
          <img className="preview-img" src={previewUrl} alt="Preview input" />
        ) : (
          <div className="upload-placeholder">
            <div className="upload-icon">↥</div>
            <div className="upload-title">Kéo-thả hoặc bấm để chọn ảnh</div>
            <div className="upload-sub">PNG · JPG · WEBP · tối đa {maxUploadMb}MB</div>
          </div>
        )}
      </div>

      {file && (
        <div className="file-meta">
          <div>
            <strong>{file.name}</strong>
            {formatBytes(file.size)} · {file.type}
            {imageDimensions ? ` · ${imageDimensions.width}×${imageDimensions.height}px` : ""}
          </div>
          <button className="btn-secondary" type="button" onClick={onClear} disabled={disabled}>
            Xóa
          </button>
        </div>
      )}

      {imageDimensions && Math.max(imageDimensions.width, imageDimensions.height) < 1024 && (
        <div className="quality-warning">
          Ảnh hơi nhỏ ({imageDimensions.width}×{imageDimensions.height}px). Dùng ảnh ≥ 1024px để texture sắc hơn.
        </div>
      )}
    </div>
  );
}
