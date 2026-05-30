"use client";

import type { ProviderKey } from "@/lib/job-types";
import type { InputMode } from "@/lib/ui-types";

interface ProviderItem {
  key: ProviderKey;
  label: string;
  tag: string;
  note: string;
}

interface Props {
  providers: ProviderItem[];
  active: ProviderKey;
  disabled: boolean;
  inputMode: InputMode;
  onChange: (key: ProviderKey) => void;
}

export function ProviderTabs({ providers, active, disabled, inputMode, onChange }: Props) {
  return (
    <div>
      <div className="section-label">Provider</div>
      <div className="provider-tabs">
        {providers.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`provider-tab ${active === p.key ? "is-active" : ""}`}
            disabled={disabled}
            title={p.note}
            onClick={() => onChange(p.key)}
          >
            <strong>{p.label}</strong>
            <span>{p.tag}</span>
          </button>
        ))}
      </div>

      {active === "tripo3d" && (
        <div className="info-box info-box-warning" style={{ marginTop: 8 }}>
          Tripo3D dùng REST API. Cần <code>TRIPO3D_API_KEY</code> trong <code>.env</code> của AI worker.
          {inputMode !== "single" && (
            <> Với 4-view, Tripo3D dùng <strong>tất cả 4 ảnh</strong> để reconstruct.</>
          )}
        </div>
      )}
      {active === "instantmesh" && (
        <div className="info-box info-box-success" style={{ marginTop: 8 }}>
          InstantMesh cần clone repo và cài GPU deps. Tự sinh multi-view nội bộ qua Zero123++.
        </div>
      )}
    </div>
  );
}
