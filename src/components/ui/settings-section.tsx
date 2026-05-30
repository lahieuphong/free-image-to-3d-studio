"use client";

import { useState } from "react";
import type { ProviderKey, GenerationSettings } from "@/lib/job-types";

interface Preset {
  label: string;
  hint: string;
  settings: Partial<GenerationSettings>;
}

interface Props {
  provider: ProviderKey;
  settings: GenerationSettings;
  presets: Preset[];
  disabled: boolean;
  onChange: (s: GenerationSettings) => void;
  onApplyPreset: (p: Preset) => void;
}

export function SettingsSection({ provider, settings, presets, disabled, onChange, onApplyPreset }: Props) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="settings-accordion">
      <button type="button" className="accordion-header" onClick={() => setIsOpen((v) => !v)}>
        <span className="accordion-title">Chất lượng &amp; Cài đặt</span>
        <span className={`accordion-arrow ${isOpen ? "is-open" : ""}`}>▾</span>
      </button>

      {isOpen && (
        <div className="accordion-body">
          {/* Quality presets */}
          <div>
            <div className="section-label" style={{ marginBottom: 6 }}>Preset nhanh</div>
            <div className="presets-grid">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className="preset-btn"
                  disabled={disabled}
                  onClick={() => onApplyPreset(p)}
                >
                  <strong>{p.label}</strong>
                  <span>{p.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {/* SF3D settings */}
          {provider === "sf3d" && (
            <>
              <div className="form-row">
                <div className="field">
                  <label htmlFor="texture-res">Texture</label>
                  <select
                    id="texture-res"
                    value={settings.textureResolution}
                    disabled={disabled}
                    onChange={(e) => onChange({ ...settings, textureResolution: Number(e.target.value) })}
                  >
                    <option value={512}>512 px — nhanh</option>
                    <option value={1024}>1024 px — cân bằng</option>
                    <option value={2048}>2048 px — đẹp hơn</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="remesh">Remesh</label>
                  <select
                    id="remesh"
                    value={settings.remeshOption}
                    disabled={disabled}
                    onChange={(e) => onChange({ ...settings, remeshOption: e.target.value as GenerationSettings["remeshOption"] })}
                  >
                    <option value="none">None</option>
                    <option value="triangle">Triangle</option>
                    <option value="quad">Quad</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="field">
                  <label htmlFor="fg-ratio">Foreground ratio</label>
                  <input
                    id="fg-ratio"
                    type="number"
                    min={0.55}
                    max={1.4}
                    step={0.05}
                    value={settings.foregroundRatio}
                    disabled={disabled}
                    onChange={(e) => onChange({ ...settings, foregroundRatio: Number(e.target.value) })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="drop-lower">Lower cleanup</label>
                  <input
                    id="drop-lower"
                    type="number"
                    min={0}
                    max={0.8}
                    step={0.01}
                    value={settings.dropLowerRatio}
                    disabled={disabled}
                    onChange={(e) => onChange({ ...settings, dropLowerRatio: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="target-verts">Target vertices (−1 = auto)</label>
                <input
                  id="target-verts"
                  type="number"
                  min={-1}
                  step={500}
                  value={settings.targetVertexCount}
                  disabled={disabled}
                  onChange={(e) => onChange({ ...settings, targetVertexCount: Number(e.target.value) })}
                />
              </div>
            </>
          )}

          {/* Tripo3D settings */}
          {provider === "tripo3d" && (
            <div className="field">
              <label htmlFor="tripo-quality">Quality</label>
              <select
                id="tripo-quality"
                value={settings.tripoQuality}
                disabled={disabled}
                onChange={(e) => onChange({ ...settings, tripoQuality: e.target.value as GenerationSettings["tripoQuality"] })}
              >
                <option value="standard">Standard — cân bằng chất lượng / thời gian</option>
                <option value="detailed">Detailed — mesh đẹp nhất, chậm hơn</option>
              </select>
            </div>
          )}

          {/* InstantMesh settings */}
          {provider === "instantmesh" && (
            <div className="field">
              <label htmlFor="im-config">Config</label>
              <select
                id="im-config"
                value={settings.instantmeshConfig}
                disabled={disabled}
                onChange={(e) => onChange({ ...settings, instantmeshConfig: e.target.value as GenerationSettings["instantmeshConfig"] })}
              >
                <option value="instant-mesh-large">instant-mesh-large — chất lượng cao nhất</option>
                <option value="instant-mesh-base">instant-mesh-base — nhanh hơn ~30%</option>
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
