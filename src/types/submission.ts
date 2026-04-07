export type Stage = "M1" | "M1.5" | "unknown";

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

export interface CaseSummary {
  caseKey: string;
  vin?: string;
  m1?: SubmissionSummary;
  m15?: SubmissionSummary;
  openId: string;
  updatedAt: string;
  pipedriveSyncStatus?: string | null;
  pipedriveDealId?: string | null;
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

export interface SubmissionListResponse {
  total: number;
  page: number;
  pageSize: number;
  data: CaseSummary[];
}
