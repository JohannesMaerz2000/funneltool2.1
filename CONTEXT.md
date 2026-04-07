# Funnel Tool 2.1 — Project Context

## What this is
Internal inspection tool for seller funnel submissions.

Our startup lets electric vehicle owners sell their car through our platform. The seller journey has two stages:

1. **M1 (initial)** — Seller fills out a short first form with basic vehicle + contact info. They receive a price estimate by email.
2. **M1.5 (advance)** — If the seller is interested, they click a link in the email and fill out a detailed condition form including photo/document uploads. M1.5 can only be started after a successful M1.

M1 and M1.5 submissions are **linked by VIN**. When both exist, the tool must merge/present them as a single case. M1.5 always has a `pipedriveDealId`; M1 typically does not until it is synced.

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
├── actualexampleresponses/       # Real API response examples (4 files)
│   ├── m1completed.json          # M1, pipedriveSyncStatus=completed
│   ├── m1pending.json            # M1, pipedriveSyncStatus=pending
│   ├── m15completed.json         # M1.5, pipedriveSyncStatus=completed, with S3 assets
│   └── m15pending.json           # M1.5, pipedriveSyncStatus=pending, submissionData=null
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

## Submission data model

The API always returns a flat object with these top-level fields:

| Field | Description |
|-------|-------------|
| `id` | Submission UUID |
| `vin` | Vehicle Identification Number — **primary join key between M1 and M1.5** |
| `formIntake` | `"initial"` = M1 · `"advance"` = M1.5 |
| `formId` | `"initial-intake-v1"` or `"advance-intake-v1"` |
| `pipedriveDealId` | Set on M1.5; may be set on M1 after sync |
| `pipedriveSyncStatus` | `"pending"` or `"completed"` |
| `submissionSource` | e.g. `"internal_form"` |
| `registrationCountry` | ISO country code |
| `lastSyncedAt` | Timestamp of last Pipedrive sync, or null |
| `identifierInformationId` | FK to `datInformation` |
| `idempotencyKey` | Dedup key (present on M1, often null on M1.5) |
| `submission` | Snake_case mirror of the above fields (redundant, can be ignored in UI) |
| `submissionData` | Form payload — shape differs by `formIntake` (see below) |
| `datInformation` | DAT vehicle data (make, model, variant, equipments, etc.) |
| `vinHistory` | VIN lookup history (match_count, first_registration, etc.) |
| `imageProcessingJobs` | Array of image processing job records (M1.5 only) |
| `assetCount` | S3 asset count enriched by server |
| `thumbnailKey` | S3 key of first exterior photo, or null |
| `assets` | Array of S3 asset objects `{ key, type, size, lastModified }` |

### `submissionData` shape by form type

**M1 (initial)** — contact + vehicle basics:
```ts
{
  vin, email, phone, firstName, lastName,
  mileage, sellerType,          // "private" | "dealer"
  newsLetter, whatsappConsent, policyConfirmation,
  gClId, fbClId, gaClientId,
  utmSource, utmMedium, utmCampaign, utmContent, utmTerm
}
```

**M1.5 (advance)** — vehicle condition:
```ts
{
  mileage, tuvUntil, accidentFree, accidentDescription,
  numberOfOwners, numberOfKeys, formOfOwnership,
  isPetCar, isSmokerCar, hasTrailerHitch,
  tyreTypes, tyreDetails,       // per-type: rimSize, rimType, treadCondition
  vehicleDefects,               // [{ type, description, photos[] }]
  vehicleDocuments,             // ["coc_certificate", "registration_document", ...]
  chargingCable,                // { typ2, schuko }
  digitalCheckbook, digitalCheckbookPhotos,
  serviceHistoryMaintained, registrationDocumentOwner,
  pickupAgreement, vehicleAgreement, informationDisclosureAgreement,
  additionalAccessories, nonOriginalConditionDescription
}
```

> `submissionData` can be **null** on M1.5 when the seller has not yet completed the detailed form.

### `datInformation` fields (key ones)
- `make`, `model`, `variant`, `description`
- `first_registration`, `mileage`, `power_kw`, `capacity`, `fuel_method`, `drive_type`
- `dat_ecode`, `container`, `kba_number[]`
- `special_equipments[]` — has `isSelected` flag (true = confirmed by seller)
- `standard_equipments[]` — base equipment list; items may have `containedEquipments[]`
- `extra_equipments[]` — additional equipment beyond standard

### M1 ↔ M1.5 case linking
- **Join key: `vin`**
- The API returns M1 and M1.5 as separate submission records in the list endpoint
- The tool must group/merge them by VIN into a single "case"
- A case can be: M1-only · M1.5-only (rare) · M1 + M1.5 merged
- When merged, M1.5 data takes precedence for vehicle condition; M1 supplies contact info

## Data sources and mapping
### Seller backend API
- `GET /api/v1/submissions`
  - Params: `page`, `pageSize`, `vin`, `from`, `to`
- `GET /api/v1/submissions/:id`
  - Returns `submission`, `dat_information`, `vin_history`, `image_processing_jobs`

### S3
- Bucket: `seller-funnel-development`
- Prefix: `advance/`
- Real-world structure: `advance/<vin>/<folder>/<files...>`
- Folders: `01_Fahrzeugpapiere/` (documents), `02_Fahrzeugfotos/` (photos)
- File naming convention: `<index>_<category>_<hash><vin-prefix>.<ext>`
  - Categories: `exterior`, `interior`, `rims`, `defects`, `registration_document`, etc.
- `raw_images/` path segments are excluded from visible assets

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
  - **Planned:** group by VIN so M1 + M1.5 appear as one merged case row
- **Detail page**
  - Shows normalized DB sections:
    - `submission`
    - `submission_data`
    - `dat_information`
    - `vin_history`
    - `image_processing_jobs`
  - Shows S3 asset gallery (images, PDFs, docs) via batch presigned URLs
  - **Planned:** when a VIN has both M1 and M1.5, show combined view

## Key design decisions
- Credentials and API keys stay server-side only.
- No auth layer in this internal local tool yet.
- S3 listing/grouping is cached in-memory for 5 minutes.
- `raw_images` path segments are excluded from visible assets and presign/download flows.
- Server and client types are intentionally duplicated (`server/types.ts` and `src/types/submission.ts`) and must be kept in sync.
- The `submission` field in the API response is a redundant snake_case mirror of top-level camelCase fields and should not be separately displayed in the UI.

## Recent migration notes (2026-04-02)
- Completed full transition from S3-derived submission metadata to DB-backed submission metadata.
- Kept S3 assets as enrichment for thumbnails/gallery/downloads.
- Fixed post-migration image regression:
  - Root cause: S3 keys are VIN-based while DB detail route uses submission UUID.
  - Fix: resolve assets by `id OR vin`, case-insensitive, and validate S3 key by allowed prefix (`advance/`) rather than strict `advance/<submission-id>/...`.

## Planned improvements (as of 2026-04-07)
- Group M1 + M1.5 submissions by VIN into a single merged "case" in list and detail views
- Cleaner data structure reflecting the two distinct form types
- Differentiated display of M1 contact data vs M1.5 vehicle condition data
