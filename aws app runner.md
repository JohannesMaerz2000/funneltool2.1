# AWS App Runner Deployment Notes (Funnel Tool 2.1)

Date: 2026-04-08
Project: `funneltool2.1`

## Goal
Host this app on AWS App Runner with the simplest flow, auto-deploying from `main`.

## What We Chose In App Runner

Status:
- `Create & deploy` submitted on `2026-04-08`.
- Service provisioning/deployment currently in progress (not yet running at time of writing).

### Source + Deploy
- Source: Code repository
- Branch: `main`
- Deployment trigger: `Automatic`

### Build & Runtime
- Build settings: `Configure all settings here` (not `apprunner.yaml`, for now)
- Runtime: `Node.js 22` (or `Node.js 20` if 22 not available)
- Port: `3001`
- Build command: `npm ci && npm run build`
- Start command: `npm run start`

### Service Config
- Service name: `funneltool-v2-dev`
- CPU: `1 vCPU`
- Memory: `2 GB`

### Environment Variables
Configured:
- `NODE_ENV=production`
- `AWS_REGION=eu-central-1`
- `S3_BUCKET=seller-funnel-production`
- `SELLER_API_BASE_URL=http://api.release.seller.aampere.com/`
- `SELLER_API_KEY=<seller API key>`

Notes:
- We tried `Secrets Manager` for `SELLER_API_KEY`, but IAM lacked `ListSecrets`, so plain text was used for now.
- Do not set `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` in App Runner when using an instance role.

### Other Sections
- Auto scaling:
  - `DefaultConfiguration` `v1`
  - Concurrency: `100`
  - Min instances: `1`
  - Max instances: `25`
- Health check:
  - Protocol: `TCP`
  - Timeout: `5s`
  - Interval: `10s`
  - Unhealthy threshold: `5`
  - Healthy threshold: `1`
- Security:
  - Instance role selected: `arn:aws:iam::010438475175:role/apprunner-funneltool-s3-role`
  - KMS key: `AWS-owned key` (default)
  - WAF: `Off`
- Networking:
  - Incoming: `Public endpoint`
  - Endpoint IP type: `IPv4`
  - Outgoing: `Public access`
- Observability: `Off`
- Tags: none

### IAM Role Created For App Runner
- Role name: `apprunner-funneltool-s3-role`
- Trust principal: `tasks.apprunner.amazonaws.com`
- Inline policy name: `S3FullAccessSellerFunnelProduction`
- Bucket scope:
  - `arn:aws:s3:::seller-funnel-production`
  - `arn:aws:s3:::seller-funnel-production/*`

## Key Found During Setup
The Seller API key value used by this project was found in:
- `enabledatabasecontext/databaseenable.md`
  - Contains example `x-api-key: ft_akey_...`

## Code Changes Made During This Session

### 1) S3 auth made App Runner-role friendly
File: `server/s3.ts`
- Changed S3 client creation to:
  - use explicit `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` only when present
  - otherwise use default AWS credential chain (works with App Runner instance role)

### 2) Removed hidden Seller API key fallback
Files:
- `server/sellerApi.ts`
- `server/index.ts`

Changes:
- Removed hardcoded default dev API key fallback.
- Added explicit validation at startup (`validateSellerApiEnv()`).
- App now fails fast with clear message if `SELLER_API_KEY` / `FUNNELTOOL_SELLER_API_KEY` is missing.

Build verification:
- `npm run build` passes after changes.

## Errors We Hit + Fixes

1. Error: `Invalid Secret ARN`
- Cause: entered raw key text while Source was `Secrets Manager`.
- Fix: either create/select a real secret ARN, or use plain text env var.

2. Error: `You don't have permission to view or select from existing secrets...`
- Cause: missing IAM permission.
- Workaround used: plain text `SELLER_API_KEY`.
- Later IAM needed for secure secrets flow:
  - `secretsmanager:ListSecrets`
  - `secretsmanager:GetSecretValue`
  - `kms:Decrypt` (if custom KMS key)

## Recommended Next Cleanup
1. Move `SELLER_API_KEY` from plain text to Secrets Manager once IAM is granted.
2. Rotate any API keys that appeared in docs/history.
3. After first successful deploy, consider reducing S3 permissions from `s3:*` to least-privilege actions only.
