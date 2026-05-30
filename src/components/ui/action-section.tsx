"use client";

import type { GenerationJob } from "@/lib/job-types";

interface Props {
  canSubmit: boolean;
  isBusy: boolean;
  progress: number;
  job: GenerationJob | null;
  error: string | null;
  providerLabel: string;
  onSubmit: () => void;
}

export function ActionSection({ canSubmit, isBusy, progress, job, error, providerLabel, onSubmit }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {isBusy && (
        <div className="progress-section">
          <div className="progress-header">
            <span>{job?.status === "running" ? "AI đang dựng mesh…" : "Đang vào hàng đợi…"}</span>
            <b>{progress}%</b>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {error && <div className="alert">{error}</div>}

      <button
        type="button"
        className="btn-primary"
        disabled={!canSubmit || isBusy}
        onClick={onSubmit}
      >
        {isBusy ? "Đang generate…" : `Generate với ${providerLabel}`}
      </button>
    </div>
  );
}
