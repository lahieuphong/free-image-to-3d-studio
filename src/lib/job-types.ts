export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export type GenerationJob = {
  id: string;
  status: JobStatus;
  progress: number;
  provider: string;
  created_at?: string;
  updated_at?: string;
  result_url?: string | null;
  error?: string | null;
  logs_tail?: string | null;
};

export type GenerationSettings = {
  textureResolution: number;
  remeshOption: "none" | "triangle" | "quad";
  targetVertexCount: number;
  foregroundRatio: number;
  dropLowerRatio: number;
};
