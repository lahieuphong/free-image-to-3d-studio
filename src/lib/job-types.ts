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

export type ProviderKey = "sf3d" | "tripo3d" | "instantmesh";

export type GenerationSettings = {
  provider: ProviderKey;
  // SF3D
  textureResolution: number;
  remeshOption: "none" | "triangle" | "quad";
  targetVertexCount: number;
  foregroundRatio: number;
  dropLowerRatio: number;
  // Tripo3D
  tripoQuality: "standard" | "detailed";
  // InstantMesh
  instantmeshConfig: "instant-mesh-large" | "instant-mesh-base";
};
