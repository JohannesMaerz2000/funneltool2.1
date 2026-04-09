import type {
  SubmissionListResponse,
  SubmissionDetail,
} from "../types/submission";

// 401 listener — App.tsx uses this to show login screen
let unauthorizedCb: (() => void) | null = null;
export function onUnauthorized(cb: () => void) {
  unauthorizedCb = cb;
  return () => { unauthorizedCb = null; };
}

export interface ListParams {
  vin?: string;
  pipedriveDealId?: string;
  views?: Array<"initial" | "partial" | "advance">;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (res.status === 401) {
    unauthorizedCb?.();
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function listSubmissions(params: ListParams = {}): Promise<SubmissionListResponse> {
  const qs = new URLSearchParams();
  if (params.vin) qs.set("vin", params.vin);
  if (params.pipedriveDealId) qs.set("pipedrive_deal_id", params.pipedriveDealId);
  if (params.views && params.views.length > 0) qs.set("views", params.views.join(","));
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.page) qs.set("page", String(params.page));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  return apiFetch<SubmissionListResponse>(`/api/submissions?${qs}`);
}

export function getSubmission(id: string): Promise<SubmissionDetail> {
  return apiFetch<SubmissionDetail>(`/api/submissions/${encodeURIComponent(id)}`);
}

export function getAssetUrl(submissionId: string, key: string): Promise<{ url: string }> {
  const qs = new URLSearchParams({ key });
  return apiFetch<{ url: string }>(
    `/api/submissions/${encodeURIComponent(submissionId)}/asset-url?${qs}`
  );
}

export async function batchPresignUrls(
  items: Array<{ id: string; key: string }>
): Promise<Array<{ key: string; url: string | null }>> {
  const res = await fetch("/api/submissions/presign-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(items),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function createSubmissionImageUploadUrl(input: {
  submissionId: string;
  fileName: string;
  contentType: string;
  category?: string;
}): Promise<{ key: string; uploadUrl: string }> {
  const res = await fetch(`/api/submissions/${encodeURIComponent(input.submissionId)}/upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: input.fileName,
      contentType: input.contentType,
      category: input.category,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ key: string; uploadUrl: string }>;
}

export async function markSubmissionUploadComplete(submissionId: string, key: string): Promise<void> {
  const res = await fetch(
    `/api/submissions/${encodeURIComponent(submissionId)}/upload-complete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}

export async function uploadSubmissionAssetProxy(input: {
  submissionId: string;
  file: File;
  target: "photos" | "papers";
  category?: string;
}): Promise<{ key: string }> {
  const qs = new URLSearchParams({
    fileName: input.file.name,
    target: input.target,
  });
  if (input.category) qs.set("category", input.category);

  const res = await fetch(
    `/api/submissions/${encodeURIComponent(input.submissionId)}/upload-asset?${qs}`,
    {
      method: "POST",
      headers: { "Content-Type": input.file.type || (input.target === "papers" ? "application/pdf" : "image/jpeg") },
      body: input.file,
    }
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<{ key: string }>;
}

export async function deleteSubmissionAsset(submissionId: string, key: string): Promise<void> {
  const qs = new URLSearchParams({ key });
  const res = await fetch(`/api/submissions/${encodeURIComponent(submissionId)}/asset?${qs}`, {
    method: "DELETE",
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}
