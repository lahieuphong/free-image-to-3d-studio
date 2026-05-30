"use client";

import type { InputMode } from "@/lib/ui-types";

const MODES: { mode: InputMode; label: string }[] = [
  { mode: "single", label: "1 Ảnh" },
  { mode: "four",   label: "4 Góc" },
  { mode: "six",    label: "6 Ảnh" },
];

interface Props {
  active: InputMode;
  disabled: boolean;
  onChange: (mode: InputMode) => void;
}

export function ModeTabs({ active, disabled, onChange }: Props) {
  return (
    <div className="mode-tab-bar" role="tablist" aria-label="Input mode">
      {MODES.map((t) => (
        <button
          key={t.mode}
          type="button"
          role="tab"
          aria-selected={active === t.mode}
          className={`mode-tab-btn ${active === t.mode ? "is-active" : ""}`}
          disabled={disabled}
          onClick={() => onChange(t.mode)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
