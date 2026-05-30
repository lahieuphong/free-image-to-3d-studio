"use client";

import type { ProviderKey } from "@/lib/job-types";
import type { ViewKey, ImageDimensions } from "@/lib/ui-types";

interface ViewSlot {
  key: ViewKey;
  label: string;
  shortLabel: string;
}

interface Props {
  viewFiles: Record<ViewKey, File | null>;
  viewPreviewUrls: Record<ViewKey, string | null>;
  viewDimensions: Record<ViewKey, ImageDimensions | null>;
  draggingView: ViewKey | null;
  activeViewSlots: ViewSlot[];
  provider: ProviderKey;
  disabled: boolean;
  onViewFileChange: (key: ViewKey, e: React.ChangeEvent<HTMLInputElement>) => void;
  onViewDrop: (key: ViewKey, e: React.DragEvent<HTMLDivElement>) => void;
  onViewDragOver: (key: ViewKey) => void;
  onViewDragLeave: () => void;
  onClear: () => void;
}

export function MultiViewUpload({
  viewFiles, viewPreviewUrls, viewDimensions,
  draggingView, activeViewSlots, provider, disabled,
  onViewFileChange, onViewDrop, onViewDragOver, onViewDragLeave, onClear,
}: Props) {
  const filled = activeViewSlots.filter((s) => viewFiles[s.key]).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="section-label">Ảnh đầu vào</div>

      <div className="multi-view-grid">
        {activeViewSlots.map((slot) => {
          const slotUrl = viewPreviewUrls[slot.key];
          const slotFile = viewFiles[slot.key];
          const slotDim = viewDimensions[slot.key];
          return (
            <div
              key={slot.key}
              className={[
                "view-slot",
                slot.key === "front" ? "view-slot-front" : "",
                draggingView === slot.key ? "is-dragging" : "",
              ].filter(Boolean).join(" ")}
              onDragOver={(e) => { e.preventDefault(); onViewDragOver(slot.key); }}
              onDragLeave={onViewDragLeave}
              onDrop={(e) => onViewDrop(slot.key, e)}
            >
              <input
                key={`${slot.key}-${slotUrl ? "filled" : "empty"}`}
                className="file-input"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => onViewFileChange(slot.key, e)}
                disabled={disabled}
                aria-label={`Upload ${slot.label}`}
              />
              {slotUrl ? (
                <img className="view-slot-image" src={slotUrl} alt={slot.label} />
              ) : (
                <div className="view-slot-placeholder">
                  <span>{slot.shortLabel}</span>
                  <small>PNG/JPG/WEBP</small>
                </div>
              )}
              <div className="view-slot-label">
                <strong>{slot.label}</strong>
                {slotFile && slotDim ? <span>{slotDim.width}×{slotDim.height}</span> : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="multi-view-meta">
        <span>{filled} / {activeViewSlots.length} ảnh đã chọn</span>
        <button className="btn-secondary" type="button" onClick={onClear} disabled={disabled}>
          Xóa tất cả
        </button>
      </div>

      {provider === "tripo3d" ? (
        <div className="info-box info-box-success">
          Tripo3D hỗ trợ multi-view — 4 góc cho reconstruct chính xác hơn nhiều.
        </div>
      ) : (
        <div className="quality-warning">
          {provider === "sf3d"
            ? "SF3D chỉ dùng ảnh Trước. Các góc còn lại là tham chiếu."
            : "InstantMesh tự sinh multi-view nội bộ — chỉ cần ảnh Trước."}
        </div>
      )}
    </div>
  );
}
