export type Stage = "M1" | "M1.5" | "unknown";

export interface SubmissionSummary {
  id: string;
  vin?: string;
  stage: Stage;
  updatedAt: string;
  assetCount: number;
  thumbnailKey?: string;
}

export interface Asset {
  key: string;
  type: "image" | "document" | "other";
  size?: number;
  lastModified?: string;
  url?: string;
}

export interface SubmissionDetail extends SubmissionSummary {
  vehicle?: Record<string, unknown>;
  seller?: Record<string, unknown>;
  formData?: Record<string, unknown>;
  assets: Asset[];
}
