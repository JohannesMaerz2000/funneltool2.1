# Funnel Tool 2.1 — Project Context

## What this is
Internal tool for inspecting seller funnel submissions stored in S3. Shows a searchable list of submissions and a detail view with form data, vehicle/seller info, and file assets.

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

## Project structure
```
funneltool2.1/
├── .env.aws                  # AWS credentials — never commit, never expose to client
├── IMPLEMENTATION_PLAN.md
├── CONTEXT.md                # this file
├── vite.config.ts            # proxies /api/* → http://localhost:3001
├── tailwind.config.js
├── tsconfig.app.json         # frontend typecheck
├── tsconfig.server.json      # server typecheck
│
├── server/
│   ├── index.ts              # Express entry point; loads .env.aws before anything else
│   ├── s3.ts                 # S3 client (lazy singleton), list/get/presign helpers
│   ├── parser.ts             # groups S3 objects by submission, extracts VIN/stage/assets
│   ├── types.ts              # SubmissionSummary, SubmissionDetail, Asset, Stage
│   └── routes/
│       └── submissions.ts    # GET /api/submissions, /:id, /:id/asset-url
│
└── src/
    ├── main.tsx              # React entry, QueryClient, BrowserRouter
    ├── App.tsx               # shell layout + routes
    ├── index.css             # Tailwind directives
    ├── api/
    │   └── client.ts         # fetch wrappers: listSubmissions, getSubmission, getAssetUrl
    ├── types/
    │   └── submission.ts     # mirrors server/types.ts (kept in sync manually)
    ├── pages/
    │   ├── SubmissionList.tsx  # table, search/filter/pagination
    │   └── SubmissionDetail.tsx # header + DataSection + AssetGallery
    └── components/
        ├── StageBadge.tsx    # coloured badge for M1 / M1.5 / unknown
        ├── AssetGallery.tsx  # lists assets; fetches presigned URL on demand
        └── DataSection.tsx   # renders Record<string,unknown> as key/value table
```

## S3 data model
- Bucket: `seller-funnel-development`
- Prefix: `advance/`
- Structure: `advance/<submission-id>/<files…>`
- The largest `.json` file in a submission folder is treated as the form payload
- VIN extracted from common field names: `vin`, `VIN`, `vehicleIdentificationNumber`, `vehicle.vin`
- Stage detected from payload fields (`stage`, `step`) or key path patterns (`m1`, `m1.5`)

## API endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | liveness check |
| GET | `/api/submissions` | list with filters: `query`, `stage`, `from`, `to`, `page`, `pageSize` |
| GET | `/api/submissions/:id` | full detail including assets |
| GET | `/api/submissions/:id/asset-url?key=` | returns presigned S3 URL (1 h TTL) |

## Key design decisions
- **Credentials stay server-side.** `.env.aws` is loaded in `server/index.ts` body; S3 client is a lazy singleton so it reads env vars only after they are populated (avoids ES module hoisting issue).
- **No auth layer yet.** Tool is internal/local only.
- **30 s object-list cache** in `submissions.ts` to avoid hammering S3 on every request.
- **Types duplicated** between `server/types.ts` and `src/types/submission.ts` — keep them in sync when changing the data model.
- **Presigned URLs on demand** — not fetched until the user clicks "Get link", keeping the list view fast.
