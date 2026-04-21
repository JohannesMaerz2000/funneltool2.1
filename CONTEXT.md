# Funnel Tool 2.1 — Project Context

## What this is
Internal inspection tool for seller funnel submissions.

Our startup lets EV owners sell their car through a two-step funnel:

1. **M1 (initial)** — short form with contact + basic vehicle data
2. **M1.5 (advance)** — detailed condition form, started from M1 email link

M1 and M1.5 are surfaced as one case in the tool (case grouping key is currently VIN).

Current architecture is hybrid:
- Submission metadata and enrichment data come from Seller Funnel backend API (DB-backed).
- File assets (images/documents) come from S3 and are enriched into list/detail responses.

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
- Base URL default in code: `http://api.seller.aampere.com/`
- Runtime normalization: base URL is normalized to end with `/api/v1`
- API key env options:
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
├── actualexampleresponses/
│   ├── advancepartial.json
│   ├── m1completed.json
│   ├── m1pending.json
│   ├── m15completed.json
│   └── dfgh.txt
├── server/
│   ├── index.ts
│   ├── s3.ts
│   ├── sellerApi.ts
│   ├── parser.ts
│   ├── types.ts
│   └── routes/
│       └── submissions.ts
└── src/
    ├── api/client.ts
    ├── types/submission.ts
    ├── pages/SubmissionList.tsx
    ├── pages/SubmissionDetail.tsx
    └── components/
        ├── AssetGallery.tsx
        ├── DataSection.tsx
        ├── StageBadge.tsx
        └── ui.ts
```

## Data model

### Submission summary fields
`SubmissionSummary` (server + client types):
- `id`, `createdAt`, `updatedAt`
- `vin`, `sessionId`, `formIntake`, `formId`
- `pipedriveDealId`, `pipedriveSyncStatus`
- `submissionSource`, `registrationCountry`
- `assetCount`, `thumbnailKey`

### Case model (VIN grouping)
`CaseSummary`:
- `caseKey` (VIN uppercase or `NO_VIN:<id>`)
- `vin`
- `m1` (`initial`) optional
- `m15` (`advance`) optional
- `openId` (prefers M1.5 id when available)
- `updatedAt` (latest across members)
- `pipedriveSyncStatus` (prefers M1.5)
- `pipedriveDealId` (prefers M1.5)
- `assetCount`, `thumbnailKey` (prefer richer record)

### Case status semantics (current)
- `initial`: M1 exists, and advance is not completed and has no visible S3 assets yet.
- `partial`: advance is not completed, but visible S3 assets already exist.
- `completed`: advance exists with sync status `completed`.

Important behavior note:
- `initial` and `completed` are case-level states, not per-intake completion labels; finishing M1 auto-creates an advance submission.
- Advance `submissionData` is typically only persisted after completion, so in-progress advance data cannot be read from DB `submissionData`; progress is inferred from S3 assets.

### Detail model
`SubmissionDetail` extends `SubmissionSummary` with:
- `lastSyncedAt`, `identifierInformationId`, `idempotencyKey`
- `submission` (snake_case source object)
- `submissionData`
- `datInformation`
- `vinHistory`
- `imageProcessingJobs`
- `assets`

`submissionData` can be `null` on M1.5 when an advance form is not completed yet.
When that happens, the tool still uses M1 data and S3 assets to represent the case.

## Data sources and mapping
### Seller backend API (upstream)
- `GET /api/v1/submissions`
  - Used with `page`, `pageSize`, `vin`, `from`, `to`
- `GET /api/v1/submissions/:id`
  - Returns `submission`, `dat_information`, `vin_history`, `image_processing_jobs`

### S3
- Bucket: `seller-funnel-development`
- Prefix: `advance/`
- Real structure: `advance/<vin>/<folder>/<files...>`
- Folders:
  - `01_Fahrzeugpapiere/` (documents)
  - `02_Fahrzeugfotos/` (photos)
- `raw_images/` segments are excluded from visible/presigned/downloadable assets

S3 enrichment resolves by:
1. submission id
2. VIN fallback
3. case-insensitive matching

S3 object/group cache TTL is 5 minutes.

## Internal API endpoints (Express)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | liveness check |
| GET | `/api/submissions` | grouped case list (`data: CaseSummary[]`) with S3 `assetCount`/`thumbnailKey` enrichment |
| GET | `/api/submissions/by-vin/:vin` | resolve VIN to case open id (prefers M1.5) |
| GET | `/api/submissions/:id` | detail for one submission + enriched `assets` |
| POST | `/api/submissions/presign-batch` | batch presign for S3 keys (max 200) |
| POST | `/api/submissions/:id/upload-url` | presigned upload URL for images |
| POST | `/api/submissions/:id/upload-complete` | cache bust after upload completion |
| POST | `/api/submissions/:id/upload-asset` | direct upload proxy (photos or papers) |
| POST | `/api/submissions/:id/asset/rotate` | rotate one image asset (90/180/270) |
| DELETE | `/api/submissions/:id/asset?key=` | delete one asset |
| GET | `/api/submissions/:id/asset-url?key=` | presigned read URL |
| GET | `/api/submissions/:id/download?key=` | proxy file download |
| GET | `/api/submissions/:id/download-all` | zip all image assets |

### `/api/submissions` query params
- `page`, `pageSize`
- `vin`
- `from`, `to` (ISO date)
- `views=initial,partial,advance` (server values; defaults to all three)
- `pipedrive_deal_id`
- `intake` (`initial|advance`) for legacy client compatibility

Notes:
- Server fetches upstream in pages of 100 and groups locally by VIN.
- Fetch depth is tiered:
  - default list requests (no VIN/deal search): max 10 upstream pages (up to 1000 records).
  - search requests (`vin` and/or `pipedrive_deal_id`): max 100 upstream pages (up to 10,000 records).
- VIN-only resilience fallback:
  - first pass uses upstream VIN filtering.
  - if no case is found, backend retries with a global scan (up to 10,000) and local normalized VIN matching.
- Search matching is normalized (case-insensitive, tolerant to separators/formatting differences).
- Backend view filtering behavior:
  - `initial`: awaiting advance (no completed advance and no assets on advance)
  - `partial`: in-progress advance (not completed, but assets exist)
  - `advance`: completed advance
- If both `vin` and `pipedrive_deal_id` are provided, filtering is OR-based (global search mode).

## Frontend behavior
### List page (`src/pages/SubmissionList.tsx`)
- Uses grouped case API (`data` array).
- View tabs/states are:
  - `initial`
  - `partial`
  - `completed`
- Frontend maps `completed` to backend `advance` in API calls.
- Search filters VIN or deal ID.
- Date filters (`from` / `to`) and paging.
- Row click opens selected case member detail (`openId` / selected summary id).
- Thumbnails resolved via `/presign-batch`.
- List rows show one case state badge and no source column.

### Detail page (`src/pages/SubmissionDetail.tsx`)
- Loads selected submission.
- Attempts to fetch linked opposite intake with multi-key matching:
  1. candidate collection by `pipedriveDealId` (if present), plus VIN fallback
  2. candidate scoring preference:
     - `identifierInformationId` match (strongest)
     - `pipedriveDealId` match
     - VIN match
- Builds combined display:
  - **Submission Data:** always includes M1 data when available; M1.5 fields override overlapping keys.
  - If M1.5 exists with `submissionData=null` (partial), M1 data still shows.
  - Contact panel sourced from M1 data where available.
  - Car panel prefers DAT from M1.5 then M1.
- Shows one unified case state (`initial|partial|completed`) in the overview panel.
- Does not show separate M1/M1.5 source badges.
- Assets gallery merges M1 + M1.5 assets and supports upload/delete/download.

## Key design decisions
- Credentials and API keys stay server-side.
- No auth layer in this internal local tool yet.
- `submission` is kept as raw upstream mirror; normalized camelCase fields are used for UI logic.
- Server and client types are intentionally duplicated (`server/types.ts` and `src/types/submission.ts`) and must stay in sync.

## Migration notes (2026-04-02)
- Submission metadata moved from S3-derived to DB-backed source.
- S3 remains enrichment layer for thumbnails/assets/downloads.
- Post-migration asset resolution fix:
  - resolve by `id OR vin`
  - case-insensitive lookup
  - allowed prefix validation (`advance/`) instead of strict `advance/<submission-id>/...`
