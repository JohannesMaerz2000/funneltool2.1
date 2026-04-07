# 🚀 Phase 1 Deployment: Funnel Tool 2.1 (via GitHub)

This document outlines the Plan to host the **Funnel Tool 2.1** on AWS App Runner using a direct GitHub connection for speed and simplicity.

---

## 👩‍💼 To: Product Manager
To get a working internal URL as fast as possible, we will start by hosting the app directly from my GitHub repository using AWS App Runner. Once the tool is validated, we can migrate the source to the company GitLab for long-term governance.

### How you can help:
Please choose **one** of the following two options:

*   **Option A (Managed Setup):** Have your AI agent or DevOps team follow the "Implementation Guide" below to create the App Runner service.
*   **Option B (Developer Access):** Provide me with an IAM user account with the following permissions so I can do it:
    *   `AWSAppRunnerFullAccess`
    *   `IAMFullAccess` (to create the S3 service role)

---

## 🤖 Implementation Guide (For AI Agents/DevOps)

### 1. Service Setup
*   **Service Name:** `funneltool-v2-dev`
*   **Source:** Code Repository (GitHub)
*   **Branch:** `main` (or your preferred branch)
*   **Deployment Trigger:** Automatic

### 2. Configure Build & Runtime
*   **Runtime:** Node.js 18
*   **Build Command:** `npm install && npm run build`
*   **Start Command:** `NODE_ENV=production node dist/server/index.js`
*   **Port:** `3001`

### 3. Environment Variables (Inject into App Runner)
The app requires these variables to be set in the App Runner configuration:

| Variable | Recommended Source |
| :--- | :--- |
| `AWS_ACCESS_KEY_ID` | IAM User with S3 access |
| `AWS_SECRET_ACCESS_KEY` | IAM User Secret |
| `S3_BUCKET` | e.g., `seller-funnel-development` |
| `SELLER_API_KEY` | Your restricted API Key |
| `NODE_ENV` | `production` |
