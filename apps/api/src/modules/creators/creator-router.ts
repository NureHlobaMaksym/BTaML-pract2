import { Router } from "express";
import { getAddress, isAddress, ZeroAddress } from "ethers";
import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../../../../shared/constants/pagination";
import type { CreatorService } from "./creator-service";

export function creatorRouter(service: CreatorService) {
  const router = Router();
  router.get("/", async (req, res) => {
    const { offset, limit } = z.object({ offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0), limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE) }).parse(req.query);
    res.json(await service.list(offset, limit));
  });
  router.get("/:address", async (req, res) => {
    const address = z.string().refine(value => isAddress(value) && getAddress(value) !== ZeroAddress).transform(getAddress).parse(req.params.address);
    res.json(await service.get(address));
  });
  return router;
}
