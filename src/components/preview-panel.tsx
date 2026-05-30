"use client";

import { ModelViewer } from "@/components/model-viewer";
import type { GenerationJob } from "@/lib/job-types";
import type { Stage } from "@/lib/ui-types";

interface Props {
  modelUrl: string | null;
  isBusy: boolean;
  stage: Stage;
  job: GenerationJob | null;
  progress: number;
}

export function PreviewPanel({ modelUrl, isBusy, job, progress }: Props) {
  return (
    <section className="studio-right">
      {/* 3-D viewport */}
      <div className="model-stage">
        {modelUrl ? (
          <ModelViewer src={modelUrl} />
        ) : isBusy ? (
          <div className="stage-placeholder">
            <div className="stage-content">
              <div className="spinner" />
              <div className="stage-title">Đang tạo mô hình 3D</div>
              <div className="stage-sub">
                Worker đang tách nền, dựng mesh, bake texture và export GLB.
                Thời gian phụ thuộc vào provider và GPU.
              </div>
            </div>
          </div>
        ) : (
          <div className="stage-placeholder">
            <div className="stage-content">
              <div className="stage-orb">◌</div>
              <div className="stage-title">Chưa có model</div>
              <div className="stage-sub">
                Chọn ảnh rõ chủ thể, chọn provider phù hợp rồi bấm Generate.
                Tripo3D cho kết quả gần nhất với Meshy.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Status footer */}
      <div className="viewer-footer">
        <div className="job-info">
          <span className="status-dot" />
          {job ? (
            <>
              <span className="job-id">Job {job.id.slice(0, 8)}</span>
              <span className={`status-badge ${job.status}`}>{job.status}</span>
              <span>{progress}%</span>
            </>
          ) : (
            <span>Sẵn sàng</span>
          )}
        </div>

        {modelUrl && job && (
          <a className="download-btn" href={modelUrl} download={`${job.id}.glb`}>
            ↓ Tải GLB
          </a>
        )}
      </div>
    </section>
  );
}
