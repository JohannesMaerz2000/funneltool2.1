import "dotenv/config";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import express from "express";
import cors from "cors";
import { submissionsRouter } from "./routes/submissions.js";

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

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

app.use("/api/submissions", submissionsRouter);

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
