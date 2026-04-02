const DEFAULT_BASE_URL = "https://api-dev.release.seller.aampere.com/api/v1";
const DEFAULT_DEV_API_KEY = "ft_akey_fa5a140ae49341695a1f739fd35931a4";

export interface SellerSubmissionListItem {
  id: string;
  created_at: string;
  updated_at: string;
  vin?: string | null;
  session_id?: string | null;
  form_intake?: string | null;
  form_id?: string | null;
  pipedrive_deal_id?: string | null;
  pipedrive_sync_status?: string | null;
  submission_source?: string | null;
  registration_country?: string | null;
}

export interface SellerSubmissionListResponse {
  total: number;
  page: number;
  pageSize: number;
  items: SellerSubmissionListItem[];
}

export interface SellerSubmissionDetailResponse {
  submission: Record<string, unknown>;
  dat_information: Record<string, unknown> | null;
  vin_history: Record<string, unknown> | null;
  image_processing_jobs: Record<string, unknown>[];
}

export interface SellerSubmissionListParams {
  page?: number;
  pageSize?: number;
  vin?: string;
  from?: string;
  to?: string;
}

export class SellerApiError extends Error {
  status: number;
  body?: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "SellerApiError";
    this.status = status;
    this.body = body;
  }
}

function getSellerApiBaseUrl(): string {
  return process.env.SELLER_API_BASE_URL?.trim() || DEFAULT_BASE_URL;
}

function getSellerApiKey(): string {
  return (
    process.env.SELLER_API_KEY?.trim() ||
    process.env.FUNNELTOOL_SELLER_API_KEY?.trim() ||
    DEFAULT_DEV_API_KEY
  );
}

async function sellerFetch<T>(path: string, searchParams?: URLSearchParams): Promise<T> {
  const apiKey = getSellerApiKey();
  if (!apiKey) {
    throw new SellerApiError("Missing seller API key", 500);
  }

  const qs = searchParams && [...searchParams.keys()].length > 0
    ? `?${searchParams.toString()}`
    : "";
  const url = `${getSellerApiBaseUrl()}${path}${qs}`;

  const res = await fetch(url, {
    headers: {
      "x-api-key": apiKey,
      Accept: "application/json",
    },
  });

  const rawBody = await res.text();
  let parsedBody: unknown = null;
  if (rawBody) {
    try {
      parsedBody = JSON.parse(rawBody) as unknown;
    } catch {
      parsedBody = rawBody;
    }
  }

  if (!res.ok) {
    const message =
      typeof parsedBody === "object" &&
      parsedBody !== null &&
      "error" in parsedBody &&
      typeof (parsedBody as { error?: unknown }).error === "string"
        ? (parsedBody as { error: string }).error
        : `Seller API request failed with ${res.status}`;
    throw new SellerApiError(message, res.status, parsedBody);
  }

  return parsedBody as T;
}

export function fetchSubmissionList(
  params: SellerSubmissionListParams
): Promise<SellerSubmissionListResponse> {
  const qs = new URLSearchParams();
  if (typeof params.page === "number") qs.set("page", String(params.page));
  if (typeof params.pageSize === "number") qs.set("pageSize", String(params.pageSize));
  if (params.vin) qs.set("vin", params.vin);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  return sellerFetch<SellerSubmissionListResponse>("/submissions", qs);
}

export function fetchSubmissionDetail(id: string): Promise<SellerSubmissionDetailResponse> {
  return sellerFetch<SellerSubmissionDetailResponse>(`/submissions/${encodeURIComponent(id)}`);
}
