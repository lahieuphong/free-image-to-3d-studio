"use client";

import { useEffect } from "react";

type ModelViewerProps = {
  src: string;
};

export function ModelViewer({ src }: ModelViewerProps) {
  useEffect(() => {
    void import("@google/model-viewer");
  }, []);

  return (
    <model-viewer
      className="model-viewer"
      src={src}
      alt="Generated 3D GLB model"
      camera-controls
      auto-rotate
      ar
      ar-modes="webxr scene-viewer quick-look"
      shadow-intensity="1"
      shadow-softness="0.8"
      exposure="1.05"
      environment-image="neutral"
      tone-mapping="aces"
      loading="eager"
    />
  );
}
