export interface SubmissionSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  vin?: string;
  sessionId?: string;
  formIntake?: string;
  formId?: string;
  pipedriveDealId?: string | null;
  pipedriveSyncStatus?: string | null;
  submissionSource?: string | null;
  registrationCountry?: string | null;
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
  lastSyncedAt?: string | null;
  identifierInformationId?: string | null;
  idempotencyKey?: string | null;
  submission: Record<string, unknown>;
  submissionData?: Record<string, unknown> | null;
  datInformation?: Record<string, unknown> | null;
  vinHistory?: Record<string, unknown> | null;
  imageProcessingJobs: Array<Record<string, unknown>>;
  assets: Asset[];
}
