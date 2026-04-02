# Funnel Tool 2.1 — Project Context

## What this is
Internal inspection tool for seller funnel submissions.

Current architecture is hybrid:
- Submission metadata and enrichment data come from Seller Funnel backend API (DB-backed).
- File assets (images/documents) still come from S3 and are enriched into list/detail responses.

## Tech stack
- **Frontend:** Vite 5, React 18, TypeScript, Tailwind CSS 3, TanStack Query v5, React Router v6
- **Backend:** Express 4, TypeScript, AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`)
- **Runtime:** `tsx` (watch mode for server), Node 20+

## How to run
```bash
npm run dev        # starts both concurrently (Vite :5173 + Express :3001)
npm run server     # server only
npm run build      # production build
```

## Configuration
### AWS / S3
- `.env.aws` is loaded by `server/index.ts` before route code executes.
- Required:
  - `AWS_ACCESS_KEY_ID`
  - `AWS_SECRET_ACCESS_KEY`
  - `AWS_REGION` or `AWS_DEFAULT_REGION` (default: `eu-central-1`)
  - `S3_BUCKET` (default: `seller-funnel-development`)

### Seller API (DB source)
- Base URL default: `https://api-dev.release.seller.aampere.com/api/v1`
- API key env override options:
  - `SELLER_API_KEY`
  - `FUNNELTOOL_SELLER_API_KEY`
- Base URL env override:
  - `SELLER_API_BASE_URL`

Implementation is in `server/sellerApi.ts`.

## Project structure
```
funneltool2.1/
├── .env.aws
├── CONTEXT.md
├── endpoint_request.md
├── schema_result.txt
├── server/
│   ├── index.ts               # Express entry; loads .env.aws
│   ├── s3.ts                  # S3 client + list/get/presign helpers
│   ├── sellerApi.ts           # External Seller BE client (list/detail)
│   ├── parser.ts              # S3 asset parsing helpers (asset type/count/thumbnail)
│   ├── types.ts               # Server response models
│   └── routes/
│       └── submissions.ts     # API routes; DB + S3 enrichment
└── src/
    ├── api/client.ts          # frontend fetch wrappers
    ├── types/submission.ts    # mirrors server/types.ts
    ├── pages/SubmissionList.tsx
    ├── pages/SubmissionDetail.tsx
    └── components/
        ├── AssetGallery.tsx
        └── DataSection.tsx
```

## Data sources and mapping
### Seller backend API
- `GET /api/v1/submissions`
  - Params: `page`, `pageSize`, `vin`, `from`, `to`
- `GET /api/v1/submissions/:id`
  - Returns `submission`, `dat_information`, `vin_history`, `image_processing_jobs`

### S3
- Bucket: `seller-funnel-development`
- Prefix: `advance/`
- Real-world structure is typically `advance/<vin>/<files...>` (not submission UUID).

Because DB record IDs and S3 folder keys can differ, server enrichment resolves S3 data by:
1. submission id
2. vin (fallback)
3. case-insensitive matching

This logic lives in `server/routes/submissions.ts`.

## Internal API endpoints (Express)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | liveness check |
| GET | `/api/submissions` | DB-backed list (`vin`, `from`, `to`, `page`, `pageSize`) + S3 `assetCount`/`thumbnailKey` enrichment |
| GET | `/api/submissions/:id` | DB-backed detail + S3 `assets` enrichment |
| POST | `/api/submissions/presign-batch` | batch presign for S3 keys (max 200 items) |
| GET | `/api/submissions/:id/asset-url?key=` | presigned S3 URL |
| GET | `/api/submissions/:id/download?key=` | proxy S3 file download |
| GET | `/api/submissions/:id/download-all` | zip all image assets for the submission |

## Frontend behavior
- **List page**
  - Filters: VIN, from date, to date, page size
  - Shows DB fields (form intake, sync status, deal ID, timestamps)
  - Shows S3 thumbnail and `assetCount` from enrichment
- **Detail page**
  - Shows normalized DB sections:
    - `submission`
    - `submission_data`
    - `dat_information`
    - `vin_history`
    - `image_processing_jobs`
  - Shows S3 asset gallery (images, PDFs, docs) via batch presigned URLs

## Key design decisions
- Credentials and API keys stay server-side only.
- No auth layer in this internal local tool yet.
- S3 listing/grouping is cached in-memory for 5 minutes.
- `raw_images` path segments are excluded from visible assets and presign/download flows.
- Server and client types are intentionally duplicated (`server/types.ts` and `src/types/submission.ts`) and must be kept in sync.

## Recent migration notes (2026-04-02)
- Completed full transition from S3-derived submission metadata to DB-backed submission metadata.
- Kept S3 assets as enrichment for thumbnails/gallery/downloads.
- Fixed post-migration image regression:
  - Root cause: S3 keys are VIN-based while DB detail route uses submission UUID.
  - Fix: resolve assets by `id OR vin`, case-insensitive, and validate S3 key by allowed prefix (`advance/`) rather than strict `advance/<submission-id>/...`.
