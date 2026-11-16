import { Router } from "express";
import { z } from "zod";
import { MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from "../../../../../shared/constants/pagination";
import { EVENT_STREAM_INTERVAL_MS } from "../../../../../shared/constants/polling-intervals";
import type { EventIndexer } from "./event-indexer";

export function eventRouter(indexer: EventIndexer) {
  const router = Router();
  router.get("/activity", async (req, res) => {
    const { offset, limit } = z.object({ offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0), limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE) }).parse(req.query);
    await indexer.sync();
    res.json(await indexer.activityPage(offset, limit));
  });
  router.get("/", async (req, res) => {
    const { offset, limit } = z.object({ offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0), limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE) }).parse(req.query);
    await indexer.sync();
    res.json(await indexer.page(offset, limit));
  });
  router.get("/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();
    let previous = "";
    let busy = false;
    const update = async () => {
      if (busy || res.destroyed) return;
      busy = true;
      try {
        await indexer.sync();
        const page = await indexer.checkpoint();
        const revision = `${page.indexedBlock}:${page.blockHash}`;
        if (revision !== previous) {
          previous = revision;
          res.write(`data: ${JSON.stringify({ revision })}\n\n`);
        } else res.write(": heartbeat\n\n");
      } catch { res.write(`event: unavailable\ndata: {}\n\n`); }
      finally { busy = false; }
    };
    void update();
    const timer = setInterval(() => void update(), EVENT_STREAM_INTERVAL_MS);
    req.on("close", () => clearInterval(timer));
  });
  return router;
}
