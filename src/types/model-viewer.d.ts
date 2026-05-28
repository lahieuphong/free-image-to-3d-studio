import type React from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        alt?: string;
        ar?: boolean | string;
        "ar-modes"?: string;
        "auto-rotate"?: boolean | string;
        "camera-controls"?: boolean | string;
        "shadow-intensity"?: string;
        "shadow-softness"?: string;
        exposure?: string;
        "environment-image"?: string;
        "tone-mapping"?: string;
        poster?: string;
        loading?: "auto" | "lazy" | "eager";
        reveal?: "auto" | "interaction" | "manual";
      };
    }
  }
}
