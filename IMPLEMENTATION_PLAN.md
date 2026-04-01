# Funnel Tool 2.0 – Implementation Plan (V1)

## 1) Goal
Build an internal Vite + React web app that gives operations teams:
- A **list view** of submissions from `s3://seller-funnel-development/advance/`
- A **detail view** per submission, including form data and media/documents

This replaces the current fragmented workflow across multiple tools and gives one central place to inspect M1 and M1.5 related submission data.

## 2) Scope for First Release (MVP)
### In scope
- Connect to AWS S3 using credentials from local `.env.aws`
- Read objects under `advance/`
- Derive “submission records” from existing S3 object structure
- List view with:
  - Submission ID (derived)
  - VIN (if available)
  - Stage indicator (M1 / M1.5 / unknown)
  - Last updated timestamp
  - Asset count
  - Search + basic filters
- Detail view with:
  - Core fields (VIN, vehicle basics, seller info if present)
  - Timeline/meta (created/updated)
  - Uploaded images/documents with preview/download links
- Error and loading states

### Out of scope (for MVP)
- Editing submissions
- Writing back to S3
- Full auth/SSO rollout (we can gate locally first, then add proper auth)
- Analytics dashboards
- Workflow automation actions

## 3) Proposed Technical Approach
## Frontend
- `Vite + React + TypeScript`
- Routing: `react-router-dom`
- Server state: `@tanstack/react-query`
- Table/list UI: simple custom table first (optionally TanStack Table later)
- Styling: lightweight CSS or Tailwind (decision can be made before implementation starts)

## Backend access pattern (recommended)
Use a small internal API layer (Node/Express or Vite server route) instead of direct S3 calls from browser.

Why:
- Keeps AWS credentials off the client
- Central place for parsing/normalizing inconsistent S3 structures
- Easier pagination/filtering and future auth

Initial API endpoints:
- `GET /api/submissions?query=&stage=&from=&to=&page=&pageSize=`
- `GET /api/submissions/:id`
- `GET /api/submissions/:id/assets` (or included in detail response)

## AWS integration
- AWS SDK v3 (`@aws-sdk/client-s3`)
- Bucket: `seller-funnel-development`
- Prefix: `advance/`
- Region from env (`eu-central-1`)

## 4) Data Mapping Strategy (S3 -> Submission Model)
Because S3 is object storage (not relational), we will implement a mapping layer:

1. List objects under `advance/` (paginated)
2. Group by inferred submission key (folder/prefix pattern)
3. Detect file roles by naming/path heuristics:
   - Form payload files (JSON/CSV/etc.)
   - Image files
   - Document files
4. Parse structured files and normalize into one internal shape:

```ts
type SubmissionSummary = {
  id: string;
  vin?: string;
  stage: "M1" | "M1.5" | "unknown";
  updatedAt: string;
  assetCount: number;
};

type SubmissionDetail = SubmissionSummary & {
  vehicle?: Record<string, unknown>;
  seller?: Record<string, unknown>;
  formData?: Record<string, unknown>;
  assets: Array<{
    key: string;
    type: "image" | "document" | "other";
    size?: number;
    lastModified?: string;
    url?: string;
  }>;
};
```

5. Return normalized records to frontend

Note: exact parsing rules depend on the real object/key structure inside `advance/`; this is part of discovery phase.

## 5) Phased Delivery Plan
## Phase 0 – Discovery and Contract Definition
- Inspect `advance/` structure and sample objects
- Document key patterns (folder schema, filenames, payload formats)
- Define canonical `SubmissionSummary` + `SubmissionDetail`
- Finalize API contract

Deliverable:
- `docs/s3-data-contract.md`

## Phase 1 – Project Setup
- Bootstrap Vite React TypeScript app
- Add API server layer
- Add env loading (`.env.aws` consumed server-side only)
- Basic app shell + routing

Deliverable:
- Running app with health endpoint and placeholder pages

## Phase 2 – S3 Service + Normalization
- Build S3 client module
- Implement object listing and grouping
- Parse payload files and classify assets
- Add robust null-safe handling for partial/inconsistent data

Deliverable:
- API returns real submission list/detail from S3

## Phase 3 – List View
- Build submissions table/cards
- Search by VIN/submission ID
- Filter by stage/date
- Pagination + loading/error/empty states

Deliverable:
- Usable overview screen for operations

## Phase 4 – Detail View
- Submission header (ID, VIN, stage, timestamps)
- Structured sections for form fields
- Media/document gallery with open/download behavior

Deliverable:
- Full submission drilldown page

## Phase 5 – Hardening
- Structured logging and error boundaries
- Basic test coverage for parser + API endpoints
- Performance pass (S3 pagination/caching)
- Internal deployment setup

Deliverable:
- Stable internal MVP ready for team use

## 6) Security and Operational Requirements
- **Never expose AWS secrets in frontend bundle**
- Only server process reads `.env.aws`
- Add `.env.aws` to `.gitignore`
- Optional next step: replace static keys with IAM role/STS for runtime
- Add simple access restriction before production use (VPN/internal auth/SSO proxy)

## 7) Risks and Mitigations
- Unknown/inconsistent S3 structure
  - Mitigation: explicit discovery phase and parser fallback rules
- Large bucket/object counts
  - Mitigation: prefix narrowing, pagination, lazy loading, caching
- Missing/invalid payload files
  - Mitigation: partial rendering with warnings instead of hard failure
- Sensitive personal data exposure
  - Mitigation: internal-only deployment + logging hygiene + role-based access later

## 8) Acceptance Criteria for MVP
- User can open app and see submission list sourced from `advance/`
- User can search/filter and open a submission detail page
- Detail page shows available structured data + file assets
- Errors are visible and actionable (not blank screens)
- No AWS secrets are exposed in browser network/source

## 9) Open Decisions to Confirm Before Build
1. UI style choice:
   - Minimal internal (fastest)
   - Design-system-ready (more setup, better long-term consistency)
2. Deployment target:
   - Local/internal only first
   - Internal cloud environment directly
3. Auth for internal users:
   - Start without auth behind network restrictions
   - Add SSO gate immediately

## 10) Proposed Immediate Next Step
Start **Phase 0 (Discovery)** and produce `docs/s3-data-contract.md` from real `advance/` object samples, then lock parsing rules before coding the full UI.
