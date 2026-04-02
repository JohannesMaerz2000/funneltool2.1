import type {
  SubmissionListResponse,
  SubmissionDetail,
} from "../types/submission";

export interface ListParams {
  vin?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function listSubmissions(params: ListParams = {}): Promise<SubmissionListResponse> {
  const qs = new URLSearchParams();
  if (params.vin) qs.set("vin", params.vin);
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
