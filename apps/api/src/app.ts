import express from "express";
import cors from "cors";
import { ZodError } from "zod";
import { Interface } from "ethers";
import { contractArtifacts } from "./shared/contract-artifacts";
import { ERROR_MESSAGES } from "../../../shared/constants/contract-error-messages";
import type { ErrorRequestHandler, Router } from "express";
import { ApiError } from "./shared/api-error";

export function createApp(origin: string, campaigns: Router, events?: Router, relay?: Router, publicConfig?: unknown, creators?: Router) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin }), express.json({ limit: "16kb" }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/config", (_req, res) => res.json(publicConfig || {}));
  app.use("/api/campaigns", campaigns);
  if (events) app.use("/api/events", events);
  if (creators) app.use("/api/creators", creators);
  if (relay) app.use("/api/relay", relay);
  app.use((_req, _res, next) => next(new ApiError(404, "Ресурс не знайдено")));
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent) return;
    if (error instanceof ZodError) { res.status(400).json({ message: "Некоректні параметри запиту", issues: error.issues }); return; }
    if (error instanceof ApiError) { res.status(error.status).json({ message: error.message }); return; }
    if (error?.type === "entity.parse.failed") { res.status(400).json({ message: "Некоректний JSON" }); return; }
    const nested = error?.info?.error?.data;
    const data = error?.data || (typeof nested === "string" ? nested : nested?.data);
    if (typeof data === "string") for (const artifact of Object.values(contractArtifacts)) {
      try {
        const parsed = new Interface(artifact.abi).parseError(data);
        if (parsed) { res.status(422).json({ message: ERROR_MESSAGES[parsed.name] || `Контракт відхилив дію: ${parsed.name}`, code: parsed.name }); return; }
      } catch { continue; }
    }
    console.error(error instanceof Error ? error.message : "RPC failure");
    res.status(502).json({ message: "Сервіс тимчасово недоступний. Спробуйте ще раз пізніше." });
  };
  app.use(errorHandler);
  return app;
}
