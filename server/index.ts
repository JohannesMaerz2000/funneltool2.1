import "dotenv/config";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import crypto from "crypto";
import express from "express";
import cors from "cors";
import { submissionsRouter } from "./routes/submissions.js";
import { validateSellerApiEnv } from "./sellerApi.js";

// Load .env.aws if present
const envAwsPath = resolve(process.cwd(), ".env.aws");
if (existsSync(envAwsPath)) {
  const lines = readFileSync(envAwsPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key && !process.env[key]) process.env[key] = value;
  }
}

validateSellerApiEnv();

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// --- Auth ---
const APP_PASSWORD = process.env.APP_PASSWORD ?? "changeme";
const AUTH_TOKEN = crypto.createHash("sha256").update(APP_PASSWORD).digest("hex");

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    out[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return out;
}

app.post("/api/login", (req, res) => {
  const { password } = req.body ?? {};
  if (password !== APP_PASSWORD) {
    return res.status(401).json({ error: "Invalid password" });
  }
  // Set a long-lived cookie (10 years)
  res.setHeader(
    "Set-Cookie",
    `ft_auth=${AUTH_TOKEN}; Path=/; Max-Age=315360000; SameSite=Lax`
  );
  return res.json({ ok: true });
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

// Auth middleware — protect everything except login and health
app.use("/api", (req, res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.ft_auth === AUTH_TOKEN) return next();
  return res.status(401).json({ error: "Unauthorized" });
});

// API Routes
app.use("/api/submissions", submissionsRouter);

// Serve static frontend files in production
const isProd = process.env.NODE_ENV === "production";
if (isProd) {
  const distPath = resolve(process.cwd(), "dist/client");
  app.use(express.static(distPath));

  // Serve the frontend for all other routes (SPA fallback)
  app.get("*", (_req, res) => {
    res.sendFile(resolve(distPath, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
